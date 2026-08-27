import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveEpisodeId, type EpisodeRecord } from '@playerone/contracts';
import { open, storeEpisode } from '@playerone/store';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase, violates } from '../../../store/test/db.ts';
import type { CounterActor } from '../../src/actor.ts';
import { buildApi } from '../../src/index.ts';
import { loadTuning, retuneSignal, seedRiskSignals } from '../../src/risk/catalogue.ts';
import { RiskEngine, batchId, currentFlags } from '../../src/risk/engine.ts';
import { billHold, clearHold, currentHolds } from '../../src/risk/holds.ts';
import { falsePositiveReport } from '../../src/risk/report.ts';
import { registerRisk } from '../../src/risk/routes.ts';
import { tick } from '../../src/risk/worker.ts';
import { episodeRecord } from '../fixtures.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('risk_engine');

/**
 * The engine end to end, over a planted corpus: every abuse the brief lists
 * that needs no media fires its own signal and no other; a clean corpus of
 * thirty collectors stays clear; the same input evaluates the same way twice;
 * a hold is raised only when holds are on, is cleared with a reason, and is
 * not raised again on evidence the operator already saw.
 *
 * Agent B's `payout_accounts` and `payout_events` are created here from the
 * §2.1 contract DDL and B's 0012 shape, `if not exists`, so this file runs
 * without B's branch and unchanged with it. Created AFTER the migration, on
 * purpose: that is the shape production will have, and it is what proves the
 * `playerone_risk` role can read a table that did not exist when it was
 * granted SELECT on everything.
 */

const uid = () => randomUUID();
const T0 = Date.parse('2026-08-10T02:00:00.000Z'); // 09:00 in Ho Chi Minh City
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(Math.ceil(Date.now() / HOUR) * HOUR + 2 * HOUR);
const LATER = new Date(NOW.getTime() + HOUR);

type World = {
  centre: string;
  machine: string;
  operator: string;
  finance: string;
  reviewer: string;
  deviceType: string;
  scenario: string;
  task: string;
};

async function payoutTables() {
  const d = await db();
  await d.execute(sql`
    create table if not exists payout_accounts (
      id uuid primary key,
      collector_id uuid not null references collectors(id),
      method text not null check (method in ('WALLET','BANK_ACCOUNT','BANK_CARD')),
      phone text,
      bank_code text,
      account_no_last4 text,
      declared_name text not null,
      verified_name text,
      m_u_id text,
      verify_status text not null check (verify_status in ('unverified','verified','name_mismatch','no_wallet','locked','kyc_limit','error')),
      verified_at timestamptz,
      is_current boolean not null default false,
      created_at timestamptz not null default now(),
      created_by uuid not null references operators(id)
    )`);
  await d.execute(sql`create unique index if not exists payout_accounts_current_key on payout_accounts (collector_id) where is_current`);
  // Agent B's shape (0012), so this file runs the same against the real table.
  await d.execute(sql`
    create table if not exists payout_events (
      id bigserial primary key,
      kind text not null,
      collector_id uuid,
      payout_account_id uuid,
      bill_id uuid,
      payout_attempt_id uuid,
      evidence jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null default now()
    )`);
}

async function world(): Promise<World> {
  const d = await db();
  const w: World = { centre: uid(), machine: uid(), operator: uid(), finance: uid(), reviewer: uid(), deviceType: uid(), scenario: uid(), task: uid() };
  await d.execute(sql`insert into upload_centres (id, region, name, status) values (${w.centre}, 'HCM', 'District 7', 'active')`);
  await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status) values (${w.machine}, ${w.centre}, 'HCM-01', 'active')`);
  await d.execute(
    sql`insert into operators (id, upload_centre_id, external_ref, role) values (${w.operator}, ${w.centre}, 'op-hcm', 'centre_operator'), (${w.finance}, ${w.centre}, 'fin-01', 'finance'), (${w.reviewer}, null, 'pax-01', 'reviewer')`,
  );
  await d.execute(sql`insert into device_types (id, code, generation) values (${w.deviceType}, 'ego_headset', 'gen1')`);
  await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${w.scenario}, 'home', 'low')`);
  await d.execute(sql`insert into tasks (id, name, type, unit_price, max_concurrent_claimants, status) values (${w.task}, 'housework', 'kitchen', 1200, 50, 'published')`);
  return w;
}

type Collector = { id: string; ref: string; device: string; serial: string; session: string; handover: string };

