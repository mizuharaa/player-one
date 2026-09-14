/**
 * Read-only preflight for the stakeholder demo. It proves nothing is missing
 * and changes nothing at all: every check is a SELECT, a GET, a HEAD, a TLS
 * handshake or a stat.
 *
 *   DATABASE_URL=postgres://playerone_app:...@host:5433/po_demo_readiness \
 *   PLAYERONE_PUBLIC_URL=https://console.example.vn \
 *   STORAGE_ENDPOINT=... STORAGE_BUCKET=... STORAGE_KEY=... STORAGE_SECRET=... \
 *   PLAYERONE_BACKUP_DIR=/data/backups \
 *   node deploy/demo-preflight.mjs
 *
 * One line per check, each beginning PASS or FAIL, and a non-zero exit if any
 * line says FAIL. Same shape as `deploy/centre/check.mjs`, and deliberately
 * not the same file: that one reads a centre.env and judges a configuration,
 * this one asks the running deployment and the demo database whether Thursday
 * can happen.
 *
 * What it does NOT prove: that the footage plays, that a handset can reach the
 * origin over the demo network, or that a reviewer in Shenzhen can sign in.
 * Those are walked, not checked - see deploy/DEMO-RUNBOOK.md.
 *
 * The heavy dependencies (the store, the S3 client) are imported inside the
 * check that needs them, so the unit test beside this file loads only the pure
 * functions.
 */
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------ pure helpers */

/** Same rule as `packages/api/scripts/seed-stakeholder.mjs`, and it has to be. */
export const DEMO_PREFIXES = ['po_demo', 'playerone_demo'];

export function databaseName(url) {
  try {
    const parsed = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return null;
    const held = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return held === '' ? null : held;
  } catch {
    return null;
  }
}

export const isDemoDatabase = (name) =>
  name !== null && DEMO_PREFIXES.some((prefix) => name.startsWith(prefix));

/** Whole hours, floored, between two instants. Negative means already past. */
export const hoursBetween = (from, to) => Math.floor((to.getTime() - from.getTime()) / 3_600_000);

/** What counts as a database dump in a backup directory. */
export const DUMP_PATTERN = /\.(dump|sql|sql\.gz|tar|tar\.gz|backup)$/i;

/**
 * The newest dump in a listing, from names and modification times only, so
 * the choice is testable without a filesystem.
 */
export function newestDump(entries) {
  return entries
    .filter((e) => DUMP_PATTERN.test(e.name))
    .reduce((best, e) => (best === null || e.mtime > best.mtime ? e : best), null);
}

const line = (level, check, message) => ({ level, check, message });
export const pass = (check, message) => line('PASS', check, message);
export const fail = (check, message) => line('FAIL', check, message);
export const skip = (check, message) => line('SKIP', check, message);

/**
 * Which demo is being checked, because two of these checks are only faults on
 * one of them.
 *
 * The cloud variant is fronted by Caddy and dumps into a backup volume, so a
 * missing `/healthz` or a missing dump is a real fault. The centre-PC LAN
 * variant has neither by design: `/healthz` belongs to `deploy/http-server.mjs`
 * and the cloud Caddyfile, and `serve.ts` answers it 404 (measured 2026-09-14),
 * and the LAN demo is not the deployment being backed up.
 *
 * Explicit `PLAYERONE_DEMO_VARIANT=lan` wins; otherwise a plain-HTTP origin is
 * the LAN signal, which is the same signal the certificate check reads.
 */
export function variantOf(env) {
  if (env.PLAYERONE_DEMO_VARIANT === 'lan' || env.PLAYERONE_DEMO_VARIANT === 'cloud') {
    return env.PLAYERONE_DEMO_VARIANT;
  }
  try {
    return new URL(env.PLAYERONE_PUBLIC_URL).protocol === 'http:' ? 'lan' : 'cloud';
  } catch {
    return 'cloud';
  }
}

/**
 * On the LAN variant a FAIL from these two checks is not a fault, so it is
 * reported SKIP with the reason rather than PASS (which would claim something
 * was proved) or FAIL (which would send somebody fixing nothing).
 */
export const softenForLan = (findings, variant, why) =>
  variant !== 'lan'
    ? findings
    : findings.map((f) => (f.level === 'FAIL' ? skip(f.check, why + ' Original: ' + f.message) : f));

/* ----------------------------------------------------------------- checks */

/**
 * The database: it is the demo one, and the seed is in it.
 *
 * `open()` is the application's own connector, so this also proves the role in
 * DATABASE_URL can read - and it refuses a superuser URL (migration 0021),
 * which is the right answer for a deployment's own credential.
 */
