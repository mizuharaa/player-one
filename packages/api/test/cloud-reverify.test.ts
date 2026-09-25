import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { open, schema } from '@playerone/store';
import { main, reverifyOptions } from '../bin/reverify-cloud.ts';
import { planReverify, ReverifyAllowlist, reverifyDelivery, reverifyOwner } from '../src/cloud-reverify.ts';
import { objectKey, type ObjectStore } from '../src/upload-worker.ts';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase } from '../../store/test/db.ts';
import { auditRow, countOf, insertAttemptAs, rows, seedAccount, seedBills, seedPayout, uid } from './payout/domain/fixture.ts';

useDatabase('cloud_reverify');
const bytes = Buffer.from('trusted fixture bytes');
const file = { relative_path: 'camera.mp4', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };

it('defaults to dry-run, requires maintenance attestations, and rejects arbitrary keys', () => {
  expect(reverifyOptions(['--allowlist', 'explicit.json']).apply).toBeUndefined();
  const flags = ['--allowlist', 'explicit.json', '--apply', '--operator-id', uid(), '--machine-id', uid(),
    '--reason', 'legacy cutover fixture', '--last-legacy-url-issued-at', '2026-09-01T00:00:00Z', '--legacy-writes-quiescent'];
  expect(() => reverifyOptions(flags, Date.parse('2026-09-01T02:00:00Z'))).toThrow(/completion writers/);
  expect(() => reverifyOptions([...flags, '--completion-writers-stopped'], Date.parse('2026-09-01T00:30:00Z'))).toThrow(/TTL/);
  expect(reverifyOptions([...flags, '--completion-writers-stopped'], Date.parse('2026-09-01T02:00:00Z')).apply).toBe(true);
  expect(ReverifyAllowlist.safeParse([{ source: 'card', episode_id: uid(), ingest_id: uid(), key: 'anything' }]).success).toBe(false);
});

it('reports every allowlisted target not run when the CLI refuses before apply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reverify-cli-'));
  const allowlist = join(directory, 'allowlist.json');
  const targets = [0, 1].map(() => ({ source: 'card', episode_id: uid(), ingest_id: uid() }));
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await writeFile(allowlist, JSON.stringify(targets));
    expect(await main(['--allowlist', allowlist], {})).toBe(1);
    expect(JSON.parse(errors.mock.calls.at(-1)![0])).toEqual({ release_ready: false, completed: 0,
      failed_target: null, not_run_count: 2, not_run: targets });
  } finally { errors.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});

