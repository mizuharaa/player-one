/**
 * Copy one recording off a card, measure it and submit it under an explicit
 * operator-declared recording group. Repeat the same --session for recordings
 * with the same task, scenario, collector, device and privacy declarations.
 * A new task or declarations need a new group. Retries keep the same reference,
 * including across midnight. The server refuses conflicting reuse.
 *
 * No card is cleared and source files are never moved or deleted.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect, parseArgs } from 'node:util';
import { ingest } from '../../ingest/src/ingest.ts';

const usage = `Usage: node packages/api/scripts/card-intake.mjs <session-dir>
  --card <tf card id>
  --collector <phone | external_ref | uuid>
  --others-in-frame yes|no --sensitive yes|no
  --session <recording-group reference>
  --task <uuid | name>
  --scenario <uuid | code>
  [--device <uuid | serial>]    default: the device bound to this collector
  [--prepare-time <ISO>]        default: now
  [--api http://127.0.0.1:8080] [--direct-upload]

Credentials, the same four bin/counter.ts reads:
PLAYERONE_MACHINE_IDENTIFIER, PLAYERONE_MACHINE_SECRET,
PLAYERONE_OPERATOR_REF, PLAYERONE_OPERATOR_SECRET.

The two declarations are required and have no default. They are the APP-17b
answers the collector gave at the counter, and a script that guessed them would
be filing a consent answer nobody made.

<session-dir> may be the directory on the mounted card: it is copied into
PLAYERONE_MEDIA_ROOT and every file's sha256 is compared across the two before
anything is imported. A directory already inside PLAYERONE_MEDIA_ROOT is taken
as the copy and is not copied again. The card is only ever read.

--direct-upload sends the copied files from this PC to signed cloud URLs.
It requires PLAYERONE_MEDIA_ROOT for the durable local copy. Re-run the exact
command to resume; neither the source card nor the local copy is deleted.

Without --direct-upload, submitting the ingest record moves no bytes: the API must independently hold
the same session at <its media root>/<basename>, which is what the copy above
arranges when the API runs on this machine.

Idempotent for the same centre, card and --session reference. Every recording
in that explicit group shares one declared session. Conflicting collector,
device, task, scenario or privacy declarations are refused, never overwritten.`;

class UsageError extends Error {}
class StepError extends Error {}

// Allow roughly 1 Mbps for a chunk, with a two-hour ceiling for stalled requests.
export const directPartTimeoutMs = (bytes) => Math.min(2 * 60 * 60 * 1000, Math.max(120_000, Math.ceil(bytes / 125)));

/**
 * A v5-shaped uuid over a name, so the same card and explicit recording group at the same
 * centre always addresses the same handover, batch and session rows.
 *
 * Node has no uuidv5 and a dependency for sixteen bytes would be the opposite
 * of the point. sha256 plus the two version/variant bytes is the whole of the
 * name-based shape that matters here: the id only has to be a stable function
 * of the name and pass `z.string().uuid()` on the routes.
 *
 * ponytail: sha256 rather than the spec's sha1, because these ids never have
 * to match another implementation — only this script's own previous run.
 */
function derivedId(name) {
  const h = createHash('sha256').update(name).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/**
 * Every regular file under a session directory, relative and sorted.
 *
 * A symlink, device node, socket or fifo aborts rather than being hashed:
 * sha256 of a symlink is sha256 of whatever it points at on this machine,
 * which is not what is on the card. An empty inventory aborts too — two empty
 * inventories compare clean, which would certify a copy of nothing.
 */
async function inventory(dir) {
  const files = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const full = join(entry.parentPath ?? entry.path, entry.name);
    if (entry.isFile()) files.push(relative(dir, full).replaceAll('\\', '/'));
    else if (!entry.isDirectory()) {
      throw new StepError(`${full} is not a regular file or directory: not a session directory`);
    }
  }
  if (files.length === 0) throw new StepError(`${dir} holds no files`);
  return files.sort();
}

const sha256 = (path) =>
  new Promise((ok, bad) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('error', bad)
      .on('data', (chunk) => h.update(chunk))
      .on('end', () => ok(h.digest('hex')));
  });

/**
 * The card to the inbox, with the checksum proof on both sides.
 *
 * The source inventory is taken BEFORE the copy, so a file that appears on the
 * card mid-copy cannot be verified into existence. `force` overwrites, because
 * a retry after a half-finished copy has to be able to finish it.
 */
