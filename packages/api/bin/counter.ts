import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect, parseArgs } from 'node:util';
import { z } from 'zod';
import { ingest } from '../../ingest/src/ingest.ts';

const usage = `Usage: node packages/api/bin/counter.ts import
  --session-dir <ego_*/ directory>
  --collector <uuid> --device <uuid> --card <tf card id>
  --task <uuid> --scenario <uuid>
  --others-in-frame yes|no --sensitive yes|no
  [--prepare-time <ISO>]           default: now
  [--api http://127.0.0.1:8080]    default as shown

Credentials: PLAYERONE_MACHINE_IDENTIFIER, PLAYERONE_MACHINE_SECRET,
PLAYERONE_OPERATOR_REF (external_ref), PLAYERONE_OPERATOR_SECRET.
The session directory must be directly inside the API's PLAYERONE_MEDIA_ROOT.
Submitting an ingest record does not move bytes. The API must independently
have the same session bytes at <its media root>/<session basename>.
The parent check against the command's PLAYERONE_MEDIA_ROOT is a local sanity
check only; if unset, it is skipped. Server-side media availability is not
verified by this command, including when --api names another host.

Recovery (existing batch/bill only; one request, no automatic retries):
  counter.ts upload --batch <uuid> [--api http://127.0.0.1:8080]
  counter.ts archive-retry --bill <uuid> [--after <opaque cursor>] [--api ...]
Both use the same credentials above. Archive retry requires an administrator.
Archive confirmed counts are tag acknowledgements, not proof of storage tier.
page_complete means this page finished; more_pages requires another explicit call.`;

class UsageError extends Error {}
class HttpError extends Error {}

const cursor = z.string().min(1).max(1024).refine((value) =>
  Buffer.byteLength(value, 'utf8') <= 1024 && !/[\u0000-\u001f]/.test(value));
const archiveResponse = z.object({
  attempted: z.number().int().min(0).max(5),
  confirmed: z.number().int().nonnegative(),
  failed_object_keys: z.array(z.string().min(1)),
  query_failed: z.boolean(),
  audit_recorded: z.boolean(),
  next_after: cursor.nullable(),
}).refine((value) => value.confirmed + value.failed_object_keys.length === value.attempted);

function validateApi(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
  } catch {
    throw new UsageError('--api must be an HTTP or HTTPS URL without credentials, query or fragment');
  }
  return value;
}