describe.skipIf(!hasDb())('owner allowlisted cloud reverify', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  async function fixture(paid = false) {
    const d = await db();
    const ids = await seedPayout(d);
    const { bill1 } = await seedBills(d, ids, { originality: paid });
    const account = await seedAccount(d, ids, 1);
    // Admit a historical payment before introducing the legacy/corrupt inventory.
    // The gate must never admit a fresh payment after measured=true is discovered.
    let attemptId: string | undefined;
    if (paid) {
      attemptId = await insertAttemptAs(d, ids, ids.finA, {
        billId: bill1, accountId: account, amountVnd: 2400, mode: 'manual', manualReference: 'already-paid-fixture', settledAt: new Date(),
      });
      await d.transaction(async tx => {
        await tx.execute(sql`update settlements set settlement_state='manually_paid'
          where id in(select settlement_id from bill_lines where bill_id=${bill1})`);
        await auditRow(tx, ids, { action: 'bill.mark_paid', targetTable: 'bills', targetId: bill1, operatorId: ids.finA });
      });
    }
    const [selected] = await rows<{ episode_id: string; ingest_id: string; settlement_id: string }>(d, sql`
      select r.episode_id, r.ingest_id, s.id as settlement_id from bill_lines l
      join settlements s on s.id=l.settlement_id join episode_reviews r on r.id=s.episode_review_id
      where l.bill_id=${bill1} order by s.id limit 1`);
    const target = { source: 'card' as const, episode_id: selected!.episode_id, ingest_id: selected!.ingest_id };
    // Verification tests supply their own exact inventory and receipts below.
    await d.delete(schema.cloudVerifications);
    await d.delete(schema.episodeFiles).where(eq(schema.episodeFiles.ingestId, target.ingest_id));
    await d.update(schema.episodes).set({ latestIngestId: target.ingest_id }).where(eq(schema.episodes.episodeId, target.episode_id));
    await d.update(schema.episodes).set({ verificationState: 'verified' }).where(eq(schema.episodes.episodeId, target.episode_id));
    await d.update(schema.episodeIngests).set({ recordJson: { source_files: [file] }, transportExtraFiles: [] })
      .where(eq(schema.episodeIngests.ingestId, target.ingest_id));
    await d.insert(schema.episodeFiles).values({ ingestId: target.ingest_id, relativePath: file.relative_path,
      sizeBytes: file.bytes, sha256: file.sha256 });
    const uploadId = uid();
    await d.insert(schema.collectorUploads).values({
      id: uploadId, collectorId: ids.collector1, collectionSessionId: ids.session1,
      deviceSerial: 'AZER76400FE', sourceBasename: 'ego_AZER76400FE_20260813_072310',
      episodeId: target.episode_id, ingestId: target.ingest_id, measured: false,
      fileCount: 1, totalBytes: file.bytes, declaredFiles: [file], extraFiles: [],
      state: 'ingested', completedAt: new Date(),
    });
    const phone = { ...target, source: 'phone' as const, upload_id: uploadId };
    const attribution = await reverifyOwner(d, ids.finA, ids.machineA);
    return { d, ids, bill1, account, target, phone, attribution, settlementId: selected!.settlement_id, attemptId };
  }

  it('selects exact card/legacy phone copies, parks paid mismatch, and never undoes payment or releases exception', async () => {
    const h = await fixture(true);
    const reads: string[] = [];
    const canonical = objectKey(h.target.episode_id, h.target.ingest_id, file.relative_path);
    const legacy = objectKey(h.target.episode_id, h.phone.upload_id, file.relative_path);
    const auditBefore = await countOf(h.d, sql`select count(*) as n from audit_events`);
    expect((await planReverify(h.d, h.target)).keys).toEqual([canonical]);
    expect((await planReverify(h.d, h.phone)).keys).toEqual([legacy]);
    const [unmeasured] = await h.d.select().from(schema.collectorUploads).where(eq(schema.collectorUploads.id, h.phone.upload_id));
    const measuredId = uid();
    await h.d.insert(schema.collectorUploads).values({ ...unmeasured!, id: measuredId,
      measured: true, declaredFiles: [], state: 'verified' });
    expect((await planReverify(h.d, { ...h.phone, upload_id: measuredId })).keys).toEqual([canonical]);
    expect(reads).toEqual([]);
    expect(await countOf(h.d, sql`select count(*) as n from audit_events`)).toBe(auditBefore);
    await expect(planReverify(h.d, { ...h.phone, upload_id: uid() })).rejects.toThrow(/exact ingest/);
    for (const key of [canonical, legacy]) await h.d.insert(schema.cloudVerifications).values({
      objectKey: key, episodeId: h.target.episode_id, ingestId: h.target.ingest_id, sha256: file.sha256,
    });
    let body = Buffer.from('corrupted');
    const store: Pick<ObjectStore, 'read'> = { read: async (key, from = 0) => {
      reads.push(key);
      return (async function* () { yield body.subarray(from); })();
    } };
    const result = await reverifyDelivery(h.d, store, h.phone, h.attribution, 'Legacy cutover fixture mismatch');
    expect(result?.outcome).toBe('mismatch');
    expect(result?.parked_settlements).toEqual([h.settlementId]);
    expect(reads).toEqual([legacy]);
    expect(await countOf(h.d, sql`select count(*) as n from cloud_verifications where object_key=${legacy}`)).toBe(0);
    expect(await countOf(h.d, sql`select count(*) as n from cloud_verifications where object_key=${canonical}`)).toBe(1);
    const [settlement] = await h.d.select().from(schema.settlements).where(eq(schema.settlements.id, h.settlementId));
    expect(settlement).toMatchObject({ settlementState: 'exception', exceptionFromState: 'manually_paid', exceptionReason: 'cloud_verification_failed' });
    expect(await countOf(h.d, sql`select count(*) as n from settlements where settlement_state='manually_paid'`)).toBe(1);
    const [attempt] = await h.d.select().from(schema.payoutAttempts).where(eq(schema.payoutAttempts.id, h.attemptId!));
    expect(attempt).toMatchObject({ status: 'succeeded', amountVnd: 2400 });
    body = bytes;
    const retried = await reverifyDelivery(h.d, store, h.phone, h.attribution, 'Legacy cutover matching copy only');
    expect(retried).toMatchObject({ outcome: 'matched', verification_state: 'failed', parked_settlements: [] });
    expect(await countOf(h.d, sql`select count(*) as n from settlements where id=${h.settlementId} and settlement_state='exception'`)).toBe(1);
    expect(await countOf(h.d, sql`select count(*) as n from audit_events where action='episode.owner_reverify'`)).toBe(2);
  });

  it('does not certify a newer ingest when its pointer changes during readback', async () => {
    const h = await fixture();
    const [original] = await h.d.select().from(schema.episodeIngests).where(eq(schema.episodeIngests.ingestId, h.target.ingest_id));
    const newer = uid();
    const store: Pick<ObjectStore, 'read'> = { read: async () => {
      await h.d.insert(schema.episodeIngests).values({ ...original!, ingestId: newer });
      await h.d.update(schema.episodes).set({ latestIngestId: newer }).where(eq(schema.episodes.episodeId, h.target.episode_id));
      return (async function* () { yield bytes; })();
    } };
    await expect(reverifyDelivery(h.d, store, h.target, h.attribution, 'Stale cutover fixture')).rejects.toThrow(/current ingest/);
    const [episode] = await h.d.select().from(schema.episodes).where(eq(schema.episodes.episodeId, h.target.episode_id));
    expect(episode).toMatchObject({ latestIngestId: newer, verificationState: 'pending' });
    expect(await countOf(h.d, sql`select count(*) as n from cloud_verifications`)).toBe(0);
  });

  it('preserves prior state and receipts on interruption, permits clean retry, and refuses missing inventory', async () => {
    const h = await fixture();
    const key = objectKey(h.target.episode_id, h.target.ingest_id, file.relative_path);
    await h.d.insert(schema.cloudVerifications).values({ objectKey: key,
      episodeId: h.target.episode_id, ingestId: h.target.ingest_id, sha256: file.sha256 });
    const receiptsBefore = await h.d.select().from(schema.cloudVerifications);
    const store: Pick<ObjectStore, 'read'> = { read: async () => {
      throw Object.assign(new Error('fixture denied'), { $metadata: { httpStatusCode: 403 } });
    } };
    const result = await reverifyDelivery(h.d, store, h.target, h.attribution, 'Interrupted cutover fixture');
    expect(result).toMatchObject({ outcome: 'incomplete', verification_state: 'verified', interrupted: true });
    expect(await h.d.select().from(schema.cloudVerifications)).toEqual(receiptsBefore);
    const cleanStore: Pick<ObjectStore, 'read'> = { read: async () => (async function* () { yield bytes; })() };
    expect(await reverifyDelivery(h.d, cleanStore, h.target, h.attribution, 'Clean retry cutover fixture'))
      .toMatchObject({ outcome: 'matched', verification_state: 'verified', interrupted: false });
    await h.d.update(schema.episodeIngests).set({ transportExtraFiles: null }).where(eq(schema.episodeIngests.ingestId, h.target.ingest_id));
    await expect(planReverify(h.d, h.target)).rejects.toThrow(/inventory missing/);
  });

  it('persists a proven mismatch even if a later object cannot be read', async () => {
    const h = await fixture();
    await h.d.update(schema.collectorUploads).set({
      declaredFiles: [file, { ...file, relative_path: 'z-extra.json' }], fileCount: 2, totalBytes: file.bytes * 2,
    }).where(eq(schema.collectorUploads.id, h.phone.upload_id));
    const store: Pick<ObjectStore, 'read'> = { read: async (key) => {
      if (key.endsWith('z-extra.json')) throw Object.assign(new Error('fixture denied'), { $metadata: { httpStatusCode: 403 } });
      return (async function* () { yield Buffer.from('corrupted'); })();
    } };
    const result = await reverifyDelivery(h.d, store, h.phone, h.attribution, 'Partially interrupted cutover fixture');
    expect(result).toMatchObject({ outcome: 'mismatch', verification_state: 'failed', interrupted: true,
      parked_settlements: [h.settlementId] });
    expect(result?.mismatches).toHaveLength(1);
  });

  it('refuses applying with the ordinary application role', async () => {
    const h = await fixture();
    const url = new URL(dbUrl());
    url.searchParams.set('role', 'playerone_app');
    const restricted = await open(url.toString());
    try { await expect(reverifyOwner(restricted, h.ids.finA, h.ids.machineA)).rejects.toThrow(/owner role/); }
    finally { await restricted.close(); }
  });
});
