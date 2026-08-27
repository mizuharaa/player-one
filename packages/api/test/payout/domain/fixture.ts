import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import { hashCredential } from '../../../src/credentials.ts';
import { liveClaim } from '../../../../store/test/db.ts';

/**
 * The payout fixture, in raw SQL, the way `spine.test.ts` seeds a settlement.
 *
 * Not the smallest one that works. Two centres, two collectors, two finance
 * operators and a plain operator, because a single-collector fixture is the
 * shape that hides a scoping bug (CLAUDE.md), and because separation of duty
 * is only testable when there is somebody else who could pay.
 *
 * Amounts are whole dong on purpose: one minute at 1,200/min is `1200.0000`,
 * so a bill of two lines is `2400.0000` and converts to an attempt of 2,400
 * VND without anybody deciding a rounding rule. The one fractional bill
 * (`170.0004`, the review lane's own 8.5 s case) exists to prove that nothing
 * converts it.
 */

export const uid = (): string => randomUUID();

export const P0 = { start: new Date('2026-08-10T00:00:00Z'), end: new Date('2026-08-17T00:00:00Z') };
export const P1 = { start: new Date('2026-08-17T00:00:00Z'), end: new Date('2026-08-24T00:00:00Z') };

export type Ids = Awaited<ReturnType<typeof seedPayout>>;