export async function databaseChecks(env) {
  const url = env.DATABASE_URL ?? '';
  const name = databaseName(url);
  if (!isDemoDatabase(name)) {
    const named = name === null ? 'no database' : "'" + name + "'";
    return [
      fail('demo-database', 'DATABASE_URL names ' + named + '; the demo database name must ' +
        'start with ' + DEMO_PREFIXES.join(' or ') + '. No query was run.'),
    ];
  }
  const out = [pass('demo-database', "DATABASE_URL names the demo database '" + name + "'.")];
  let db;
  try {
    const store = await import('../packages/store/src/index.ts');
    db = await store.open(url);
  } catch (error) {
    return [...out, fail('database-connect', 'cannot connect, or the store refused this role: ' +
      (error instanceof Error ? error.message : String(error)))];
  }
  try {
    const { sql } = await import('drizzle-orm');
    const [row] = await db.execute(sql`
      select (select count(*) from collectors
               where id = '00000000-0000-4000-8000-00000000d001'
                 and exam_result = 'pass' and training_completed_at is not null)::int as collector,
             (select count(*) from tasks where status = 'published')::int as tasks,
             (select count(*) from collection_sessions
               where collector_id = '00000000-0000-4000-8000-00000000d001')::int as sessions,
             (select count(distinct role) from operators
               where role in ('administrator','finance','reviewer'))::int as roles,
             (select verify_status from payout_accounts
               where collector_id = '00000000-0000-4000-8000-00000000d001'
                 and is_current limit 1) as verify_status`);
    out.push(row.collector === 1
      ? pass('seed-collector', 'the demo collector is seeded, trained and exam-passed.')
      : fail('seed-collector', 'the demo collector is missing or not qualified. ' +
          'Run packages/api/scripts/seed-stakeholder.mjs.'));
    out.push(row.tasks >= 4
      ? pass('seed-tasks', row.tasks + ' published tasks.')
      : fail('seed-tasks', 'only ' + row.tasks + ' published task(s); the demo wants four.'));
    out.push(row.sessions >= 1
      ? pass('seed-session', row.sessions + ' declared collection session(s).')
      : fail('seed-session', 'no declared collection session for the demo collector.'));
    out.push(row.roles === 3
      ? pass('seed-staff', 'administrator, finance and reviewer sign-ins all exist.')
      : fail('seed-staff', 'only ' + row.roles + ' of the three staff roles exist ' +
          '(administrator, finance, reviewer).'));
    out.push(row.verify_status === null
      ? fail('seed-payout', 'no current payout destination for the demo collector; ' +
          'the awaiting-payment ending needs a declared one.')
      : pass('seed-payout', "payout destination declared, verify_status='" + row.verify_status +
          "'" + (row.verify_status === 'verified'
            ? ' - a payment CAN be recorded; use the verified ending.'
            : ' - the honest ending is awaiting payment, destination unverified.')));
  } catch (error) {
    out.push(fail('seed', 'the seed could not be read: ' +
      (error instanceof Error ? error.message : String(error))));
  } finally {
    await db.close();
  }
  return out;
}

/** The API answers, through whatever proxy is in front of it. */
export async function healthCheck(env, { timeoutMs = 5000 } = {}) {
  return softenForLan(
    await healthOfOrigin(env, { timeoutMs }),
    variantOf(env),
    'LAN variant: there is no front server in front of the API, and /healthz is the ' +
      "front server's route - serve.ts answers it 404. Check the API directly: a GET of " +
      '/whoami must answer 401.',
  );
}