async function copyVerified(from, to) {
  const source = await inventory(from);
  await cp(from, to, { recursive: true, force: true });
  const copied = await inventory(to);
  if (copied.join('\n') !== source.join('\n')) {
    throw new StepError(`the copy holds ${copied.length} files where the card holds ${source.length}`);
  }
  for (const name of source) {
    if ((await sha256(join(from, name))) !== (await sha256(join(to, name)))) {
      throw new StepError(`checksum mismatch after copy: ${name}`);
    }
  }
  return source.length;
}

/** One row out of a reference list, by any of the columns an operator might type. */
function pick(rows, value, keys, what) {
  const hits = rows.filter((r) => keys.some((k) => r[k] != null && String(r[k]) === value));
  if (hits.length === 1) return hits[0];
  throw new UsageError(
    `--${what} "${value}" matched ${hits.length} of ${rows.length} rows on ${keys.join(', ')}`,
  );
}

export function parseIntakeArgs(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        card: { type: 'string' },
        session: { type: 'string' },
        collector: { type: 'string' },
        'others-in-frame': { type: 'string' },
        sensitive: { type: 'string' },
        task: { type: 'string' },
        scenario: { type: 'string' },
        'direct-upload': { type: 'boolean', default: false },
        device: { type: 'string' },
        'prepare-time': { type: 'string' },
        api: { type: 'string', default: 'http://127.0.0.1:8080' },
      },
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (parsed.positionals.length !== 1) throw new UsageError('Expected exactly one <session-dir>');
  const v = parsed.values;
  const required = (name) => {
    const value = v[name];
    if (value === undefined || value.trim() === '') throw new UsageError(`--${name} is required`);
    return value;
  };
  const yesNo = (name) => {
    const value = required(name);
    if (value !== 'yes' && value !== 'no') throw new UsageError(`--${name} must be yes|no`);
    return value === 'yes';
  };
  try {
    const url = new URL(v.api);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.search || url.hash) {
      throw new Error();
    }
  } catch {
    throw new UsageError('--api must be an HTTP or HTTPS URL without credentials, query or fragment');
  }
  const prepare = new Date(v['prepare-time'] ?? new Date().toISOString());
  if (Number.isNaN(prepare.getTime())) throw new UsageError('--prepare-time must be an ISO datetime');
  return {
    sessionDir: resolve(parsed.positionals[0]),
    card: required('card'),
    collector: required('collector'),
    othersInFrame: yesNo('others-in-frame'),
    sensitive: yesNo('sensitive'),
    directUpload: v['direct-upload'],
    session: required('session'),
    task: required('task'),
    scenario: required('scenario'),
    device: v.device,
    prepareTime: prepare.toISOString(),
    api: v.api,
  };
}

/** The table the operator reads out. One row per thing a stakeholder can check. */
export function renderTable(rows) {
  const width = Math.max(...rows.map(([k]) => k.length), 'field'.length);
  const values = Math.max(...rows.map(([, v]) => (v ?? '-').length), 'value'.length);
  const line = ([k, value]) => `${k.padEnd(width)}  ${value ?? '-'}`;
  return [
    line(['field', 'value']),
    `${'-'.repeat(width)}  ${'-'.repeat(values)}`,
    ...rows.map(line),
  ].join('\n');
}