export function parseRecoveryArgs(args: string[]) {
  const command = args[0];
  if (command !== 'upload' && command !== 'archive-retry') throw new UsageError('Expected upload or archive-retry');
  let parsed;
  try {
    parsed = parseArgs({ args: args.slice(1), options: {
      api: { type: 'string', default: 'http://127.0.0.1:8080' },
      ...(command === 'upload' ? { batch: { type: 'string' as const } } : {
        bill: { type: 'string' as const }, after: { type: 'string' as const },
      }),
    } });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const values = parsed.values as { api: string; batch?: string; bill?: string; after?: string };
  const idFlag = command === 'upload' ? 'batch' : 'bill';
  const id = values[idFlag];
  if (!z.string().uuid().safeParse(id).success) throw new UsageError(`--${idFlag} must be a UUID`);
  const after = values.after;
  if (after !== undefined && !cursor.safeParse(after).success) {
    throw new UsageError('--after must be a nonempty cursor of at most 1024 UTF-8 bytes without control characters');
  }
  const api = validateApi(values.api);
  return command === 'upload'
    ? { command: 'upload' as const, id: id as string, api }
    : { command: 'archive-retry' as const, id: id as string, api, after };
}

export function parseImportArgs(args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        'session-dir': { type: 'string' },
        collector: { type: 'string' },
        device: { type: 'string' },
        card: { type: 'string' },
        task: { type: 'string' },
        scenario: { type: 'string' },
        'others-in-frame': { type: 'string' },
        sensitive: { type: 'string' },
        'prepare-time': { type: 'string' },
        api: { type: 'string', default: 'http://127.0.0.1:8080' },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (parsed.positionals.length !== 1 || parsed.positionals[0] !== 'import') {
    throw new UsageError('Expected the import command');
  }
  const values = parsed.values;
  const required = (name: keyof typeof values): string => {
    const value = values[name];
    if (value === undefined || value.trim() === '') throw new UsageError(`--${name} is required`);
    return value;
  };
  const uuid = (name: 'collector' | 'device' | 'task' | 'scenario') => {
    const value = required(name);
    if (!z.string().uuid().safeParse(value).success) throw new UsageError(`--${name} must be a UUID`);
    return value;
  };
  const yesNo = (name: 'others-in-frame' | 'sensitive') => {
    const value = required(name);
    if (value !== 'yes' && value !== 'no') throw new UsageError(`--${name} must be yes|no`);
    return value === 'yes';
  };
  const options = {
    sessionDir: resolve(required('session-dir')),
    collector: uuid('collector'),
    device: uuid('device'),
    card: required('card'),
    task: uuid('task'),
    scenario: uuid('scenario'),
    othersInFrame: yesNo('others-in-frame'),
    sensitive: yesNo('sensitive'),
    prepareTime: values['prepare-time'] ?? new Date().toISOString(),
    api: required('api'),
  };
  const prepareTime = new Date(options.prepareTime);
  if (Number.isNaN(prepareTime.getTime())) throw new UsageError('--prepare-time must be an ISO datetime');
  options.prepareTime = prepareTime.toISOString();
  validateApi(options.api);
  return options;
}

export function buildImportBodies(options: ReturnType<typeof parseImportArgs>) {
  const handover = {
    id: randomUUID(), collector_id: options.collector, device_id: options.device,
    tf_card_id: options.card, handover_time: new Date().toISOString(),
  };
  const batch = {
    id: randomUUID(), handover_id: handover.id, import_started_at: new Date().toISOString(),
  };
  const session = {
    id: randomUUID(), task_id: options.task, scenario_id: options.scenario,
    others_in_frame: options.othersInFrame, sensitive_info_present: options.sensitive,
    prepare_time: options.prepareTime,
  };
  return { handover, batch, session };
}

async function main() {
  const started = performance.now();
  const result = {
    handover_id: null as string | null,
    session_id: null as string | null,
    batch_id: null as string | null,
    episode_id: null as string | null,
    ingest_state: null as string | null,
    cloud_verified: null as boolean | null,
    elapsed_s: 0,
    failed_step: null as string | null,
  };
  let step = 'usage';
  let recovery: Record<string, unknown> | undefined;
  const diagnostic = (body: string) => {
    process.stderr.write(body);
    if (!body.endsWith('\n')) process.stderr.write('\n');
  };
  try {
    const args = process.argv.slice(2);
    const options = args[0] === 'upload' || args[0] === 'archive-retry'
      ? parseRecoveryArgs(args)
      : { ...parseImportArgs(args), command: 'import' as const };
    if (options.command !== 'import') {
      recovery = { command: options.command, [options.command === 'upload' ? 'batch_id' : 'bill_id']: options.id,
        ...(options.command === 'upload' ? { cloud_verified: null } : { page_status: 'failed' }),
        failed_step: null, elapsed_s: 0 };
    }
    step = 'credentials';
    const required = (name: string) => {
      const value = process.env[name];
      if (value === undefined || value === '') throw new UsageError(`${name} is required`);
      return value;
    };
    const machine = {
      machine_identifier: required('PLAYERONE_MACHINE_IDENTIFIER'),
      secret: required('PLAYERONE_MACHINE_SECRET'),
    };
    const operator = {
      external_ref: required('PLAYERONE_OPERATOR_REF'),
      secret: required('PLAYERONE_OPERATOR_SECRET'),
    };
    if (options.command === 'import') {
      step = 'session-dir';
      const directory = await stat(options.sessionDir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
          throw new UsageError(`--session-dir does not exist: ${options.sessionDir}`);
        }
        throw error;
      });
      if (!directory.isDirectory()) throw new UsageError(`--session-dir is not a directory: ${options.sessionDir}`);
      const mediaRoot = process.env['PLAYERONE_MEDIA_ROOT'];
      const mediaWarning = 'server-side media availability is not verified by this command';
      if (mediaRoot === undefined || mediaRoot === '') {
        diagnostic(`PLAYERONE_MEDIA_ROOT is unset; local sanity check skipped; ${mediaWarning}`);
      } else {
        diagnostic(`PLAYERONE_MEDIA_ROOT comparison is a local sanity check only; ${mediaWarning}`);
        if (relative(resolve(mediaRoot), dirname(options.sessionDir)) !== '') {
          throw new UsageError('--session-dir parent must be PLAYERONE_MEDIA_ROOT');
        }
      }
    }
    const headers: Record<string, string> = {};
    const post = async (path: string, body?: unknown) => {
      const response = await fetch(`${options.api.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const raw = await response.text();
      if (!response.ok || step === 'episodes' || step === 'upload' || step === 'archive-retry') diagnostic(raw);
      if (!response.ok) throw new HttpError(`HTTP ${response.status}`);
      return raw;
    };
    const token = (raw: string): string => {
      const value = JSON.parse(raw).token;
      if (typeof value !== 'string' || value === '') throw new Error('Auth response has no token');
      return value;
    };
    step = 'auth/machine';
    const machineToken = token(await post('/auth/machine', machine));
    step = 'auth/operator';
    const operatorToken = token(await post('/auth/operator', operator));
    headers['x-machine-token'] = `Bearer ${machineToken}`;
    headers.authorization = `Bearer ${operatorToken}`;

    if (options.command === 'upload') {
      step = 'upload';
      const uploaded = z.object({ cloud_verified: z.boolean() }).parse(
        JSON.parse(await post(`/upload-batches/${options.id}/upload`)),
      );
      recovery!.cloud_verified = uploaded.cloud_verified;
      if (!uploaded.cloud_verified) throw new HttpError('Upload was not cloud verified');
      process.exitCode = 0;
      return;
    }
    if (options.command === 'archive-retry') {
      step = 'archive-retry';
      const query = options.after === undefined ? '' : `?after=${encodeURIComponent(options.after)}`;
      const archived = archiveResponse.parse(JSON.parse(await post(`/api/settle/bills/${options.id}/archive/retry${query}`)));
      Object.assign(recovery!, archived);
      if (archived.failed_object_keys.length > 0 || archived.query_failed || !archived.audit_recorded) {
        throw new HttpError('Archive page has unconfirmed results; inspect the response before retrying');
      }
      recovery!.page_status = archived.next_after === null ? 'page_complete' : 'more_pages';
      diagnostic('Confirmed counts tag acknowledgements only, not actual storage tier.');
      process.exitCode = 0;
      return;
    }

    const bodies = buildImportBodies(options);
    step = 'handover';
    result.handover_id = bodies.handover.id;
    await post('/handovers', bodies.handover);
    step = 'batch';
    result.batch_id = bodies.batch.id;
    await post('/upload-batches', bodies.batch);
    diagnostic(`batch_id: ${result.batch_id} (created; retain this ID for upload recovery)`);
    step = 'session';
    result.session_id = bodies.session.id;
    await post(`/handovers/${result.handover_id}/sessions`, bodies.session);
    step = 'ingest';
    const record = await ingest(options.sessionDir);
    result.episode_id = record.episode_id;
    result.ingest_state = record.state;
    step = 'episodes';
    await post(`/upload-batches/${result.batch_id}/episodes`, { episodes: [record] });
    step = 'upload';
    const uploaded = JSON.parse(await post(`/upload-batches/${result.batch_id}/upload`));
    result.cloud_verified = typeof uploaded.cloud_verified === 'boolean' ? uploaded.cloud_verified : null;
    if (result.cloud_verified !== true) throw new HttpError('Upload was not cloud verified');
    process.exitCode = 0;
  } catch (error) {
    if (recovery) recovery.failed_step = step;
    else result.failed_step = step;
    if (error instanceof HttpError) diagnostic(error.message);
    else diagnostic(inspect(error));
    diagnostic(`failed_step: ${step}`);
    if (error instanceof UsageError) diagnostic(usage);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  } finally {
    const output = recovery ?? result;
    output.elapsed_s = (performance.now() - started) / 1000;
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