async function healthOfOrigin(env, { timeoutMs }) {
  let origin;
  try {
    origin = new URL(env.PLAYERONE_PUBLIC_URL);
  } catch {
    return [fail('healthz', 'set PLAYERONE_PUBLIC_URL to the origin the demo is shown on.')];
  }
  try {
    const res = await fetch(new URL('/healthz', origin), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json();
    return body.ready === true
      ? [pass('healthz', origin.origin + '/healthz answers ready.')]
      : [fail('healthz', origin.origin + '/healthz answered ' + res.status + ' ' +
          JSON.stringify(body) + '; the API behind the proxy is not up.')];
  } catch (error) {
    return [fail('healthz', 'no usable answer from ' + origin.origin + '/healthz: ' +
      (error instanceof Error ? error.message : String(error)) +
      '. Check the proxy, the API container and the certificate.')];
  }
}

/**
 * The certificate the room will see, read from the handshake rather than from
 * a file: a certificate on disk that Caddy is not serving proves nothing.
 */
export async function certificateCheck(env, { timeoutMs = 5000, now = new Date() } = {}) {
  let origin;
  try {
    origin = new URL(env.PLAYERONE_PUBLIC_URL);
  } catch {
    return [fail('certificate', 'set PLAYERONE_PUBLIC_URL to the origin the demo is shown on.')];
  }
  if (origin.protocol !== 'https:') {
    return [pass('certificate', 'the origin is plain HTTP (' + origin.origin + '), so there is ' +
      'no certificate to expire. Correct for the centre-PC LAN variant only.')];
  }
  const { connect } = await import('node:tls');
  const cert = await new Promise((done) => {
    const socket = connect(
      { host: origin.hostname, port: Number(origin.port || 443), servername: origin.hostname },
      () => {
        const peer = socket.getPeerCertificate();
        socket.end();
        done(peer);
      },
    );
    socket.setTimeout(timeoutMs, () => { socket.destroy(); done(null); });
    socket.on('error', () => done(null));
  });
  if (cert === null || !cert.valid_to) {
    return [fail('certificate', 'no certificate was offered by ' + origin.hostname +
      '. Caddy has not issued one, or DNS does not point here yet.')];
  }
  const hours = hoursBetween(now, new Date(cert.valid_to));
  const when = 'expires ' + cert.valid_to + ' (' + Math.floor(hours / 24) + ' days, ' +
    hours + ' hours)';
  if (hours <= 0) {
    return [fail('certificate-expiry', 'the certificate has EXPIRED: ' + when + '.')];
  }
  const level = hours < 168 ? fail : pass;
  return [
    pass('certificate', 'served by ' + origin.hostname + ', subject ' +
      (cert.subject?.CN ?? 'unnamed')),
    level('certificate-expiry', when + (hours < 168
      ? ' - under seven days. Re-issue now, not during the demo.'
      : '')),
  ];
}

/** The bucket answers a HEAD. One request, no bytes written. */
export async function storageCheck(env) {
  const missing = ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_KEY', 'STORAGE_SECRET']
    .filter((name) => !env[name]);
  if (missing.length > 0) return [fail('storage', 'not configured: ' + missing.join(', ') + '.')];
  try {
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: env.STORAGE_KEY, secretAccessKey: env.STORAGE_SECRET },
    });
    await client.send(new HeadBucketCommand({ Bucket: env.STORAGE_BUCKET }));
    return [pass('storage', "bucket '" + env.STORAGE_BUCKET + "' answers a HEAD at " +
      env.STORAGE_ENDPOINT + '.')];
  } catch (error) {
    return [fail('storage', "bucket '" + env.STORAGE_BUCKET + "' did not answer a HEAD: " +
      (error instanceof Error ? error.message : String(error)) +
      '. Check the endpoint, the keys and the bucket name.')];
  }
}

/** A dump newer than a day, in the directory the deployment dumps into. */
export async function backupCheck(env, { now = new Date() } = {}) {
  return softenForLan(
    await backupOfDir(env, { now }),
    variantOf(env),
    'LAN variant: the centre PC is not the deployment being dumped. Take a dump anyway ' +
      'before the demo if this database is the one being shown.',
  );
}

async function backupOfDir(env, { now }) {
  const dir = env.PLAYERONE_BACKUP_DIR;
  if (!dir) {
    return [fail('backup', 'set PLAYERONE_BACKUP_DIR to the directory pg_dump writes into.')];
  }
  let entries;
  try {
    entries = await Promise.all(
      (await readdir(dir)).map(async (name) => ({
        name,
        mtime: (await stat(join(dir, name))).mtime,
      })),
    );
  } catch (error) {
    return [fail('backup', 'cannot read ' + dir + ': ' +
      (error instanceof Error ? error.message : String(error)))];
  }
  const newest = newestDump(entries);
  if (newest === null) {
    return [fail('backup', 'no dump in ' + dir + '. Take one before the demo: the restore is ' +
      'the recovery for every database step, and it needs a dump to restore.')];
  }
  // Floored from the older instant to the newer one, so a dump taken two
  // minutes ago reads 0 hours and not 1.
  const age = hoursBetween(newest.mtime, now);
  return age < 24
    ? [pass('backup', 'newest dump ' + newest.name + ', ' + age + ' hour(s) old.')]
    : [fail('backup', 'newest dump ' + newest.name + ' is ' + age + ' hours old; take a fresh ' +
        'one (over 24 hours is not a demo-day backup).')];
}

/* ------------------------------------------------------------------- main */

export async function preflight(env, options = {}) {
  return [
    ...(await databaseChecks(env)),
    ...(await healthCheck(env, options)),
    ...(await certificateCheck(env, options)),
    ...(await storageCheck(env)),
    ...(await backupCheck(env, options)),
  ];
}

async function main() {
  const findings = await preflight(process.env);
  for (const finding of findings) {
    console.log(finding.level + ' ' + finding.check + ': ' + finding.message);
  }
  const failed = findings.filter((f) => f.level === 'FAIL').length;
  const skipped = findings.filter((f) => f.level === 'SKIP').length;
  const tail = skipped === 0 ? '' : ', ' + skipped + ' skipped (' + variantOf(process.env) + ' variant)';
  console.log(failed === 0
    ? 'PASS preflight: ' + findings.length + ' checks, none failed' + tail + '.'
    : 'FAIL preflight: ' + failed + ' of ' + findings.length + ' checks failed' + tail + '.');
  process.exitCode = failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
