import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { open } from '@playerone/store';
import { buildApi } from '../../../src/index.ts';
import { billOriginalityBlocker, lockOriginality, readOriginalityInventory, recordOriginalityAssessment, registerOriginality } from '../../../src/originality.ts';
import { applyEvent, attemptById } from '../../../src/payout/domain/attempts.ts';
import { loadBill, payBill } from '../../../src/payout/worker/batch.ts';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase, violates } from '../../../../store/test/db.ts';
import { auditRow, insertAttemptAs, seedAccount, seedBills, seedIdentity, seedPayout, uid } from './fixture.ts';
import { StubZaloPay } from './stub-client.ts';

useDatabase('originality');
describe.skipIf(!hasDb())('mandatory originality payment admission', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  async function setup() {
    const d = await db(), ids = await seedPayout(d), { bill1 } = await seedBills(d, ids);
    const account = await seedAccount(d, ids, 1);
    const [r] = await d.execute(sql`select r.ingest_id from bill_lines l join settlements s on s.id=l.settlement_id
      join episode_reviews r on r.id=s.episode_review_id where l.bill_id=${bill1} limit 1`);
    const ingestId = String(r!.ingest_id);
    const assess = async (status: 'complete' | 'failed' | 'unavailable', connection = d) => recordOriginalityAssessment(connection,
      { ingestId, inventory: (await readOriginalityInventory(connection, ingestId))!, policyVersion: 'segment-v1', status, evidence: { candidates: ['test-peer'] } });
    return { d, ids, bill1, account, ingestId, assess };
  }

  for (const status of ['failed', 'unavailable', 'complete'] as const) {
    it(`blocks uncleared ${status} on both rails even when optional risk holds are off`, async () => {
      const h = await setup();
      await h.assess(status);
      expect(await billOriginalityBlocker(h.d, h.bill1)).toBe('payout_originality_pending');
      for (const mode of ['api', 'manual'] as const) {
        await violates('payout_originality_pending', insertAttemptAs(h.d, h.ids, h.ids.finA,
          { billId: h.bill1, accountId: h.account, amountVnd: 2400, mode, manualReference: mode === 'manual' ? 'bank-test' : null }));
      }
      const [count] = await h.d.execute(sql`select count(*)::int as n from payout_attempts`);
      expect(count!.n).toBe(0);
    });
  }

  it('refuses both manual exports for an unpaid bill needing originality review', async () => {
    const h = await setup(); await h.assess('unavailable');
    const app = buildApi({ db: h.d, tokenSecret: 'originality-test' });
    try {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'HCM-01', secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: 'fin-hcm', secret: 'pw' } });
      const headers = { 'x-machine-token': `Bearer ${m.json().token}`, authorization: `Bearer ${o.json().token}` };
      for (const url of ['/api/payout/export/2026-08-17', '/api/settle/export.csv?period_start=2026-08-17&period_end=2026-08-24']) {
        const response = await app.inject({ method: 'GET', url, headers });
        expect(response.statusCode, response.body).toBe(409);
        expect(response.json().constraint).toBe('payout_originality_pending');
      }
    } finally { await app.close(); }
  });

  it('invalidates a previous clearance on new evidence, inventory, receipts and policy', async () => {
    const h = await setup();
    expect(await billOriginalityBlocker(h.d, h.bill1)).toBeNull();
    await h.d.execute(sql`update episode_files set sha256=repeat('c',64) where ingest_id=${h.ingestId}`);
    expect(await billOriginalityBlocker(h.d, h.bill1)).toBe('payout_originality_pending');
    await h.d.execute(sql`update episode_files set sha256=repeat('b',64) where ingest_id=${h.ingestId}`);
    expect(await billOriginalityBlocker(h.d, h.bill1)).toBeNull();
    await h.d.execute(sql`delete from cloud_verifications where ingest_id=${h.ingestId}`);
    expect(await billOriginalityBlocker(h.d, h.bill1)).toBe('payout_originality_pending');
    await violates('originality_media_unverified', h.assess('complete'));
    await h.assess('failed');
    expect(await billOriginalityBlocker(h.d, h.bill1)).toBe('payout_originality_pending');
  });

  it('refuses stale snapshot, incomplete human clearance, missing audit and review author', async () => {
    const h = await setup();
    await violates('originality_inventory_changed', recordOriginalityAssessment(h.d, {
      ingestId: h.ingestId, inventory: {}, policyVersion: 'segment-v1', status: 'complete', evidence: {} }));
    const failed = await h.assess('failed');
    const decide = (assessment: string, who = h.ids.finB) => h.d.execute(sql`insert into originality_decisions(id,assessment_id,decision,operator_id,reason)
      values (${uid()},${assessment},'cleared',${who},'Independent review of footage')`);
    await violates('originality_assessment_not_current', decide(failed.id));
    const complete = await h.assess('complete');
    await violates('originality_decision_unaudited', decide(complete.id));
    await violates('originality_reviewer_forbidden', decide(complete.id, h.ids.opA));
  });

  it('serializes an admission behind a newly committed incomplete assessment', async () => {
    const h = await setup(), other = await open(dbUrl());
    let pending: Promise<string> | undefined;
    try {
      await other.transaction(async (tx) => {
        await lockOriginality(tx);
        pending = insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: h.bill1, accountId: h.account, amountVnd: 2400 });
        // Poll PostgreSQL's wait graph, not a timing assertion.
        let waiting = false;
        for (let n = 0; n < 100 && !waiting; n++) {
          const [r] = await tx.execute(sql`select exists(select 1 from pg_locks where locktype='advisory' and not granted) as waiting`);
          waiting = r!.waiting === true;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await recordOriginalityAssessment(tx, { ingestId: h.ingestId, inventory: (await readOriginalityInventory(tx, h.ingestId))!,
          policyVersion: 'segment-v1', status: 'failed', evidence: { reason: 'decode unavailable' } });
      });
      await violates('payout_originality_pending', pending!);
    } finally { await pending?.catch(() => undefined); await other.close(); }
  });

  it('rechecks before dispatch and leaves the refused attempt created', async () => {
    const h = await setup();
    const id = await insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: h.bill1, accountId: h.account, amountVnd: 2400 });
    const attempt = (await attemptById(h.d, id))!;
    await h.assess('failed');
    await violates('payout_originality_pending', h.d.transaction((tx) => applyEvent(tx, attempt, { type: 'SUBMIT' })));
    expect((await attemptById(h.d, id))!.status).toBe('created');
  });

  it('allows submitted transfers to reconcile after a later assessment fails', async () => {
    const h = await setup();
    const id = await insertAttemptAs(h.d, h.ids, h.ids.finA, { billId: h.bill1, accountId: h.account, amountVnd: 2400 });
    const created = (await attemptById(h.d, id))!;
    await h.d.transaction((tx) => applyEvent(tx, created, { type: 'SUBMIT' }));
    await h.assess('failed');
    const submitted = (await attemptById(h.d, id))!;
    await h.d.transaction((tx) => applyEvent(tx, submitted, { type: 'POLL', status: 1 }));
    expect((await attemptById(h.d, id))!.status).toBe('succeeded');
  });

  it('refuses a second payable settlement for a changed ingest of the same episode', async () => {
    const h = await setup(), ingest = uid(), review = uid();
    await h.d.execute(sql`insert into episode_ingests select (jsonb_populate_record(null::episode_ingests,
      to_jsonb(i) || jsonb_build_object('ingest_id', ${ingest}::text))).*
      from episode_ingests i where i.ingest_id=${h.ingestId}`);
    await h.d.execute(sql`insert into episode_reviews select (jsonb_populate_record(null::episode_reviews,
      to_jsonb(r) || jsonb_build_object('id',${review}::text,'ingest_id',${ingest}::text,'verdict_id',${uid()}::text))).*
      from episode_reviews r where r.ingest_id=${h.ingestId}`);
    const insert = (tx: Pick<typeof h.d, 'execute'>) => tx.execute(sql`
      insert into settlements select (jsonb_populate_record(null::settlements,
        to_jsonb(s) || jsonb_build_object('id',${uid()}::text,'episode_review_id',${review}::text,'settlement_state','pending_settlement'))).*
      from settlements s join episode_reviews r on r.id=s.episode_review_id where r.ingest_id=${h.ingestId}`);
    await violates('settlements_episode_already_payable', insert(h.d));
    for (const isolation of ['repeatable read', 'serializable']) {
      await violates('originality_isolation', h.d.transaction(async tx => {
        await tx.execute(sql.raw(`set transaction isolation level ${isolation}`));
        await insert(tx);
      }));
    }
  });

  it('audits an evidence-specific human decision and permanently blocks confirmed reuse', async () => {
    const h = await setup(), app = Fastify();
    app.decorateRequest('actor', undefined);
    registerOriginality(app, h.d, async (req) => {
      req.actor = { machine: { kind: 'machine', uploadDeviceId: h.ids.machineA, uploadCentreId: h.ids.centreA },
        operator: { kind: 'operator', operatorId: h.ids.finA, uploadCentreId: h.ids.centreA } };
    });
    try {
      let a = await h.assess('complete');
      const decide = (id: string, decision: string) => app.inject({ method: 'POST', url: `/api/originality/assessments/${id}/decision`,
        payload: { decision, reason: 'Compared the matching segments against retained source footage.' } });
      let response = await decide(a.id, 'cleared');
      expect(response.statusCode, response.body).toBe(201);
      expect(await billOriginalityBlocker(h.d, h.bill1)).toBeNull();
      response = await decide(a.id, 'cleared');
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().constraint).toBe('originality_assessment_not_current');
      a = await h.assess('complete');
      response = await decide(a.id, 'reused');
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().parked).toHaveLength(1);
      const [s] = await h.d.execute(sql`select s.settlement_state, s.exception_reason from settlements s
        join episode_reviews r on r.id=s.episode_review_id where r.ingest_id=${h.ingestId}`);
      expect(s).toMatchObject({ settlement_state: 'exception', exception_reason: 'duplicate' });
      a = await h.assess('complete');
      response = await decide(a.id, 'cleared');
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().constraint).toBe('originality_reuse_confirmed');
      const limited = await recordOriginalityAssessment(h.d, { ingestId: h.ingestId,
        inventory: (await readOriginalityInventory(h.d, h.ingestId))!, policyVersion: 'segment-v1', status: 'failed',
        evidence: { reason: 'low_information', media_verified: true } });
      await h.d.execute(sql`update operators set role='administrator' where id=${h.ids.finA}`);
      response = await decide(limited.id, 'accepted_unassessable');
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().constraint).toBe('originality_reuse_confirmed');
      const history = await app.inject({ method: 'GET', url: `/api/originality/ingests/${h.ingestId}` });
      expect(history.json().payable).toBe(false);
      const [audit] = await h.d.execute(sql`select count(*)::int as n from audit_events where action='originality.decide' and after->>'evidence_digest' is not null`);
      expect(audit!.n).toBe(2);
    } finally { await app.close(); }
  });

  it('resolves raw-phone object keys and ignores identical retry IDs and declaration order', async () => {
    const h = await setup(), upload = uid();
    const files = [{ relative_path: 'video.mp4', bytes: 100, sha256: 'b'.repeat(64) },
      { relative_path: 'manifest.json', bytes: 20, sha256: 'c'.repeat(64) }];
    const [i] = await h.d.execute(sql`select episode_id from episode_ingests where ingest_id=${h.ingestId}`);
    await h.d.execute(sql`update episode_ingests set transport_extra_files=null where ingest_id=${h.ingestId}`);
    const putUpload = (id: string, state: string, inventory: typeof files) => h.d.execute(sql`
      insert into collector_uploads(id,collector_id,collection_session_id,device_serial,episode_id,ingest_id,
        source_basename,file_count,total_bytes,measured,state,completed_at,declared_files)
      values (${id},${h.ids.collector1},${h.ids.session1},'AZER76400FE',${i!.episode_id},${h.ingestId},
        'ego_AZER76400FE_20260813_072310',2,120,false,${state},${state === 'registered' ? null : new Date().toISOString()}::timestamptz,${JSON.stringify(inventory)}::jsonb)`);
    await putUpload(upload, 'ingested', files);
    await h.d.execute(sql`delete from cloud_verifications where ingest_id=${h.ingestId}`);
    for (const f of files) await h.d.execute(sql`insert into cloud_verifications(object_key,episode_id,ingest_id,sha256)
      values (${'episodes/' + i!.episode_id + '/' + upload + '/' + f.relative_path},${i!.episode_id},${h.ingestId},${f.sha256})`);
    const before = await readOriginalityInventory(h.d, h.ingestId);
    await h.assess('complete');
    await putUpload(uid(), 'registered', [...files].reverse());
    expect(await readOriginalityInventory(h.d, h.ingestId)).toEqual(before);
    const [key] = await h.d.execute(sql`select originality_file_key(${h.ingestId}::uuid,'video.mp4',${files[0]!.sha256}) as key`);
    expect(key!.key).toBe(`episodes/${i!.episode_id}/${upload}/video.mp4`);
    await putUpload(uid(), 'registered', [files[0]!, { ...files[1]!, sha256: 'd'.repeat(64) }]);
    expect(await readOriginalityInventory(h.d, h.ingestId)).not.toEqual(before);
    await violates('originality_media_unverified', h.assess('complete'));
  });

  for (const reason of ['insufficient_samples', 'low_information', 'budget_exceeded']) {
    it(`requires an audited administrator acceptance for verified ${reason}`, async () => {
      const h = await setup();
      const a = await recordOriginalityAssessment(h.d, { ingestId: h.ingestId,
        inventory: (await readOriginalityInventory(h.d, h.ingestId))!, policyVersion: 'segment-v1',
        status: 'failed', evidence: { reason, media_verified: true } });
      const decide = () => h.d.transaction(async (tx) => {
        const id = uid(), note = 'Examined the verified full recording despite algorithm limitation.';
        await tx.execute(sql`insert into originality_decisions(id,assessment_id,decision,operator_id,reason)
          values (${id},${a.id},'accepted_unassessable',${h.ids.finB},${note})`);
        await auditRow(tx, h.ids, { action: 'originality.decide', targetTable: 'originality_decisions', targetId: id,
          operatorId: h.ids.finB, reason: note });
      });
      await violates('originality_reviewer_forbidden', decide());
      await h.d.execute(sql`update operators set role='administrator' where id=${h.ids.finB}`);
      await decide();
      expect(await billOriginalityBlocker(h.d, h.bill1)).toBeNull();
    });
  }

  for (const evidence of [{ reason: 'low_information' }, { reason: 'media_unavailable', media_verified: true },
    { reason: 'candidate_or_match_budget', media_verified: true }, { reason: 'incomplete_media_coverage', media_verified: true },
    { reason: 'legacy_client_measurement_requires_recovery', media_verified: true }]) {
    it(`does not permit administrator acceptance of ${JSON.stringify(evidence)}`, async () => {
      const h = await setup();
      await h.d.execute(sql`update operators set role='administrator' where id=${h.ids.finB}`);
      const a = await recordOriginalityAssessment(h.d, { ingestId: h.ingestId,
        inventory: (await readOriginalityInventory(h.d, h.ingestId))!, policyVersion: 'segment-v1', status: 'unavailable', evidence });
      await violates('originality_assessment_not_current', h.d.execute(sql`
        insert into originality_decisions(id,assessment_id,decision,operator_id,reason)
        values (${uid()},${a.id},'accepted_unassessable',${h.ids.finB},'Administrator cannot waive incomplete provenance')`));
    });
  }

  it('never accepts an algorithm limitation when its cloud receipt is missing', async () => {
    const h = await setup();
    await h.d.execute(sql`update operators set role='administrator' where id=${h.ids.finB}`);
    const a = await recordOriginalityAssessment(h.d, { ingestId: h.ingestId,
      inventory: (await readOriginalityInventory(h.d, h.ingestId))!, policyVersion: 'segment-v1', status: 'failed',
      evidence: { reason: 'low_information', media_verified: true } });
    await h.d.execute(sql`delete from cloud_verifications where ingest_id=${h.ingestId}`);
    await violates('originality_assessment_not_current', h.d.execute(sql`
      insert into originality_decisions(id,assessment_id,decision,operator_id,reason)
      values (${uid()},${a.id},'accepted_unassessable',${h.ids.finB},'Administrator cannot waive missing cloud bytes')`));
  });

  it('returns a named dispatch refusal with zero provider calls if evidence changes after reservation', async () => {
    const h = await setup(), client = new StubZaloPay();
    // Database fault injection at the exact reserve/dispatch seam, not a fake money path.
    await h.d.execute(sql.raw(`create function test_originality_after_reserve() returns trigger language plpgsql as $$
      begin insert into originality_assessments(id,ingest_id,inventory,policy_version,status,evidence)
        values(gen_random_uuid(),'${h.ingestId}',originality_inventory('${h.ingestId}'),'segment-v1','unavailable','{"reason":"new_matching_ingest"}');
        return null; end $$;
      create trigger test_originality_after_reserve after insert on payout_attempts for each row execute function test_originality_after_reserve()`));
    try {
      const actor = { machine: { kind: 'machine' as const, uploadDeviceId: h.ids.machineA, uploadCentreId: h.ids.centreA },
        operator: { kind: 'operator' as const, operatorId: h.ids.finA, uploadCentreId: h.ids.centreA } };
      const result = await payBill(h.d, client, actor, (await loadBill(h.d, h.bill1))!, { holdsEnabled: false });
      expect(result).toMatchObject({ kind: 'refused', constraint: 'payout_originality_pending' });
      expect(client.calls.transferFund).toBe(0);
      const [row] = await h.d.execute(sql`select status from payout_attempts where bill_id=${h.bill1}`);
      expect(row!.status).toBe('created');
    } finally {
      await h.d.execute(sql`drop trigger test_originality_after_reserve on payout_attempts`);
      await h.d.execute(sql`drop function test_originality_after_reserve()`);
    }
  });

  it('requires independently audited identity mapping and invalidates a clearance corrected to self-collection', async () => {
    const h = await setup();
    await violates('originality_identity_attestation_required', h.d.execute(sql`
      update operators set collector_id=${h.ids.collector1} where id=${h.ids.finB}`));
    expect(await billOriginalityBlocker(h.d, h.bill1)).toBeNull();
    await seedIdentity(h.d, h.ids, h.ids.finB, h.ids.collector1);
    expect(await billOriginalityBlocker(h.d, h.bill1)).toBe('payout_originality_pending');
    // A later session assignment must not erase the historic bill/claim recipient.
    await h.d.execute(sql`update episodes set collection_session_id=${h.ids.session2}
      where episode_id=(select episode_id from episode_ingests where ingest_id=${h.ingestId})`);
    expect(await billOriginalityBlocker(h.d, h.bill1)).toBe('payout_originality_pending');
    const a = await h.assess('complete');
    await violates('originality_identity_unverified_or_self', h.d.execute(sql`
      insert into originality_decisions(id,assessment_id,decision,operator_id,reason)
      values(${uid()},${a.id},'cleared',${h.ids.finB},'A collector cannot clear their own recording')`));
    await h.d.execute(sql`update operators set role='finance' where id=${h.ids.opA}`);
    await violates('originality_identity_unverified_or_self', h.d.execute(sql`
      insert into originality_decisions(id,assessment_id,decision,operator_id,reason)
      values(${uid()},${a.id},'cleared',${h.ids.opA},'Unknown identity cannot clear a recording')`));
  });

  it('allows only administrators to confirm verified reuse candidates after incomplete matching', async () => {
    const h = await setup();
    const a = await recordOriginalityAssessment(h.d, { ingestId: h.ingestId,
      inventory: (await readOriginalityInventory(h.d,h.ingestId))!, policyVersion:'segment-v1',status:'unavailable',
      evidence:{ reason:'new_matching_ingest', media_verified:true, matching_ingests:[{ingest_id:uid(),method:'frame_segments'}] } });
    const decide = () => h.d.transaction(async tx => {
      const id=uid(), reason='Administrator confirmed the reused segment.';
      await tx.execute(sql`insert into originality_decisions(id,assessment_id,decision,operator_id,reason)
        values(${id},${a.id},'reused',${h.ids.finB},${reason})`);
      await auditRow(tx,h.ids,{action:'originality.decide',targetTable:'originality_decisions',targetId:id,operatorId:h.ids.finB,reason});
    });
    await violates('originality_assessment_not_current',decide());
    await h.d.execute(sql`update operators set role='administrator' where id=${h.ids.finB}`);
    await decide();
    expect(await billOriginalityBlocker(h.d,h.bill1)).toBe('payout_originality_pending');
  });
});