async function main() {
  const note = (text) => process.stderr.write(`${text}\n`);
  const out = {
    session: null,
    copy: null,
    episode: null,
    ingest: null,
    verification: null,
    attribution: null,
    batch: null,
    reuse: null,
  };
  let step = 'usage';
  try {
    const o = parseIntakeArgs(process.argv.slice(2));
    out.session = basename(o.sessionDir);

    step = 'credentials';
    const env = (name) => {
      const value = process.env[name];
      if (value === undefined || value === '') throw new UsageError(`${name} is required`);
      return value;
    };
    const machine = {
      machine_identifier: env('PLAYERONE_MACHINE_IDENTIFIER'),
      secret: env('PLAYERONE_MACHINE_SECRET'),
    };
    const operator = {
      external_ref: env('PLAYERONE_OPERATOR_REF'),
      secret: env('PLAYERONE_OPERATOR_SECRET'),
    };

    step = 'session-dir';
    const directory = await stat(o.sessionDir).catch((error) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        throw new UsageError(`<session-dir> does not exist: ${o.sessionDir}`);
      }
      throw error;
    });
    if (!directory.isDirectory()) {
      throw new UsageError(`<session-dir> is not a directory: ${o.sessionDir}`);
    }
    /**
     * The card is accepted directly and never imported in place. A directory
     * whose parent is already the media root IS the copy — the operator ran
     * `card-check.sh`, or a previous run of this command did — and is left
     * alone, which is also what makes a retry cheap.
     */
    const mediaRoot = process.env['PLAYERONE_MEDIA_ROOT'];
    let sessionDir = o.sessionDir;
    if (o.directUpload && !mediaRoot) throw new UsageError('PLAYERONE_MEDIA_ROOT is required for direct upload');
    if (mediaRoot === undefined || mediaRoot === '') {
      note('PLAYERONE_MEDIA_ROOT is unset; nothing can be copied off a card and server-side media availability is not verified');
      out.copy = 'skipped (PLAYERONE_MEDIA_ROOT unset)';
    } else if (relative(resolve(mediaRoot), dirname(o.sessionDir)) === '') {
      out.copy = 'already under PLAYERONE_MEDIA_ROOT';
    } else {
      step = 'card-copy';
      sessionDir = join(resolve(mediaRoot), out.session);
      out.copy = `${await copyVerified(o.sessionDir, sessionDir)} files, sha256 matched`;
    }

    const base = o.api.replace(/\/$/, '');
    const headers = {};
    const call = async (method, path, body) => {
      const response = await fetch(`${base}${path}`, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(/\/upload(?:\?|$)/.test(path) ? 2 * 60 * 60 * 1000 : 120_000),
        headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const raw = await response.text();
      if (!response.ok) {
        note(raw);
        const failure = new StepError(`HTTP ${response.status}`);
        // The refusal itself, for the one caller below that can act on it.
        try {
          failure.body = JSON.parse(raw);
        } catch {
          failure.body = null;
        }
        throw failure;
      }
      return raw === '' ? {} : JSON.parse(raw);
    };
    const post = (path, body) => call('POST', path, body);

    step = 'auth/machine';
    const machineToken = (await post('/auth/machine', machine)).token;
    step = 'auth/operator';
    const signedIn = await post('/auth/operator', operator);
    headers['x-machine-token'] = `Bearer ${machineToken}`;
    headers.authorization = `Bearer ${signedIn.token}`;

    /**
     * The counter's own offline reference cache, and the one place a collector
     * is findable by phone at all: `GET /api/collectors` carries no phone
     * (BO-03 enrols by `external_ref`) and this route returns whole rows.
     */
    step = 'reference/sync';
    const reference = await call('GET', '/reference/sync');
    const collector = pick(reference.collectors, o.collector, ['phone', 'externalRef', 'id'], 'collector');
    const device =
      o.device === undefined
        ? pick(
            reference.devices.filter((d) => d.boundCollectorId === collector.id),
            collector.id,
            ['boundCollectorId'],
            'device',
          )
        : pick(reference.devices, o.device, ['id', 'hardwareSerial'], 'device');
    const claims = (reference.task_claims ?? []).filter(
      (c) => c.collectorId === collector.id && c.releasedAt === null,
    );
    const claimed = reference.tasks.filter((t) => claims.some((c) => c.taskId === t.id));
    const task = pick(reference.tasks, o.task, ['id', 'name'], 'task');
    const scenario = pick(reference.scenarios, o.scenario, ['id', 'code'], 'scenario');

    const key = JSON.stringify([signedIn.upload_centre_id, o.card, o.session]);
    const handoverId = derivedId(`playerone/card-intake/handover/${key}`);
    const batchId = derivedId(`playerone/card-intake/batch/${handoverId}`);
    const sessionId = derivedId(`playerone/card-intake/session/${key}`);

    step = 'handover';
    const handover = await post('/handovers', {
      id: handoverId,
      collector_id: collector.id,
      device_id: device.id,
      tf_card_id: o.card,
      handover_time: new Date().toISOString(),
    });
    step = 'batch';
    const batch = await post('/upload-batches', {
      id: batchId,
      handover_id: handoverId,
      import_started_at: new Date().toISOString(),
    });
    out.batch = batchId;

    step = 'session';
    const declared = await post(`/handovers/${handoverId}/sessions`, {
      id: sessionId,
      task_id: task.id,
      scenario_id: scenario.id,
      others_in_frame: o.othersInFrame,
      sensitive_info_present: o.sensitive,
      prepare_time: o.prepareTime,
    }).catch((error) => {
      /**
       * The one refusal an operator can act on without help, so it gets the
       * help: which task to pass. The claims come from the same reference
       * cache, so this names the collector's own claims and not a list of
       * everything published.
       */
      if (error instanceof StepError && error.body?.constraint === 'session_claim_missing') {
        const named = (rows) =>
          rows.length === 0 ? '  (none)' : rows.map((t) => `  --task "${t.name}"   # ${t.id}`).join('\n');
        note(
          `${collector.externalRef ?? collector.id} holds no live claim on "${task.name}".\n` +
            `Live claims for this collector, pass one of these:\n${named(claimed)}\n` +
            (claims.length === 0
              ? 'There are none: an operator has to claim a task for this collector first ' +
                '(POST /api/tasks/:id/claims), or the claim was released.\n'
              : ''),
        );
      }
      throw error;
    });
    out.reuse = `handover ${handover.replayed ? 'reused' : 'opened'}` +
      `, batch ${batch.replayed ? 'reused' : 'opened'}` +
      `, session ${declared.replayed ? 'reused' : 'opened'}`;
    if (declared.replayed === true) {
      note('session reused: collector, device, task, scenario and privacy declarations matched');
    }

    step = 'ingest';
    const record = await ingest(sessionDir);
    out.episode = record.episode_id;

    step = 'episodes';
    const submitted = await post(`/upload-batches/${batchId}/episodes`, { episodes: [record] });
    const [episode] = submitted.episodes;
    if (episode?.outcome === undefined) {
      throw new StepError(`submission refused: ${JSON.stringify(episode)}`);
    }
    out.ingest = episode.outcome;
    out.attribution =
      `${episode.attribution_kept ?? episode.resolution_method ?? 'unresolved'}` +
      ` -> session ${episode.collection_session_id ?? 'none'} (${episode.resolution_state})`;

    let uploaded;
    if (o.directUpload) {
      step = 'upload-plan';
      const files = [];
      for (const name of await inventory(sessionDir)) {
        if (name.includes('/')) throw new StepError('nested recording folders are unsupported; choose one flat session directory');
        const path = join(sessionDir, name);
        files.push({ relative_path: name, bytes: (await stat(path)).size, sha256: await sha256(path) });
      }
      const identity = { episode_id: record.episode_id, ingest_id: episode.ingest_id };
      if (!identity.ingest_id) throw new StepError('API does not support direct card delivery; missing ingest_id');
      const declared = new Map(files.map((f) => [f.relative_path, f]));
      const plan = await post(`/upload-batches/${batchId}/upload-plan`, { ...identity, files });
      step = 'upload-bytes';
      for (const file of plan.files) {
        const local = declared.get(file.relative_path);
        if (!local || file.sha256 !== local.sha256 || file.bytes !== local.bytes) throw new StepError('server upload plan differs from local inventory');
        if (file.done) continue;
        const parts = file.put_url ? [{ url: file.put_url, start: 0, end: file.bytes, bytes: file.bytes }] : file.parts;
        if (!Array.isArray(parts)) throw new StepError('server returned no upload parts');
        for (const part of parts) {
          if (!Number.isSafeInteger(part.start) || !Number.isSafeInteger(part.end) ||
              part.start < 0 || part.end < part.start || part.end > file.bytes || part.bytes !== part.end - part.start) {
            throw new StepError('server returned an invalid byte range');
          }
          const url = new URL(part.url);
          if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
            throw new StepError('direct upload requires HTTPS (except loopback tests)');
          }
          const stream = part.bytes === 0 ? null : createReadStream(join(sessionDir, file.relative_path), { start: part.start, end: part.end - 1 });
          try {
            const response = await fetch(url, { method: 'PUT', redirect: 'error',
              body: stream ?? Buffer.alloc(0), duplex: 'half',
              headers: { 'content-length': String(part.bytes) },
              signal: AbortSignal.timeout(directPartTimeoutMs(part.bytes)) });
            await response.arrayBuffer();
            if (!response.ok) throw new StepError(`upload failed HTTP ${response.status}; re-run the same command to resume`);
          } finally { stream?.destroy(); }
          note(`uploaded ${file.relative_path}: ${part.end}/${file.bytes} bytes`);
        }
      }
      step = 'cloud-readback';
      uploaded = await post(`/upload-batches/${batchId}/upload?source=direct`, identity);
    } else {
      step = 'upload';
      uploaded = await post(`/upload-batches/${batchId}/upload`);
    }
    out.verification =
      uploaded.episodes?.find((e) => e.episode_id === record.episode_id)?.verification_state ??
      (uploaded.cloud_verified === true ? 'verified' : 'unverified');
    if (out.verification !== 'verified') throw new StepError('the episode was not cloud verified');
    if (!o.directUpload && uploaded.cloud_verified !== true) throw new StepError('the batch was not cloud verified');
    process.exitCode = 0;
  } catch (error) {
    note(error instanceof StepError ? error.message : inspect(error));
    note(`failed_step: ${step}`);
    if (error instanceof UsageError) note(usage);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  } finally {
    process.stdout.write(
      `${renderTable([
        ['session', out.session],
        ['copy', out.copy],
        ['episode', out.episode],
        ['ingest', out.ingest],
        ['verification', out.verification],
        ['attribution', out.attribution],
        ['batch', out.batch],
        ['reuse', out.reuse],
      ])}\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
