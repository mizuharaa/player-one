/**
 * Owner-only legacy cutover readback; dry-run is the default.
 *
 * node packages/api/bin/reverify-cloud.ts --allowlist /secure/deliveries.json
 * node packages/api/bin/reverify-cloud.ts --allowlist /secure/deliveries.json --apply \
 *   --operator-id <uuid> --machine-id <uuid> --reason "legacy URL cutover" \
 *   --last-legacy-url-issued-at <ISO timestamp> --legacy-writes-quiescent --completion-writers-stopped
 *
 * JSON entries: {source:"card",episode_id,ingest_id}, or
 * {source:"phone",episode_id,ingest_id,upload_id}. Maximum 100 explicit deliveries.
 * Stop old URL issuance on ALL instances, wait TTL + clock margin, drain existing
 * writes and ALL API/worker completion writers, and pause review/payment of these
 * deliveries until results are closed. This is a maintenance-window tool, never
 * an online verifier. Concurrent completion invalidates the run and blocks release.
 * Flags attest that operation; this CLI cannot observe in-flight PUTs/completions.
 * DATABASE_URL authorizes the owner. Operator/machine IDs are audited attribution,
 * not a simulated login. No storage PUT/COPY/DELETE, upload reassembly, or clawback.
 * Failed/pending episodes and existing settlement exceptions are never released.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { open, type Db } from '@playerone/store';
import { planReverify, ReverifyAllowlist, reverifyDelivery, reverifyOwner, ReverifyRefused } from '../src/cloud-reverify.ts';
import { PRESIGN_TTL_S, s3StoreFromEnv } from '../src/upload-worker.ts';

export function reverifyOptions(args: string[], now = Date.now()) {
  const { values } = parseArgs({ args, allowPositionals: false, options: {
    allowlist: { type: 'string' }, apply: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    'operator-id': { type: 'string' }, 'machine-id': { type: 'string' }, reason: { type: 'string' },
    'last-legacy-url-issued-at': { type: 'string' }, 'legacy-writes-quiescent': { type: 'boolean' },
    'completion-writers-stopped': { type: 'boolean' },
  } });
  if (!values.allowlist || (values.apply && values['dry-run'])) throw new ReverifyRefused('name an allowlist and select either apply or dry-run');
  if (values.apply) {
    if (!values['operator-id'] || !values['machine-id'] || (values.reason?.trim().length ?? 0) < 10) {
      throw new ReverifyRefused('apply requires operator-id, machine-id and a reason of at least 10 characters');
    }
    const lastIssue = Date.parse(values['last-legacy-url-issued-at'] ?? '');
    if (!values['legacy-writes-quiescent'] || !values['completion-writers-stopped']
      || !Number.isFinite(lastIssue) || now - lastIssue < (PRESIGN_TTL_S + 900) * 1000) {
      throw new ReverifyRefused('apply requires expired legacy URL TTL plus fifteen minutes, drained storage writes and ALL completion writers stopped');
    }
  }
  return values;
}

export async function main(args = process.argv.slice(2), env = process.env): Promise<number> {
  let db: Db | undefined;
  let targets: Parameters<typeof planReverify>[1][] = [];
  let completed = 0;
  let applying = false;
  try {
    if (args.length === 1 && args[0] === '--help') {
      console.log(`reverify-cloud --allowlist FILE [--dry-run]
Apply: add --apply --operator-id UUID --machine-id UUID --reason TEXT
  --last-legacy-url-issued-at ISO --legacy-writes-quiescent --completion-writers-stopped
Allowlist: [{"source":"card","episode_id":"UUID","ingest_id":"UUID"}]
Phone: source=phone plus upload_id. Dry-run reads DB only; apply requires its owner.
MAINTENANCE ONLY: stop old issuance, wait one-hour TTL + fifteen minutes, drain storage
writes and stop ALL completion writers. Pause review/payment until closure.
Concurrent completion invalidates the run. No object writes/deletes, auto-release,
or clawback. Failed/pending results still block release even when a copy matches.`);
      return 0;
    }
    const options = reverifyOptions(args);
    targets = ReverifyAllowlist.parse(JSON.parse(await readFile(options.allowlist!, 'utf8')));
    if (!env['DATABASE_URL']) throw new ReverifyRefused('DATABASE_URL is required');
    db = await open(env['DATABASE_URL']);
    // Validate EVERY selector before an apply can make its first change.
    const plans = [];
    for (const target of targets) plans.push(await planReverify(db, target));
    if (!options.apply) {
      console.log(JSON.stringify({ dry_run: true, deliveries: plans }, null, 2));
      return 0;
    }
    const attribution = await reverifyOwner(db, options['operator-id']!, options['machine-id']!);
    const store = s3StoreFromEnv(env);
    if (!store) throw new ReverifyRefused('STORAGE_* configuration is required for apply');
    let exitCode = 0;
    applying = true;
    for (; completed < targets.length; completed++) {
      const target = targets[completed]!;
      const result = await reverifyDelivery(db, store, target, attribution, options.reason!.trim());
      console.log(JSON.stringify(result));
      if (result?.outcome !== 'matched' || result.verification_state !== 'verified') exitCode = 1;
    }
    console.log(JSON.stringify({ release_ready: exitCode === 0, completed, not_run_count: 0, not_run: [] }));
    return exitCode;
  } catch (error) {
    // Database/storage exceptions can contain credentials or SQL parameters.
    console.error(`reverify-cloud: ${error instanceof ReverifyRefused ? error.message : 'invalid input or operation failed; no successful cutover is established'}`);
    const notRun = targets.slice(applying ? completed + 1 : 0);
    console.error(JSON.stringify({ release_ready: false, completed,
      failed_target: applying ? targets[completed] : null, not_run_count: notRun.length, not_run: notRun }));
    return 1;
  } finally { await db?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
