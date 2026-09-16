/**
 * Proves the phone path end to end against a LIVE origin: sign in with a
 * seeded demo collector's phone, read the code the API wrote to its own log
 * (PLAYERONE_ZNS_ENV=sandbox sends nowhere else), verify, list the collector's
 * tasks/claims/sessions, declare a new session, and deliver the smallest
 * committed synthetic session through the real Path A upload protocol —
 * register (unmeasured), PUT every file to its signed URL, /complete, then
 * poll the upload row until the server reports a terminal state.
 *
 *   node deploy/cloud/smoke-phone.mjs --origin https://api.example.sslip.io \
 *     --ssh "ssh -p 234 -i ~/.ssh/id_rsa_playerone playerone@1.2.3.4"
 *
 * `--ssh` is the full invocation used to read the sign-in code off the API
 * container's log (`docker compose ... logs api`); this script never touches
 * the database directly. `--phone` overrides the demo phone
 * (default +84900000001, `seed-stakeholder.mjs`'s own default).
 *
 * It creates exactly one new session and one new collector_uploads row, under
 * a session_basename starting `smoke_`, reusing the demo collector's existing
 * task claim and bound device rather than claiming or binding anything new.
 * Nothing seeded is modified. See `deletionSql` below for how an operator
 * finds and removes what this run added.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The committed synthetic session (packages/api/test/collector-upload.test.ts calls it "engine-measurable"). */
export const FIXTURE_DIR = join(
  repoRoot, 'fixtures', 'sessions', 'delivery-a', 'ego_SYNTH0000001_20260813_090800',
);

export const DEFAULT_PHONE = process.env['PLAYERONE_DEMO_PHONE'] ?? '+84900000001';

const REMOTE_COMPOSE = '/srv/playerone/deploy/cloud/docker-compose.yml';
const REMOTE_ENV_FILE = '/srv/playerone/deploy/cloud/cloud.env';
const remoteLogsCommand = (tail) =>
  `sudo docker compose -f ${REMOTE_COMPOSE} --env-file ${REMOTE_ENV_FILE} logs --tail ${tail} api`;

// ---------------------------------------------------------------- arguments

export function parseArgs(argv) {
  const args = { origin: undefined, ssh: undefined, phone: DEFAULT_PHONE, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--origin') args.origin = argv[++i];
    else if (a === '--ssh') args.ssh = argv[++i];
    else if (a === '--phone') args.phone = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.dryRun) {
    if (!args.origin) throw new Error('--origin is required (unless --dry-run)');
    if (!args.ssh) throw new Error('--ssh is required (unless --dry-run)');
  }
  return args;
}

// --------------------------------------------------------- the log-line parser

/**
 * The exact line `devLogSender` (packages/api/src/zns.ts) writes, once per
 * `docker compose logs` line, prefixed by compose's own `api-1  | `. Several
 * codes for the same phone can be in the tail (repeat runs); the LAST one for
 * the phone we asked about is the live one.
 */
const LOG_LINE = /\[zns:dev\] NOT SENT — sign-in code for (\S+) is (\d{6})\./;

export function parseCode(logText, phone) {
  let found = null;
  for (const line of logText.split('\n')) {
    const m = LOG_LINE.exec(line);
    if (m && m[1] === phone) found = m[2];
  }
  return found;
}

// -------------------------------------------------------------------- ssh