let serialSeq = 0;
async function collector(w: World, ref: string): Promise<Collector> {
  const d = await db();
  serialSeq += 1;
  const c: Collector = { id: uid(), ref, device: uid(), serial: `SYN${String(serialSeq).padStart(8, '0')}`, session: uid(), handover: uid() };
  await d.execute(sql`insert into collectors (id, external_ref, status) values (${c.id}, ${ref}, 'qualified')`);
  await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${c.device}, ${w.deviceType}, ${c.serial}, 'active')`);
  await d.execute(
    sql`insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time) values (${c.handover}, ${c.id}, ${c.device}, ${'CARD-' + ref}, ${w.centre}, ${w.operator}, ${new Date(T0).toISOString()})`,
  );
  await d.execute(
    sql`insert into collection_sessions (id, task_id, collector_id, scenario_id, handover_id, others_in_frame, sensitive_info_present, session_origin) values (${c.session}, ${w.task}, ${c.id}, ${w.scenario}, ${c.handover}, false, false, 'handover')`,
  );
  return c;
}

type EpisodeOpts = { startMs: number; measured: number; declared?: number | null; fingerprint?: string; files?: { relative_path: string; bytes: number; sha256: string }[]; audio?: boolean };

/** One resolved episode of a collector, written through the store as the counter would. */
async function episode(c: Collector, o: EpisodeOpts): Promise<{ id: string; ingestId: string; record: EpisodeRecord }> {
  const d = await db();
  const stamp = new Date(o.startMs);
  const basename = `ego_${c.serial}_${stamp.toISOString().slice(0, 10).replaceAll('-', '')}_${stamp.toISOString().slice(11, 19).replaceAll(':', '')}`;
  const record = episodeRecord({ basename, measured: o.measured, declared: o.declared === undefined ? o.measured * 1.34 : o.declared, serial: c.serial });
  const startUs = String(BigInt(o.startMs) * 1000n);
  const endUs = String(BigInt(o.startMs + o.measured * 1000) * 1000n);
  record.timing = { ...record.timing, usable_start_us: startUs, usable_end_us: endUs };
  record.streams[0] = { ...record.streams[0]!, first_pts_us: startUs, last_pts_us: endUs };
  if (o.audio !== false) {
    record.streams.push({ role: 'audio', parts: [{ file: `${basename}_audio.wav`, bytes: 64, sha256: 'c'.repeat(64) }], pts_source: 'sidecar', first_pts_us: startUs, last_pts_us: endUs, sample_count: 16000 * o.measured, span_s: o.measured, nominal_rate_hz: 16000 });
  }
  record.content_fingerprint = o.fingerprint ?? randomBytes(32).toString('hex');
  if (o.files) record.source_files = o.files;
  const stored = await storeEpisode(d, record);
  await d.execute(
    sql`update episodes set collection_session_id = ${c.session}, resolution_state = 'resolved', resolution_method = 'manual', upload_path = 'C' where episode_id = ${stored.episodeId}`,
  );
  return { id: stored.episodeId, ingestId: stored.ingestId!, record };
}

/** A decided review of an episode, worth `measured` seconds at the task price. */
async function review(w: World, ep: { id: string; ingestId: string }, o: { measured: number; state?: 'pass' | 'partial_pass' | 'fail'; timeToVerdictS?: number; reviewedAt?: Date; reviewer?: string }): Promise<string> {
  const d = await db();
  const id = uid();
  const state = o.state ?? 'pass';
  const effective = state === 'fail' ? 0 : o.measured;
  const at = o.reviewedAt ?? new Date(T0 + 3 * DAY);
  await d.execute(
    sql`insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, effective_duration_s, review_state, reviewer_ref, reviewed_at, verdict_id, claimed_at, lease_expires_at, time_to_verdict_s)
         values (${id}, ${ep.id}, ${ep.ingestId}, ${o.measured.toFixed(6)}, ${effective.toFixed(6)}, ${state}, ${o.reviewer ?? w.reviewer}, ${at.toISOString()}, ${uid()}, ${at.toISOString()}, ${new Date(at.getTime() + HOUR).toISOString()}, ${o.timeToVerdictS ?? o.measured * 1.5})`,
  );
  return id;
}

async function settlement(w: World, reviewId: string, measured: number): Promise<string> {
  const d = await db();
  const id = uid();
  const minutes = (measured / 60).toFixed(6);
  const amount = ((measured / 60) * 1200).toFixed(4);
  await d.execute(
    sql`insert into settlements (id, episode_review_id, task_id, unit_price, effective_minutes, amount, settlement_state) values (${id}, ${reviewId}, ${w.task}, 1200, ${minutes}, ${amount}, 'pending_settlement')`,
  );
  return id;
}

async function bill(c: Collector, settlements: string[], o: { periodStart?: Date; periodEnd?: Date } = {}): Promise<string> {
  const d = await db();
  const id = uid();
  const start = o.periodStart ?? new Date(T0);
  const end = o.periodEnd ?? new Date(T0 + 7 * DAY);
  await d.transaction(async (tx) => {
    const ids = sql.join(settlements.map((s) => sql`${s}::uuid`), sql`, `);
    const [sum] = (await tx.execute(sql`
      select coalesce(sum(amount), 0)::text as total from settlements where id in (${ids})
    `)) as unknown as { total: string }[];
    await tx.execute(sql`
      insert into bills (id, collector_id, period_start, period_end, currency, total)
      values (${id}, ${c.id}, ${start.toISOString()}, ${end.toISOString()}, 'VND', ${sum!.total}::numeric)
    `);
    for (const s of settlements) {
      await tx.execute(sql`insert into bill_lines (bill_id, settlement_id) values (${id}, ${s})`);
      await tx.execute(sql`update settlements set settlement_state = 'bill_generated' where id = ${s}`);
    }
  });
  return id;
}

/** A collector's whole money path for one episode: episode, review, settlement, bill. */
async function billedEpisode(w: World, c: Collector, o: EpisodeOpts & { reviewer?: string; timeToVerdictS?: number }): Promise<{ episodeId: string; billId: string }> {
  const ep = await episode(c, o);
  const r = await review(w, ep, { measured: o.measured, reviewer: o.reviewer, timeToVerdictS: o.timeToVerdictS });
  const s = await settlement(w, r, o.measured);
  const day = Math.floor(o.startMs / DAY) * DAY;
  const b = await bill(c, [s], { periodStart: new Date(day), periodEnd: new Date(day + 7 * DAY) });
  return { episodeId: ep.id, billId: b };
}

type AccountOpts = { method?: 'WALLET' | 'BANK_ACCOUNT'; phone?: string | null; bankCode?: string | null; last4?: string | null; declared?: string; verified?: string | null; muid?: string | null; status?: string; verifiedAt?: Date | null; createdAt?: Date };

async function account(w: World, c: Collector, o: AccountOpts = {}): Promise<string> {
  const d = await db();
  const id = uid();
  const method = o.method ?? 'WALLET';
  await d.execute(sql`update payout_accounts set is_current = false where collector_id = ${c.id}`);
  await d.execute(
    sql`insert into payout_accounts (id, collector_id, method, phone, bank_code, account_no_last4, declared_name, verified_name, m_u_id, verify_status, verified_at, is_current, created_at, created_by)
         values (${id}, ${c.id}, ${method}, ${o.phone === undefined ? (method === 'WALLET' ? `09${c.ref.replace(/\D/g, '').padStart(8, '0')}` : null) : o.phone},
                 ${o.bankCode ?? null}, ${o.last4 ?? null}, ${o.declared ?? `NGUYEN ${c.ref.toUpperCase()}`}, ${o.verified === undefined ? `NGUYEN ${c.ref.toUpperCase()}` : o.verified},
                 ${o.muid === undefined ? (method === 'WALLET' ? `mu-${c.ref}` : null) : o.muid}, ${o.status ?? 'verified'}, ${o.verifiedAt === undefined ? new Date(T0).toISOString() : (o.verifiedAt?.toISOString() ?? null)}, true, ${(o.createdAt ?? new Date(T0 - 30 * DAY)).toISOString()}, ${w.operator})`,
  );
  return id;
}

async function audit(w: World, action: string, table: string, targetId: string, operatorId: string, at: Date): Promise<void> {
  const d = await db();
  await d.execute(
    sql`insert into audit_events (occurred_at, action, target_table, target_id, operator_id, upload_device_id, upload_centre_id, actor_role) values (${at.toISOString()}, ${action}, ${table}, ${targetId}, ${operatorId}, ${w.machine}, ${w.centre}, 'operator')`,
  );
}

const signals = (s: { flags: { signalId: string }[] }): string[] => s.flags.map((f) => f.signalId).sort();

describe.skipIf(!hasDb())('the risk engine', () => {
  let w: World;
  let engine: RiskEngine;

  beforeAll(async () => {
    await db();
    await payoutTables();
  }, 120_000);

  beforeEach(async () => {
    await truncate();
    await seedRiskSignals(await db());
    w = await world();
    engine = new RiskEngine(await db(), { now: () => NOW });
  });
  afterAll(closeDb);

  describe('identity, over the payout accounts contract', () => {
    it('a verified collector with a unique destination is clear', async () => {
      const c = await collector(w, 'c-0001');
      await account(w, c);
      const r = await engine.evaluateCollector(c.id);
      expect(signals(r)).toEqual([]);
      expect(r.band).toBe('clear');
      expect(r.score).toBe(0);
      expect(r.tools).toEqual({});
    });

    it('one phone on two collectors fires PHONE_SHARED on both, and nothing else', async () => {
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      const c = await collector(w, 'c-0003');
      await account(w, a, { phone: '0901234567' });
      await account(w, b, { phone: '0901234567' });
      await account(w, c);
      const ra = await engine.evaluateCollector(a.id);
      expect(signals(ra)).toEqual(['IDENT.PHONE_SHARED']);
      expect(ra.band).toBe('hold');
      expect(ra.flags[0]!.evidence).toMatchObject({ phone_masked: '090•••••67', count: 1, other_collector_refs: ['c-0002'] });
      expect(signals(await engine.evaluateCollector(b.id))).toEqual(['IDENT.PHONE_SHARED']);
      expect(signals(await engine.evaluateCollector(c.id))).toEqual([]);
    });

    it('one bank account on two collectors fires ACCOUNT_SHARED; a shared wallet id fires MUID_SHARED', async () => {
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      await account(w, a, { method: 'BANK_ACCOUNT', bankCode: 'VCB', last4: '4321' });
      await account(w, b, { method: 'BANK_ACCOUNT', bankCode: 'VCB', last4: '4321' });
      expect(signals(await engine.evaluateCollector(a.id))).toEqual(['IDENT.ACCOUNT_SHARED']);
      const c = await collector(w, 'c-0003');
      const e = await collector(w, 'c-0004');
      await account(w, c, { muid: 'mu-shared' });
      await account(w, e, { muid: 'mu-shared' });
      const rc = await engine.evaluateCollector(c.id);
      expect(signals(rc)).toEqual(['IDENT.MUID_SHARED']);
      expect(rc.flags[0]!.evidence['other_collector_refs']).toEqual(['c-0004']);
    });

    it('the name ZaloPay returned differing from the declared one fires NAME_MISMATCH only', async () => {
      const c = await collector(w, 'c-0001');
      await account(w, c, { declared: 'Nguyễn Văn A', verified: 'NGUYEN VAN B', status: 'name_mismatch' });
      const r = await engine.evaluateCollector(c.id);
      expect(signals(r)).toEqual(['IDENT.NAME_MISMATCH']);
      expect(r.band).toBe('review');
    });

    it('counts -406 across the account history and the payout_events table', async () => {
      const c = await collector(w, 'c-0001');
      await account(w, c, { status: 'kyc_limit', verified: null });
      await account(w, c, { status: 'kyc_limit', verified: null });
      expect(signals(await engine.evaluateCollector(c.id))).toEqual([]);
      const d = await db();
      await d.execute(sql`insert into payout_events (collector_id, kind, evidence) values (${c.id}, 'IDENT.KYC_LIMIT', '{"sub_return_code": -406}'::jsonb)`);
      const r = await engine.evaluateCollector(c.id);
      expect(signals(r)).toEqual(['IDENT.KYC_LIMIT_REPEATED']);
      expect(r.flags[0]!.evidence['occurrences']).toBe(3);
    });

    it('a payout account changed in the last week of a bill’s period fires ACCOUNT_CHANGED_LATE on the bill', async () => {
      const c = await collector(w, 'c-0001');
      await account(w, c, { createdAt: new Date(T0 - 30 * DAY) });
      const { billId } = await billedEpisode(w, c, { startMs: T0 + 3 * HOUR, measured: 600 });
      await account(w, c, { phone: '0909999999', muid: 'mu-new', createdAt: new Date(Math.floor((T0 + 3 * HOUR) / DAY) * DAY + 6 * DAY) });
      const r = await engine.evaluateBill(billId);
      expect(signals(r)).toEqual(['IDENT.ACCOUNT_CHANGED_LATE']);
      expect(r.flags[0]!.evidence['days_before_end']).toBe(1);
      expect(r.hold).toBeNull();
    });
  });

  describe('volume and content, from the store', () => {
    it('more than twelve hours in one local day fires HOURS_PER_DAY only', async () => {
      const c = await collector(w, 'c-0001');
      await account(w, c);
      for (let i = 0; i < 4; i++) await episode(c, { startMs: T0 + i * 3.5 * HOUR, measured: 3.25 * 3600 });
      const r = await engine.evaluateCollector(c.id);
      expect(signals(r)).toEqual(['VOL.HOURS_PER_DAY']);
      expect(r.flags[0]!.evidence).toMatchObject({ day: '2026-08-10', hours: 13, episodes: 4 });
    });

    it('two episodes that overlap fire NO_GAP only', async () => {
      const c = await collector(w, 'c-0001');
      await account(w, c);
      await episode(c, { startMs: T0, measured: 3600 });
      await episode(c, { startMs: T0 + 30 * 60_000, measured: 600 });
      const r = await engine.evaluateCollector(c.id);
      expect(signals(r)).toEqual(['VOL.NO_GAP']);
      expect(r.flags[0]!.evidence['overlap_s']).toBe(1800);
    });

    it('the same content fingerprint on two episodes fires NEAR_DUPLICATE on both, naming the other collector', async () => {
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      const fp = 'f'.repeat(64);
      const ea = await episode(a, { startMs: T0, measured: 600, fingerprint: fp });
      const eb = await episode(b, { startMs: T0 + DAY, measured: 600, fingerprint: fp });
      const ra = await engine.evaluateEpisode(ea.id);
      expect(signals(ra)).toEqual(['CONT.NEAR_DUPLICATE']);
      expect(ra.flags[0]!.evidence).toMatchObject({ other_episode_id: eb.id, other_collector_ref: 'c-0002', method: 'content_fingerprint' });
      expect(ra.band).toBe('hold');
      expect(ra.tools['media']).toMatch(/not configured/);
      // Two empty sessions share the sha256 of nothing and are not duplicates of each other.
      const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const e1 = await episode(a, { startMs: T0 + 2 * DAY, measured: 1, fingerprint: empty });
      await episode(b, { startMs: T0 + 3 * DAY, measured: 1, fingerprint: empty });
      expect(signals(await engine.evaluateEpisode(e1.id))).toEqual([]);
    });

    it('a shared media file digest fires NEAR_DUPLICATE, a shared calibration file does not', async () => {
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      const media = { relative_path: 'x_camera_left_part0001.mp4', bytes: 1_000_000, sha256: '1'.repeat(64) };
      const calib = { relative_path: 'x_calibration_camera.yaml', bytes: 300, sha256: '2'.repeat(64) };
      const ea = await episode(a, { startMs: T0, measured: 600, fingerprint: 'a1'.repeat(32), files: [media, calib] });
      await episode(b, { startMs: T0 + DAY, measured: 600, fingerprint: 'b1'.repeat(32), files: [{ ...media, relative_path: 'y_camera_left_part0001.mp4' }, calib] });
      const r = await engine.evaluateEpisode(ea.id);
      expect(signals(r)).toEqual(['CONT.NEAR_DUPLICATE']);
      expect(r.flags[0]!.evidence).toMatchObject({ method: 'file_digest', file: 'y_camera_left_part0001.mp4' });
      const ec = await episode(a, { startMs: T0 + 2 * DAY, measured: 600, fingerprint: 'c1'.repeat(32), files: [calib] });
      expect(signals(await engine.evaluateEpisode(ec.id))).toEqual([]);
    });

    it('flags a manifest ratio that deviates from the device’s own baseline, not the known 34% overstatement', async () => {
      const c = await collector(w, 'c-0001');
      const normal = [];
      for (let i = 0; i < 6; i++) normal.push(await episode(c, { startMs: T0 + i * DAY, measured: 600, declared: 600 * 1.34 }));
      const odd = await episode(c, { startMs: T0 + 7 * DAY, measured: 600, declared: 1200 });
      expect(signals(await engine.evaluateEpisode(normal[0]!.id))).toEqual([]);
      const r = await engine.evaluateEpisode(odd.id);
      expect(signals(r)).toEqual(['CONT.PTS_MANIFEST_DELTA']);
      expect(r.flags[0]!.evidence).toMatchObject({ ratio: 2, baseline_ratio: 1.34, baseline_episodes: 6, baseline_source: 'device' });
    });

    it('an episode with no audio stream fires AUDIO_ABSENT for a task that expects sound', async () => {
      const c = await collector(w, 'c-0001');
      const e = await episode(c, { startMs: T0, measured: 600, audio: false });
      const r = await engine.evaluateEpisode(e.id);
      expect(signals(r)).toEqual(['CONT.AUDIO_ABSENT']);
      expect(r.flags[0]!.evidence).toMatchObject({ reason: 'no_stream', task_type: 'kitchen' });
    });
  });

  describe('reviewers and operators', () => {
    it('a pass recorded faster than the episode runs fires REVIEW_TOO_FAST on the episode', async () => {
      const c = await collector(w, 'c-0001');
      const e = await episode(c, { startMs: T0, measured: 600 });
      await review(w, e, { measured: 600, timeToVerdictS: 20 });
      const r = await engine.evaluateEpisode(e.id);
      expect(signals(r)).toEqual(['OPS.REVIEW_TOO_FAST']);
      expect(r.flags[0]!.evidence).toMatchObject({ reviewer_ref: 'pax-01', time_to_verdict_s: 20, measured_duration_s: 600 });
    });

    it('the operator who created the collector paying the bill fires SELF_DEALING on the bill', async () => {
      const c = await collector(w, 'c-0001');
      await account(w, c);
      const { billId } = await billedEpisode(w, c, { startMs: T0, measured: 600 });
      await audit(w, 'collector.create', 'collectors', c.id, w.operator, new Date(T0 - 40 * DAY));
      await audit(w, 'bill.pay', 'bills', billId, w.finance, new Date(T0 + 8 * DAY));
      expect(signals(await engine.evaluateBill(billId))).toEqual([]);
      await audit(w, 'bill.pay', 'bills', billId, w.operator, new Date(T0 + 9 * DAY));
      const r = await engine.evaluateBill(billId);
      expect(signals(r)).toEqual(['OPS.SELF_DEALING']);
      expect(r.flags[0]!.evidence).toMatchObject({ operator_ref: 'op-hcm', paid_action: 'bill.pay' });
    });

    it('one operator handling almost all of a collector’s bills, while others pay bills, fires CONCENTRATION', async () => {
      const c = await collector(w, 'c-0001');
      await account(w, c);
      const other = await collector(w, 'c-0002');
      const bills: string[] = [];
      for (let i = 0; i < 5; i++) bills.push((await billedEpisode(w, c, { startMs: T0 + i * DAY, measured: 600 })).billId);
      for (const b of bills) await audit(w, 'bill.pay', 'bills', b, w.operator, new Date(T0 + 8 * DAY));
      expect(signals(await engine.evaluateCollector(c.id))).toEqual([]);
      const { billId: theirs } = await billedEpisode(w, other, { startMs: T0, measured: 600 });
      await audit(w, 'bill.pay', 'bills', theirs, w.finance, new Date(T0 + 8 * DAY));
      const r = await engine.evaluateCollector(c.id);
      expect(signals(r)).toEqual(['OPS.CONCENTRATION']);
      expect(r.flags[0]!.evidence).toMatchObject({ operator_ref: 'op-hcm', share: 1, events: 5, operators: 2 });
    });

    it('a reviewer far from the others’ approval rate fires APPROVAL_OUTLIER on the batch', async () => {
      const d = await db();
      const c = await collector(w, 'c-0001');
      const reviewers = [w.reviewer, uid(), uid(), uid()];
      for (const r of reviewers.slice(1)) await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role) values (${r}, null, ${'pax-' + r.slice(0, 4)}, 'reviewer')`);
      let k = 0;
      for (const [i, rv] of reviewers.entries()) {
        for (let j = 0; j < 20; j++) {
          const e = await episode(c, { startMs: T0 + (k++) * 20 * 60_000, measured: 60 });
          // Three reviewers pass 70%; pax-01 passes everything.
          const state = i === 0 || j < 14 ? 'pass' : 'fail';
          await review(w, e, { measured: 60, state, reviewer: rv, reviewedAt: new Date(T0 + DAY) });
        }
      }
      const r = await engine.evaluateBatch(new Date(T0), new Date(T0 + 7 * DAY));
      expect(signals(r)).toEqual(['OPS.APPROVAL_OUTLIER']);
      expect(r.flags[0]!.evidence).toMatchObject({ reviewer_ref: 'pax-01', approval_rate: 1, cohort_median: 0.7, decided: 20 });
      expect(r.subjectId).toBe(batchId(new Date(T0), new Date(T0 + 7 * DAY)));
    });
  });

  describe('runs, determinism, and what the console reads', () => {
    it('evaluates the same input to the same flags, twice', async () => {
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      await account(w, a, { phone: '0901234567', declared: 'Nguyễn Văn A', verified: 'NGUYEN VAN B', status: 'name_mismatch' });
      await account(w, b, { phone: '0901234567' });
      await episode(a, { startMs: T0, measured: 3600 });
      await episode(a, { startMs: T0 + 1800_000, measured: 600 });
      const once = await engine.evaluateCollector(a.id);
      const twice = await engine.evaluateCollector(a.id);
      const strip = (s: typeof once) => s.flags.map((f) => ({ signalId: f.signalId, points: f.points, severity: f.severity, thresholdVersion: f.thresholdVersion, evidence: f.evidence }));
      expect(strip(twice)).toEqual(strip(once));
      expect(signals(once)).toEqual(['IDENT.NAME_MISMATCH', 'IDENT.PHONE_SHARED', 'VOL.NO_GAP']);
      expect(once.score).toBe(100);
      expect(twice.runId).not.toBe(once.runId);
      // Every run wrote its marker, and only the latest run is current.
      const d = await db();
      const [n] = (await d.execute(sql`select count(*)::int as n from risk_flags where subject_id = ${a.id} and signal_id = 'META.EVALUATED'`)) as unknown as { n: number }[];
      expect(n!.n).toBe(2);
      const current = await currentFlags(d, 'collector', a.id);
      expect(current.map((f) => f.signalId).sort()).toEqual(['IDENT.NAME_MISMATCH', 'IDENT.PHONE_SHARED', 'VOL.NO_GAP']);
      expect((await engine.summary('collector', a.id)).evaluatedAt).toBe(NOW.toISOString());
    });

    it('a flag falls away when the next run does not find it, and nothing is ever updated or deleted', async () => {
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      await account(w, a, { phone: '0901234567' });
      await account(w, b, { phone: '0901234567' });
      expect((await engine.evaluateCollector(a.id)).band).toBe('hold');
      await account(w, b, { phone: '0905555555', muid: 'mu-b2' });
      expect((await engine.evaluateCollector(a.id)).band).toBe('clear');
      const d = await db();
      const [n] = (await d.execute(sql`select count(*)::int as n from risk_flags where subject_id = ${a.id}`)) as unknown as { n: number }[];
      expect(n!.n).toBe(3);
      await violates('risk_flags_append_only', d.execute(sql`delete from risk_flags where subject_id = ${a.id}`));
    });

    it('a bill rolls up its collector and its episodes, each signal once', async () => {
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      await account(w, a, { phone: '0901234567' });
      await account(w, b, { phone: '0901234567' });
      const fp = 'd'.repeat(64);
      const e1 = await episode(a, { startMs: T0, measured: 600, fingerprint: fp, audio: false });
      const e2 = await episode(a, { startMs: T0 + DAY, measured: 600, fingerprint: fp, audio: false });
      const r1 = await review(w, e1, { measured: 600 });
      const r2 = await review(w, e2, { measured: 600 });
      const billId = await bill(a, [await settlement(w, r1, 600), await settlement(w, r2, 600)]);
      await engine.evaluateCollector(a.id);
      await engine.evaluateEpisode(e1.id);
      await engine.evaluateEpisode(e2.id);
      const s = await engine.summary('bill', billId);
      expect(signals(s)).toEqual(['CONT.AUDIO_ABSENT', 'CONT.NEAR_DUPLICATE', 'IDENT.PHONE_SHARED']);
      expect(s.score).toBe(100);
      const dup = s.flags.find((f) => f.signalId === 'CONT.NEAR_DUPLICATE')!;
      expect(dup.evidence['also_on']).toBe(1);
      expect((await engine.summary('bill', billId)).evaluatedAt).toBeNull();
      expect((await engine.summary('collector', uid())).band).toBe('clear');
    });
  });

  describe('holds', () => {
    async function heldBill() {
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      await account(w, a, { phone: '0901234567' });
      await account(w, b, { phone: '0901234567' });
      const { billId, episodeId } = await billedEpisode(w, a, { startMs: T0, measured: 600 });
      await engine.evaluateCollector(a.id);
      await engine.evaluateEpisode(episodeId);
      return { a, b, billId, episodeId };
    }
    const actor = (operatorId: string): CounterActor => ({
      machine: { kind: 'machine', uploadDeviceId: w.machine, uploadCentreId: w.centre },
      operator: { kind: 'operator', operatorId, uploadCentreId: w.centre },
    });

    it('with holds off, a hold-band bill is reported and not held', async () => {
      const { billId } = await heldBill();
      const r = await engine.evaluateBill(billId);
      expect(r.band).toBe('hold');
      expect(r.hold).toEqual({ raised: false, reason: 'holds_disabled', holdId: null });
      expect(await billHold(await db(), billId)).toBeNull();
    });

    it('with holds on, the hold is raised, read by the payout side, cleared with a reason, and the bill reads clear to pay', async () => {
      const d = await db();
      const holding = new RiskEngine(d, { now: () => NOW, holdsEnabled: true });
      const { a, billId } = await heldBill();
      const r = await holding.evaluateBill(billId);
      expect(r.band).toBe('hold');
      expect(r.hold).toMatchObject({ raised: true, reason: 'raised' });
      const open = await billHold(d, billId);
      expect(open).not.toBeNull();
      expect(open!.signalIds).toEqual(['IDENT.PHONE_SHARED']);
      expect((await currentHolds(d)).map((h) => h.billId)).toEqual([billId]);
      // The read-side view Agent B consumes.
      const [view] = (await d.execute(sql`select bill_id from risk_current_holds where bill_id = ${billId}`)) as unknown as { bill_id: string }[];
      expect(view!.bill_id).toBe(billId);

      // A second evaluation while it is open raises nothing new.
      expect((await holding.evaluateBill(billId)).hold).toMatchObject({ raised: false, reason: 'already_open' });

      // Cleared by finance, with a typed reason, audited in the same transaction.
      await expect(clearHold(d, actor(w.finance), { billId, operatorId: w.finance, reason: 'short', verdict: 'false_positive', now: LATER })).rejects.toThrow(/ten characters/);
      const cleared = await clearHold(d, actor(w.finance), { billId, operatorId: w.finance, reason: 'Two collectors in one household share a phone; checked in person.', verdict: 'false_positive', now: LATER });
      expect(cleared.id).toBe(open!.id);
      expect(await billHold(d, billId)).toBeNull();
      expect(await currentHolds(d)).toEqual([]);
      const [audited] = (await d.execute(sql`select action, reason, operator_id from audit_events where action = 'risk.hold_clear'`)) as unknown as { action: string; reason: string; operator_id: string }[];
      expect(audited).toMatchObject({ reason: 'Two collectors in one household share a phone; checked in person.', operator_id: w.finance });

      // Clearing twice is refused: there is nothing open.
      await expect(clearHold(d, actor(w.finance), { billId, operatorId: w.finance, reason: 'nothing to clear here', verdict: 'resolved', now: LATER })).rejects.toThrow(/no open hold/);

      // The engine does not re-hold on the evidence the operator already saw…
      const again = await holding.evaluateBill(billId);
      expect(again.band).toBe('hold');
      expect(again.hold).toMatchObject({ raised: false, reason: 'cleared_covers_signals' });
      expect(await billHold(d, billId)).toBeNull();

      // …but does on evidence they did not.
      await account(w, a, { phone: '0901234567', declared: 'Nguyễn Văn A', verified: 'NGUYEN VAN B', status: 'name_mismatch', createdAt: new Date(T0 - 20 * DAY) });
      await holding.evaluateCollector(a.id);
      const reraised = await holding.evaluateBill(billId);
      expect(reraised.hold).toMatchObject({ raised: true, reason: 'raised' });
      expect((await billHold(d, billId))!.signalIds).toEqual(['IDENT.NAME_MISMATCH', 'IDENT.PHONE_SHARED']);
    });

    it('measures the false-positive budget from the clear verdicts', async () => {
      const d = await db();
      const holding = new RiskEngine(d, { now: () => NOW, holdsEnabled: true });
      const bills: string[] = [];
      for (let i = 0; i < 5; i++) {
        const a = await collector(w, `c-${1000 + i}`);
        const b = await collector(w, `c-${2000 + i}`);
        await account(w, a, { phone: `09000000${i}0` });
        await account(w, b, { phone: `09000000${i}0` });
        const { billId } = await billedEpisode(w, a, { startMs: T0 + i * HOUR, measured: 600 });
        await holding.evaluateCollector(a.id);
        await holding.evaluateBill(billId);
        bills.push(billId);
      }
      await clearHold(d, actor(w.finance), { billId: bills[0]!, operatorId: w.finance, reason: 'same household, confirmed by phone', verdict: 'false_positive', now: new Date(NOW.getTime() + DAY) });
      await clearHold(d, actor(w.finance), { billId: bills[1]!, operatorId: w.finance, reason: 'same household, confirmed by phone', verdict: 'false_positive', now: new Date(NOW.getTime() + 3 * DAY) });
      await clearHold(d, actor(w.finance), { billId: bills[2]!, operatorId: w.finance, reason: 'known, paying under supervision', verdict: 'accepted', now: new Date(NOW.getTime() + DAY) });
      const report = await falsePositiveReport(d, { from: new Date(NOW.getTime() - DAY), to: new Date(NOW.getTime() + 7 * DAY) });
      expect(report.holds).toEqual({ raised: 5, open: 2, cleared: 3, cleared_false_positive: 2, cleared_accepted: 1, cleared_resolved: 0, false_positive_rate: 0.4, over_budget: true });
      expect(report.by_signal).toEqual([{ signal_id: 'IDENT.PHONE_SHARED', holds: 5, false_positive: 2, accepted: 1, resolved: 0, false_positive_share: 0.4 }]);
      expect(report.time_to_clear_days).toEqual({ median: 1, max: 3 });
      const outside = await falsePositiveReport(d, { from: new Date(NOW.getTime() + 30 * DAY), to: new Date(NOW.getTime() + 60 * DAY) });
      expect(outside.holds.raised).toBe(0);
      expect(outside.holds.over_budget).toBe(false);
    });
  });

  describe('the clean corpus', () => {
    it('keeps thirty plausible collectors under 5% at review and under 1% at hold', async () => {
      const d = await db();
      const bands = { review: 0, hold: 0, notice: 0, clear: 0 };
      const collectors: Collector[] = [];
      for (let i = 0; i < 30; i++) {
        const c = await collector(w, `c-${String(i).padStart(4, '0')}`);
        await account(w, c);
        for (let day = 0; day < 5; day++) {
          const { billId } = await billedEpisode(w, c, { startMs: T0 + day * DAY + i * 60_000, measured: 1800 + (i % 7) * 300 });
          void billId;
        }
        collectors.push(c);
      }
      let subjects = 0;
      for (const c of collectors) {
        const r = await engine.evaluateCollector(c.id);
        bands[r.band] += 1;
        subjects += 1;
      }
      const eps = (await d.execute(sql`select episode_id from episodes`)) as unknown as { episode_id: string }[];
      for (const e of eps) {
        bands[(await engine.evaluateEpisode(e.episode_id)).band] += 1;
        subjects += 1;
      }
      const bills = (await d.execute(sql`select id from bills`)) as unknown as { id: string }[];
      for (const b of bills) {
        bands[(await engine.evaluateBill(b.id)).band] += 1;
        subjects += 1;
      }
      expect(subjects).toBe(30 + 150 + 150);
      expect(bands.review / subjects).toBeLessThan(0.05);
      expect(bands.hold / subjects).toBeLessThan(0.01);
      expect(bands).toEqual({ clear: subjects, notice: 0, review: 0, hold: 0 });
    }, 600_000);
  });

  describe('the worker', () => {
    it('evaluates what is due, in order, and does nothing when the engine is off', async () => {
      const d = await db();
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      await account(w, a, { phone: '0901234567' });
      await account(w, b, { phone: '0901234567' });
      const { billId } = await billedEpisode(w, a, { startMs: T0, measured: 600 });
      expect(await tick(d, engine, { enabled: false, now: () => NOW })).toMatchObject({ evaluated: { episodes: 0, collectors: 0, bills: 0 } });
      const first = await tick(d, engine, { now: () => NOW });
      expect(first.evaluated).toEqual({ episodes: 1, collectors: 2, bills: 1 });
      expect(first.failed).toEqual([]);
      expect((await engine.summary('bill', billId)).band).toBe('hold');
      // Nothing changed: nothing is due, except collectors once they go stale.
      const second = await tick(d, engine, { now: () => NOW });
      expect(second.evaluated).toEqual({ episodes: 0, collectors: 0, bills: 0 });
      // Two hours on, the collectors are stale; their fresh evaluation makes the bill due again.
      const then = new Date(NOW.getTime() + 2 * HOUR);
      const later = await tick(d, new RiskEngine(d, { now: () => then }), { now: () => then });
      expect(later.evaluated).toEqual({ episodes: 0, collectors: 2, bills: 1 });
    });

    it('skips a subject another instance is evaluating', async () => {
      const d = await db();
      const c = await collector(w, 'c-0001');
      await account(w, c);
      const { RiskBusy } = await import('../../src/risk/engine.ts');
      // A second connection: the file's pool is one connection, and a lock held
      // on it would make the engine wait for the pool, not for the lock.
      const other = await open(dbUrl(), { max: 1 });
      try {
        await other.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`risk:collector:${c.id}`}))`);
          await expect(engine.evaluateCollector(c.id)).rejects.toBeInstanceOf(RiskBusy);
        });
      } finally {
        await other.close();
      }
      void d;
      expect(signals(await engine.evaluateCollector(c.id))).toEqual([]);
    });
  });

  describe('the routes', () => {
    async function api(operatorId: string | null) {
      const d = await db();
      const app = Fastify({ logger: false });
      const requireActor = async (req: Parameters<typeof registerRisk>[2] extends (r: infer R, ...rest: never[]) => unknown ? R : never, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
        if (operatorId === null) {
          req.actor = { reviewer: { kind: 'reviewer', reviewerId: w.reviewer } };
          return;
        }
        req.actor = { machine: { kind: 'machine', uploadDeviceId: w.machine, uploadCentreId: w.centre }, operator: { kind: 'operator', operatorId, uploadCentreId: w.centre } };
        void reply;
      };
      registerRisk(app, d, requireActor, new RiskEngine(d, { now: () => NOW, holdsEnabled: true }));
      await app.ready();
      return app;
    }

    it('mounts the risk surface through the production API assembly (F-50)', async () => {
      const live = buildApi({
        db: await db(),
        tokenSecret: 'risk-route-registration-test',
        payout: { mode: 'manual', zaloPayEnv: 'sandbox' },
        risk: { engineEnabled: true, holdsEnabled: false, mediaRoot: undefined },
      });
      await live.ready();
      expect(live.hasRoute({ method: 'GET', url: '/api/risk/holds' })).toBe(true);
      expect(live.hasRoute({ method: 'POST', url: '/api/risk/evaluate/:type/:id' })).toBe(true);
      await live.close();
    });

    it('serves summaries with sentences in three languages, evaluates on demand, and clears holds for finance only', async () => {
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      await account(w, a, { phone: '0901234567' });
      await account(w, b, { phone: '0901234567' });
      const { billId } = await billedEpisode(w, a, { startMs: T0, measured: 600 });

      const ops = await api(w.operator);
      const fin = await api(w.finance);
      const rev = await api(null);

      const ev = await ops.inject({ method: 'POST', url: `/api/risk/evaluate/collector/${a.id}` });
      expect(ev.statusCode, ev.body).toBe(200);
      expect(ev.json().flags[0].sentence.vi).toContain('c-0002');
      expect(ev.json().flags[0].sentence.zh).toContain('c-0002');
      expect(ev.json().flags[0].sentence.en).toBe('Wallet phone 090•••••67 is also on the payout account of 1 other collector(s): c-0002.');

      const evb = await ops.inject({ method: 'POST', url: `/api/risk/evaluate/bill/${billId}` });
      expect(evb.json().band).toBe('hold');
      expect(evb.json().hold.raised).toBe(true);

      const sum = await ops.inject({ method: 'GET', url: `/api/risk/summary/bill/${billId}` });
      expect(sum.json()).toMatchObject({ subject_type: 'bill', band: 'hold', score: 60 });
      expect((await ops.inject({ method: 'GET', url: '/api/risk/holds' })).json().holds.map((h: { bill_id: string }) => h.bill_id)).toEqual([billId]);
      expect((await ops.inject({ method: 'GET', url: `/api/risk/summary/thing/${billId}` })).statusCode).toBe(400);
      expect((await ops.inject({ method: 'POST', url: `/api/risk/evaluate/bill/${uid()}` })).statusCode).toBe(404);

      const body = { reason: 'Same household, confirmed with both collectors.', verdict: 'false_positive' };
      expect((await rev.inject({ method: 'POST', url: `/api/risk/holds/${billId}/clear`, payload: body })).statusCode).toBe(403);
      expect((await ops.inject({ method: 'POST', url: `/api/risk/holds/${billId}/clear`, payload: body })).statusCode).toBe(403);
      expect((await fin.inject({ method: 'POST', url: `/api/risk/holds/${billId}/clear`, payload: { reason: 'short', verdict: 'resolved' } })).statusCode).toBe(400);
      const cleared = await fin.inject({ method: 'POST', url: `/api/risk/holds/${billId}/clear`, payload: body });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect(cleared.json().held).toBe(false);
      expect((await fin.inject({ method: 'POST', url: `/api/risk/holds/${billId}/clear`, payload: body })).statusCode).toBe(409);
      const history = await ops.inject({ method: 'GET', url: `/api/risk/holds/${billId}` });
      expect(history.json().held).toBe(false);
      expect(history.json().history).toHaveLength(2);
      expect(history.json().history[1].clear_verdict).toBe('false_positive');

      const report = await ops.inject({ method: 'GET', url: '/api/risk/report/false-positives?from=2026-08-01&to=2026-09-01' });
      expect(report.json().holds).toMatchObject({ raised: 1, cleared_false_positive: 1, false_positive_rate: 1, over_budget: true });
      await Promise.all([ops.close(), fin.close(), rev.close()]);
    });

    it('retunes a signal by superseding it, for finance, with a reason, and never past the synthetic cap', async () => {
      const d = await db();
      const ops = await api(w.operator);
      const fin = await api(w.finance);
      const list = await ops.inject({ method: 'GET', url: '/api/risk/signals' });
      expect(list.json().signals.find((s: { signal_id: string }) => s.signal_id === 'BAND.HOLD')).toMatchObject({ points: 60, threshold_version: 'v1' });

      const retune = { threshold_version: 'v2', points: 70, reason: 'Pilot week two: too many holds on shared phones in one household.' };
      expect((await ops.inject({ method: 'POST', url: '/api/risk/signals/BAND.HOLD/retune', payload: retune })).statusCode).toBe(403);
      const ok = await fin.inject({ method: 'POST', url: '/api/risk/signals/BAND.HOLD/retune', payload: retune });
      expect(ok.statusCode, ok.body).toBe(200);
      expect((await loadTuning(d)).get('BAND.HOLD')).toMatchObject({ points: 70, thresholdVersion: 'v2' });
      const history = await ops.inject({ method: 'GET', url: '/api/risk/signals/BAND.HOLD/history' });
      expect(history.json().versions.map((v: { threshold_version: string; superseded_at: string | null }) => [v.threshold_version, v.superseded_at === null])).toEqual([['v2', true], ['v1', false]]);
      const [audited] = (await d.execute(sql`select reason, before, after from audit_events where action = 'risk.retune'`)) as unknown as { reason: string; before: { points: number }; after: { points: number } }[];
      expect(audited).toMatchObject({ reason: retune.reason, before: { points: 60 }, after: { points: 70 } });

      // A 60-point hold is now review; the band moved with the data, not a deploy.
      const a = await collector(w, 'c-0001');
      const b = await collector(w, 'c-0002');
      await account(w, a, { phone: '0901234567' });
      await account(w, b, { phone: '0901234567' });
      expect((await new RiskEngine(d, { now: () => NOW }).evaluateCollector(a.id)).band).toBe('review');

      const lift = await fin.inject({ method: 'POST', url: '/api/risk/signals/PROV.SYNTHETIC_HEURISTIC/retune', payload: { threshold_version: 'v2', severity: 'hold', points: 60, reason: 'trying to lift the cap from the API' } });
      expect(lift.statusCode).toBe(409);
      expect(lift.json().constraint).toBe('risk_signals_synthetic_cap_check');
      await expect(retuneSignal(d, { machine: { kind: 'machine', uploadDeviceId: w.machine, uploadCentreId: w.centre }, operator: { kind: 'operator', operatorId: w.finance, uploadCentreId: w.centre } }, { signalId: 'BAND.HOLD', thresholdVersion: 'v2', points: 80, reason: 'reusing a version string' })).rejects.toThrow();
      expect((await fin.inject({ method: 'POST', url: '/api/risk/signals/NOPE.X/retune', payload: retune })).statusCode).toBe(404);
      await Promise.all([ops.close(), fin.close()]);
    });
  });
});