export async function seedPayout(d: Db) {
  const hash = await hashCredential('pw');
  const ids = {
    centreA: uid(),
    centreB: uid(),
    machineA: uid(),
    machineB: uid(),
    opA: uid(),
    finA: uid(),
    finB: uid(),
    collector1: uid(),
    collector2: uid(),
    task: uid(),
    deviceType: uid(),
    device1: uid(),
    device2: uid(),
    scenario: uid(),
    session1: uid(),
    session2: uid(),
  };
  await d.execute(sql`insert into upload_centres (id, region, name, status) values (${ids.centreA}, 'HCM', 'District 7', 'active'), (${ids.centreB}, 'HAN', 'Cau Giay', 'active')`);
  await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values (${ids.machineA}, ${ids.centreA}, 'HCM-01', 'active', ${hash}), (${ids.machineB}, ${ids.centreB}, 'HAN-01', 'active', ${hash})`);
  await d.execute(sql`
    insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values
      (${ids.opA}, ${ids.centreA}, 'op-hcm', 'centre_operator', ${hash}),
      (${ids.finA}, ${ids.centreA}, 'fin-hcm', 'finance', ${hash}),
      (${ids.finB}, ${ids.centreB}, 'fin-han', 'finance', ${hash})
  `);
  await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector1}, 'c-0001', 'qualified'), (${ids.collector2}, 'c-0002', 'qualified')`);
  await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.task}, 'housework', 1200.0000, 5, 'published')`);
  await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego_headset', 'gen1')`);
  await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${ids.device1}, ${ids.deviceType}, 'AZER76400FE', 'active'), (${ids.device2}, ${ids.deviceType}, 'AZER76400FF', 'active')`);
  await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);

  const session = async (id: string, collector: string, device: string, centre: string, machine: string, operator: string, card: string) => {
    const handover = uid();
    const batch = uid();
    await d.execute(sql`insert into handovers (id, collector_id, device_id, tf_card_id, upload_centre_id, operator_id, handover_time) values (${handover}, ${collector}, ${device}, ${card}, ${centre}, ${operator}, now())`);
    await d.execute(sql`insert into upload_batches (id, handover_id, upload_device_id, import_started_at, batch_status) values (${batch}, ${handover}, ${machine}, now(), 'importing')`);
    // Recorded under a live claim, with the price snapshotted (0016).
    const claim = await liveClaim(d, ids.task, collector);
    await d.execute(sql`
      insert into collection_sessions (id, handover_id, task_id, collector_id, scenario_id, others_in_frame, sensitive_info_present, session_origin,
                                       task_claim_id, unit_price, currency)
        values (${id}, ${handover}, ${ids.task}, ${collector}, ${ids.scenario}, false, false, 'handover', ${claim}, '1200.0000', 'VND')
    `);
    await d.execute(sql`insert into collection_session_devices (collection_session_id, device_id, role) values (${id}, ${device}, 'headset')`);
    return { handover, batch, claim };
  };
  const claim1 = (await session(ids.session1, ids.collector1, ids.device1, ids.centreA, ids.machineA, ids.opA, 'CARD-1')).claim;
  const claim2 = (await session(ids.session2, ids.collector2, ids.device2, ids.centreB, ids.machineB, ids.finB, 'CARD-2')).claim;
  return { ...ids, claim1, claim2 };
}

/** A reviewed episode with a settlement worth `amount`, already billed (`bill_generated`). */
export async function seedSettlement(
  d: Db,
  ids: Ids,
  which: 1 | 2,
  amount: string,
  minutes = '1.000000',
): Promise<{ settlementId: string; reviewId: string; episodeId: string }> {
  const episodeId = uid();
  const ingestId = uid();
  const reviewId = uid();
  const settlementId = uid();
  const sessionId = which === 1 ? ids.session1 : ids.session2;
  const serial = which === 1 ? 'AZER76400FE' : 'AZER76400FF';
  await d.execute(sql`
    insert into episodes (episode_id, device_serial, session_started_at, first_seen_at, last_seen_at, ingest_count,
                          collection_session_id, resolution_state, upload_path)
      values (${episodeId}, ${serial}, '20260813_072310', now(), now(), 1, ${sessionId}, 'resolved', 'C')
  `);
  await d.execute(sql`
    insert into episode_ingests (ingest_id, episode_id, content_fingerprint, state, source_basename, measured_duration_s,
                                 timing_source, timing_confidence, manifest_present, engine_version, host, ingested_at, record_json)
      values (${ingestId}, ${episodeId}, repeat('a', 64), 'ok', 'ego_AZER76400FE_20260813_072310', '60.000000',
              'pts_sidecar', 'exact', true, '0.3.1', 'test', now(), '{}'::jsonb)
  `);
  await d.execute(sql`
    insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s, effective_duration_s, review_state, reviewed_at, verdict_id)
      values (${reviewId}, ${episodeId}, ${ingestId}, '60.000000', '60.000000', 'pass', now(), ${uid()})
  `);
  await d.execute(sql`
    insert into settlements (id, episode_review_id, task_id, task_claim_id, unit_price, effective_minutes, amount, settlement_state)
      values (${settlementId}, ${reviewId}, ${ids.task}, ${which === 1 ? ids.claim1 : ids.claim2}, '1200.0000', ${minutes}, ${amount}, 'pending_settlement')
  `);
  await d.execute(sql`update settlements set settlement_state = 'bill_generated', updated_at = now() where id = ${settlementId}`);
  return { settlementId, reviewId, episodeId };
}

/** A bill for a collector over a period, with one line per amount, totalling their sum as given. */
export async function seedBill(
  d: Db,
  ids: Ids,
  which: 1 | 2,
  period: { start: Date; end: Date },
  amounts: string[],
  total: string,
): Promise<string> {
  const billId = uid();
  const collector = which === 1 ? ids.collector1 : ids.collector2;
  await d.execute(sql`
    insert into bills (id, collector_id, period_start, period_end, currency, total)
      values (${billId}, ${collector}, ${period.start.toISOString()}::timestamptz, ${period.end.toISOString()}::timestamptz, 'VND', ${total})
  `);
  // The lines go in as one statement: `bills_total_matches_lines` (0011) is a
  // deferred check that the bill adds up at the end of the statement/transaction,
  // and the generator writes a bill's lines together too.
  const lines: string[] = [];
  for (const amount of amounts) {
    lines.push((await seedSettlement(d, ids, which, amount)).settlementId);
  }
  if (lines.length > 0) {
    await d.execute(sql`
      insert into bill_lines (bill_id, settlement_id)
      values ${sql.join(lines.map((id) => sql`(${billId}, ${id})`), sql`, `)}
    `);
  }
  return billId;
}

/** The two bills most tests need: c-0001 for 2,400 VND (two lines) and c-0002 for 1,200 VND. */
export async function seedBills(d: Db, ids: Ids): Promise<{ bill1: string; bill2: string }> {
  const bill1 = await seedBill(d, ids, 1, P1, ['1200.0000', '1200.0000'], '2400.0000');
  const bill2 = await seedBill(d, ids, 2, P1, ['1200.0000'], '1200.0000');
  return { bill1, bill2 };
}

/** The review lane's own 8.5 s case, which no rounding rule has been chosen for. */
export const seedFractionalBill = (d: Db, ids: Ids): Promise<string> =>
  seedBill(d, ids, 1, P0, ['170.0004'], '170.0004');

/** A current payout account, declared in raw SQL. */
export async function seedAccount(
  d: Db,
  ids: Ids,
  which: 1 | 2,
  over: Partial<{
    id: string;
    method: 'WALLET' | 'BANK_ACCOUNT' | 'BANK_CARD';
    verifyStatus: string;
    mUId: string | null;
    isCurrent: boolean;
    verifiedName: string | null;
  }> = {},
): Promise<string> {
  const id = over.id ?? uid();
  const method = over.method ?? 'WALLET';
  const status = over.verifyStatus ?? 'verified';
  const collector = which === 1 ? ids.collector1 : ids.collector2;
  await d.execute(sql`
    insert into payout_accounts (id, collector_id, method, phone, bank_code, account_no_last4, declared_name, verified_name,
                                 m_u_id, verify_status, verified_at, is_current, created_by)
      values (${id}, ${collector}, ${method},
              ${method === 'WALLET' ? '0912345678' : null}, ${method === 'WALLET' ? null : 'VCB'},
              ${method === 'WALLET' ? null : '5678'},
              'Nguyen Van A', ${over.verifiedName === undefined ? (status === 'verified' ? 'NGUYEN VAN A' : null) : over.verifiedName},
              ${method === 'WALLET' ? (over.mUId === undefined ? (status === 'verified' ? 'mu-0001' : null) : over.mUId) : null},
              ${status}, ${status === 'unverified' ? null : new Date().toISOString()}::timestamptz, ${over.isCurrent ?? true}, ${ids.opA})
  `);
  return id;
}

/** An attributed audit row, as `mutate` would write it. Operator actor: device and centre set. */
export async function auditRow(
  d: Db | Parameters<Parameters<Db['transaction']>[0]>[0],
  ids: Ids,
  row: { action: string; targetTable: string; targetId: string; operatorId: string; reason?: string },
): Promise<void> {
  const centre = row.operatorId === ids.finB ? ids.centreB : ids.centreA;
  const machine = row.operatorId === ids.finB ? ids.machineB : ids.machineA;
  await d.execute(sql`
    insert into audit_events (action, target_table, target_id, actor_role, operator_id, upload_device_id, upload_centre_id, reason)
      values (${row.action}, ${row.targetTable}, ${row.targetId}, 'operator', ${row.operatorId}, ${machine}, ${centre}, ${row.reason ?? null})
  `);
}

/**
 * Inserts an attempt in raw SQL, inside one transaction with the audit row a
 * finance operator would leave. What the application supplies, and nothing
 * else: no attempt_seq, no partner_order_id.
 */
export async function insertAttemptAs(
  d: Db,
  ids: Ids,
  operatorId: string | null,
  attempt: {
    id?: string;
    billId: string;
    accountId: string;
    amountVnd: number;
    mode?: 'api' | 'manual';
    status?: string;
    manualReference?: string | null;
    settledAt?: Date | null;
    createdAt?: Date;
    attemptSeq?: number;
    partnerOrderId?: string;
  },
): Promise<string> {
  const id = attempt.id ?? uid();
  const mode = attempt.mode ?? 'api';
  const status = attempt.status ?? (mode === 'manual' ? 'succeeded' : 'created');
  await d.transaction(async (tx) => {
    await tx.execute(sql`
      insert into payout_attempts (id, bill_id, payout_account_id, amount_vnd, mode, status, manual_reference, settled_at, created_at, attempt_seq, partner_order_id)
        values (${id}, ${attempt.billId}, ${attempt.accountId}, ${attempt.amountVnd}::bigint, ${mode}, ${status},
                ${attempt.manualReference ?? null}::text, ${attempt.settledAt?.toISOString() ?? null}::timestamptz,
                coalesce(${attempt.createdAt?.toISOString() ?? null}::timestamptz, now()),
                ${attempt.attemptSeq ?? null}::integer, ${attempt.partnerOrderId ?? null}::text)
    `);
    if (operatorId !== null) {
      await auditRow(tx, ids, { action: 'payout_attempt.create', targetTable: 'payout_attempts', targetId: id, operatorId });
    }
  });
  return id;
}

export const rows = async <T>(d: Db, q: ReturnType<typeof sql>): Promise<T[]> => (await d.execute(q)) as unknown as T[];

export const attemptRow = async (d: Db, id: string) =>
  (await rows<Record<string, unknown>>(d, sql`select * from payout_attempts where id = ${id}`))[0]!;

export const countOf = async (d: Db, q: ReturnType<typeof sql>): Promise<number> =>
  Number((await rows<{ n: number | string }>(d, q))[0]!.n);