function sshExec(sshCmd, remoteCommand) {
  const res = spawnSync('bash', ['-lc', `${sshCmd} ${JSON.stringify(remoteCommand)}`], {
    encoding: 'utf8',
    timeout: 20000,
  });
  if (res.error) throw new Error(`ssh failed to run: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`ssh exited ${res.status}: ${res.stderr || res.stdout}`);
  return res.stdout;
}

/** Poll the API container's log until the phone's code shows up, or give up. */
async function readCodeFromLog(sshCmd, phone, { attempts = 15, delayMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const log = sshExec(sshCmd, remoteLogsCommand(500));
    const code = parseCode(log, phone);
    if (code) return code;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`no sign-in code for ${phone} appeared in the last ${attempts * delayMs}ms of api logs`);
}

// -------------------------------------------------------------------- http

async function callJson(url, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { /* not JSON */ }
  }
  return { status: res.status, json, text };
}

async function putBytes(url, buffer) {
  const res = await fetch(url, { method: 'PUT', body: new Uint8Array(buffer), signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`PUT ${res.status} ${await res.text()}`);
}

// --------------------------------------------------------- the synthetic session

/** Copy the committed fixture into a fresh temp directory under a unique `smoke_` basename. */
async function buildSyntheticSession() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15); // YYYYMMDD_HHMMSS
  const oldBase = 'ego_SYNTH0000001_20260813_090800';
  const newBase = `smoke_SMOKETEST_${stamp}`;

  const root = await mkdtemp(join(tmpdir(), 'playerone-smoke-'));
  const dir = join(root, newBase);
  await mkdir(dir);

  const entries = await readdir(FIXTURE_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const newName = entry.name.replace(oldBase, newBase);
    const bytes = await readFile(join(FIXTURE_DIR, entry.name));
    await writeFile(join(dir, newName), bytes);
    files.push({
      relative_path: newName,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  files.sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1));
  return { root, dir, basename: newBase, files, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// -------------------------------------------------------------------- steps

async function runStep(label, fn) {
  try {
    const { detail, value } = await fn();
    console.log(`PASS ${label} — ${detail}`);
    return value;
  } catch (err) {
    console.log(`FAIL ${label} — ${err.message}`);
    process.exit(1);
  }
}

function printDryRun(args) {
  const origin = args.origin ?? '<origin>';
  const ssh = args.ssh ?? '<ssh command>';
  const { phone } = args;
  console.log('DRY-RUN — calls that would be made:');
  console.log(`  POST ${origin}/auth/collector/request-code  { phone: "${phone}" }`);
  console.log(`  ssh  ${ssh}  -- ${remoteLogsCommand(500)}   (parse "[zns:dev] NOT SENT — sign-in code for ${phone} is <code>.")`);
  console.log(`  POST ${origin}/auth/collector/verify  { phone: "${phone}", code: "<code>" }`);
  console.log(`  GET  ${origin}/api/me/tasks`);
  console.log(`  GET  ${origin}/api/me/claims`);
  console.log(`  GET  ${origin}/api/me/sessions`);
  console.log(`  GET  ${origin}/api/me/devices`);
  console.log(`  POST ${origin}/api/me/sessions  { id: <uuid>, task_id: <claimed task>, device_serial: <bound device>, scenario: <existing scenario>, others_in_frame: false, sensitive_info_present: false }`);
  console.log(`  POST ${origin}/api/me/uploads  { id: <uuid>, collection_session_id: <session>, session_basename: "smoke_SMOKETEST_<timestamp>", files: [10 declared files] }`);
  console.log(`  PUT  <signed url per file>  (${FIXTURE_DIR})`);
  console.log(`  POST ${origin}/api/me/uploads/<id>/complete`);
  console.log(`  GET  ${origin}/api/me/uploads/<id>  (polled until a terminal state)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.dryRun) {
    printDryRun(args);
    return;
  }
  const { origin, ssh, phone } = args;
  const api = async (path, opts) => callJson(new URL(path, origin).toString(), opts);
  let auth;

  await runStep('request sign-in code', async () => {
    const res = await api('/auth/collector/request-code', { method: 'POST', body: { phone } });
    if (![204, 200].includes(res.status)) throw new Error(`unexpected status ${res.status}: ${res.text}`);
    return { detail: `phone ${phone} -> HTTP ${res.status}` };
  });

  const code = await runStep('read sign-in code from api log', async () => {
    const c = await readCodeFromLog(ssh, phone);
    return { detail: `code ${c}`, value: c };
  });

  auth = await runStep('verify sign-in code', async () => {
    const res = await api('/auth/collector/verify', { method: 'POST', body: { phone, code } });
    if (res.status !== 200 || !res.json?.token) throw new Error(`HTTP ${res.status}: ${res.text}`);
    return { detail: 'token issued', value: `Bearer ${res.json.token}` };
  });
  const authed = (path, opts = {}) =>
    api(path, { ...opts, headers: { ...(opts.headers ?? {}), authorization: auth } });

  const board = await runStep('list tasks, claims, sessions, devices', async () => {
    const [tasks, claims, sessions, devices] = await Promise.all([
      authed('/api/me/tasks'), authed('/api/me/claims'), authed('/api/me/sessions'), authed('/api/me/devices'),
    ]);
    for (const [name, res] of [['tasks', tasks], ['claims', claims], ['sessions', sessions], ['devices', devices]]) {
      if (res.status !== 200) throw new Error(`GET /api/me/${name} -> HTTP ${res.status}: ${res.text}`);
    }
    const mine = tasks.json.tasks.find((t) => t.claimed_by_me);
    if (!mine) throw new Error('the demo collector holds no claimed task to attach a session to');
    const device = devices.json.devices[0];
    if (!device) throw new Error('the demo collector has no bound device');
    const scenario = sessions.json.sessions[0]?.scenario ?? 'home';
    return {
      detail: `${tasks.json.tasks.length} tasks, ${claims.json.claims.length} claims, ` +
        `${sessions.json.sessions.length} sessions, ${devices.json.devices.length} devices; ` +
        `reusing task ${mine.id} on device ${device.hardware_serial}`,
      value: { taskId: mine.id, deviceSerial: device.hardware_serial, scenario },
    };
  });

  const sessionId = randomUUID();
  await runStep('declare a new collection session', async () => {
    const res = await authed('/api/me/sessions', {
      method: 'POST',
      body: {
        id: sessionId,
        task_id: board.taskId,
        device_serial: board.deviceSerial,
        scenario: board.scenario,
        others_in_frame: false,
        sensitive_info_present: false,
      },
    });
    if (![200, 201].includes(res.status)) throw new Error(`HTTP ${res.status}: ${res.text}`);
    return { detail: `session ${sessionId} created_at ${res.json.created_at}` };
  });

  const synth = await buildSyntheticSession();
  let uploadId;
  try {
    const plan = await runStep('register the synthetic upload (unmeasured)', async () => {
      uploadId = randomUUID();
      const res = await authed('/api/me/uploads', {
        method: 'POST',
        body: {
          id: uploadId,
          collection_session_id: sessionId,
          session_basename: synth.basename,
          files: synth.files,
          client_version: 'smoke-phone.mjs/1.0',
        },
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${res.text}`);
      const totalBytes = synth.files.reduce((n, f) => n + f.bytes, 0);
      return {
        detail: `upload ${uploadId} basename ${synth.basename}, ${synth.files.length} files, ${totalBytes} bytes declared`,
        value: res.json,
      };
    });

    await runStep('PUT every file to its signed URL', async () => {
      let bytesSent = 0, filesSent = 0;
      for (const f of plan.files) {
        if (f.done) continue;
        const bytes = await readFile(join(synth.dir, f.relative_path));
        if (f.put_url) {
          await putBytes(f.put_url, bytes);
        } else {
          for (const p of f.parts ?? []) await putBytes(p.url, bytes.subarray(p.start, p.end));
        }
        bytesSent += bytes.length;
        filesSent += 1;
      }
      return { detail: `${filesSent} files, ${bytesSent} bytes sent to the object store` };
    });

    const ingested = await runStep('complete the delivery', async () => {
      const res = await authed(`/api/me/uploads/${uploadId}/complete`, { method: 'POST' });
      if (![200, 409].includes(res.status)) throw new Error(`HTTP ${res.status}: ${res.text}`);
      if (res.status === 409) throw new Error(`refused: ${res.json?.constraint} ${res.text}`);
      return { detail: `state ${res.json.state}, episode_state ${res.json.episode_state}, verification_state ${res.json.verification_state}`, value: res.json };
    });

    const episodeId = ingested.episode_id;
    await runStep('poll the upload until the server reports a terminal state', async () => {
      const terminal = new Set(['ingested', 'held', 'failed']);
      let last;
      for (let i = 0; i < 30; i++) {
        const res = await authed(`/api/me/uploads/${uploadId}`);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${res.text}`);
        last = res.json;
        if (terminal.has(last.state)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!terminal.has(last.state)) throw new Error(`still ${last.state} after 30s`);
      if (last.state !== 'ingested') {
        throw new Error(`terminal state ${last.state} (held_reason ${last.held_reason}, failed_reason ${last.failed_reason})`);
      }
      return {
        detail: `upload_id ${uploadId} episode_id ${last.episode_id} state ${last.state} ` +
          `episode_state ${ingested.episode_state} verification_state ${ingested.verification_state} ` +
          `outcome ${ingested.outcome} attributed ${ingested.attributed} transported ${ingested.transported}`,
      };
    });

    console.log('');
    console.log(`PASS smoke-phone: all steps passed.`);
    console.log(`  batch (session_basename): ${synth.basename}`);
    console.log(`  session id:               ${sessionId}`);
    console.log(`  upload id:                ${uploadId}`);
    console.log(`  episode id:               ${episodeId}`);
    console.log('');
    console.log(deletionSql({ sessionId, uploadId, episodeId, basename: synth.basename }));
  } finally {
    await synth.cleanup();
  }
}

/** SQL an operator can run to remove exactly what this run added. Printed, never executed. */
export function deletionSql({ sessionId, uploadId, episodeId, basename }) {
  return [
    'To remove this run\'s rows (children first; run against the demo database):',
    `  delete from cloud_verifications where episode_id = '${episodeId}';`,
    `  delete from collector_uploads where id = '${uploadId}';`,
    `  delete from episode_files where ingest_id in (select ingest_id from episode_ingests where episode_id = '${episodeId}');`,
    `  delete from episode_ingests where episode_id = '${episodeId}';`,
    `  delete from episodes where episode_id = '${episodeId}';`,
    `  delete from collection_session_devices where collection_session_id = '${sessionId}';`,
    `  delete from collection_sessions where id = '${sessionId}';`,
    `  -- audit_events rows naming these ids are append-only and are left in place, by design.`,
    `  -- object store: delete keys under the prefix containing "${basename}" (or leave; the bytes are a few KB).`,
    `  -- find rows first with: select * from collector_uploads where session_basename = '${basename}';`,
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
