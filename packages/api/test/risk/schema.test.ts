import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, hasDb, truncate, useDatabase, violates } from '../../../store/test/db.ts';
import { RISK_CATALOGUE, SIGNAL_IDS, loadTuning, seedRiskSignals } from '../../src/risk/catalogue.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('risk_schema');

/**
 * Migration 0014 in raw SQL, with no application in the path: the three
 * tables, the append-only and chain triggers, the two CHECKs that cap the
 * synthetic heuristic, the views, and the role that cannot write money.
 * Every refusal is asserted by constraint name with `violates`, never by a
 * message pattern.
 */

const uid = () => randomUUID();

describe.skipIf(!hasDb())('migration 0014, the risk tables', () => {
  beforeEach(async () => {
    await truncate();
    await seedRiskSignals(await db());
  });
  afterAll(closeDb);

  /** A collector, a bill and an operator to hang holds off. */
  async function scaffold() {
    const d = await db();
    const ids = { centre: uid(), operator: uid(), collector: uid(), bill: uid() };
    await d.execute(sql`insert into upload_centres (id, region, name, status) values (${ids.centre}, 'HCM', 'D7', 'active')`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role) values (${ids.operator}, ${ids.centre}, 'fin-01', 'finance')`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector}, 'c-0001', 'qualified')`);
    await d.execute(
      sql`insert into bills (id, collector_id, period_start, period_end, currency, total) values (${ids.bill}, ${ids.collector}, '2026-08-14T00:00:00Z', '2026-08-21T00:00:00Z', 'VND', 0)`,
    );
    return { d, ids };
  }

  async function flag(subjectId: string, signalId = 'IDENT.PHONE_SHARED', runId = uid()): Promise<string> {
    const d = await db();
    const rows = (await d.execute(
      sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence)
           values (${runId}::uuid, 'bill', ${subjectId}, ${signalId}, 'v1', 60, 'hold', '{"count": 1}'::jsonb) returning id`,
    )) as unknown as { id: string }[];
    return rows[0]!.id;
  }

  it('seeds every signal in the catalogue once, and a second seed changes nothing', async () => {
    const d = await db();
    const tuning = await loadTuning(d);
    for (const id of SIGNAL_IDS) expect(tuning.get(id)?.thresholdVersion, id).toBe('v1');
    expect(tuning.size).toBe(RISK_CATALOGUE.length);
    await seedRiskSignals(d);
    const [n] = (await d.execute(sql`select count(*)::int as n from risk_signals`)) as unknown as { n: number }[];
    expect(n!.n).toBe(RISK_CATALOGUE.length);
  });

  it('refuses to retune a signal in place, or delete it; superseding is the one legal update', async () => {
    const d = await db();
    await violates('risk_signals_supersede_only', d.execute(sql`update risk_signals set default_points = 99 where signal_id = 'IDENT.PHONE_SHARED'`));
    await violates('risk_signals_supersede_only', d.execute(sql`update risk_signals set enabled = false where signal_id = 'IDENT.PHONE_SHARED'`));
    await violates('risk_signals_supersede_only', d.execute(sql`update risk_signals set params = '{"x":1}' where signal_id = 'IDENT.PHONE_SHARED'`));
    await violates('risk_signals_supersede_only', d.execute(sql`delete from risk_signals where signal_id = 'IDENT.PHONE_SHARED'`));
    // Supersede, then insert the next version: the retune the catalogue module performs.
    await d.execute(sql`update risk_signals set superseded_at = now() where signal_id = 'IDENT.PHONE_SHARED' and superseded_at is null`);
    await d.execute(
      sql`insert into risk_signals (signal_id, threshold_version, family, description, default_points, default_severity)
           values ('IDENT.PHONE_SHARED', 'v2', 'IDENT', 'retuned', 70, 'hold')`,
    );
    const tuning = await loadTuning(d);
    expect(tuning.get('IDENT.PHONE_SHARED')).toMatchObject({ points: 70, thresholdVersion: 'v2' });
    // A second current row for one signal has nowhere to go.
    await violates(
      'risk_signals_current_key',
      d.execute(sql`insert into risk_signals (signal_id, threshold_version, family, description, default_points, default_severity) values ('IDENT.PHONE_SHARED', 'v3', 'IDENT', 'again', 70, 'hold')`),
    );
    // And un-superseding is a retune in place.
    await violates('risk_signals_supersede_only', d.execute(sql`update risk_signals set superseded_at = null where signal_id = 'IDENT.PHONE_SHARED' and threshold_version = 'v1'`));
  });

  it('caps the synthetic heuristic at notice in the catalogue and on the flags', async () => {
    const d = await db();
    await d.execute(sql`update risk_signals set superseded_at = now() where signal_id = 'PROV.SYNTHETIC_HEURISTIC' and superseded_at is null`);
    await violates(
      'risk_signals_synthetic_cap_check',
      d.execute(sql`insert into risk_signals (signal_id, threshold_version, family, description, default_points, default_severity) values ('PROV.SYNTHETIC_HEURISTIC', 'v2', 'PROV', 'lifted', 60, 'hold')`),
    );
    await violates(
      'risk_signals_synthetic_cap_check',
      d.execute(sql`insert into risk_signals (signal_id, threshold_version, family, description, default_points, default_severity) values ('PROV.SYNTHETIC_HEURISTIC', 'v2', 'PROV', 'lifted', 40, 'review')`),
    );
    await violates(
      'risk_flags_synthetic_cap_check',
      d.execute(
        sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence) values (${uid()}::uuid, 'episode', 'e', 'PROV.SYNTHETIC_HEURISTIC', 'v1', 15, 'hold', '{}'::jsonb)`,
      ),
    );
  });

  it('keeps every flag: UPDATE and DELETE both fail, and a flag must cite a real tuning row', async () => {
    const d = await db();
    const id = await flag('b1');
    await violates('risk_flags_append_only', d.execute(sql`update risk_flags set points = 0 where id = ${id}::uuid`));
    await violates('risk_flags_append_only', d.execute(sql`update risk_flags set evidence = '{}' where id = ${id}::uuid`));
    await violates('risk_flags_append_only', d.execute(sql`delete from risk_flags where id = ${id}::uuid`));
    await violates('risk_flags_append_only', d.execute(sql`delete from risk_flags`));
    await violates(
      'risk_flags_signal_fk',
      d.execute(sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence) values (${uid()}::uuid, 'bill', 'b', 'IDENT.PHONE_SHARED', 'v9', 60, 'hold', '{}'::jsonb)`),
    );
    await violates(
      'risk_flags_evidence_object_check',
      d.execute(sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence) values (${uid()}::uuid, 'bill', 'b', 'IDENT.PHONE_SHARED', 'v1', 60, 'hold', '[]'::jsonb)`),
    );
    const [n] = (await d.execute(sql`select count(*)::int as n from risk_flags`)) as unknown as { n: number }[];
    expect(n!.n).toBe(1);
  });

  it('holds are a chain of rows: cleared by a new row, never edited, never doubled', async () => {
    const { d, ids } = await scaffold();
    const flagId = await flag(ids.bill);
    await violates(
      'risk_holds_clear_requires_open',
      d.execute(
        sql`insert into risk_holds (bill_id, raised_by_flag, signal_ids, cleared_at, cleared_by, clear_reason, clear_verdict) values (${ids.bill}, ${flagId}::uuid, '{IDENT.PHONE_SHARED}', now(), ${ids.operator}, 'looked, nothing there', 'false_positive')`,
      ),
    );
    // A raise carries a set: at least one signal, none twice (the CHECK).
    await violates('risk_holds_signal_ids_check', d.execute(sql`insert into risk_holds (bill_id, raised_by_flag, signal_ids) values (${ids.bill}, ${flagId}::uuid, '{}')`));
    await violates('risk_holds_signal_ids_check', d.execute(sql`insert into risk_holds (bill_id, raised_by_flag, signal_ids) values (${ids.bill}, ${flagId}::uuid, '{IDENT.PHONE_SHARED,IDENT.PHONE_SHARED}')`));
    const [open] = (await d.execute(
      sql`insert into risk_holds (bill_id, raised_by_flag, signal_ids) values (${ids.bill}, ${flagId}::uuid, '{IDENT.PHONE_SHARED}') returning id, raised_at`,
    )) as unknown as { id: string; raised_at: Date }[];
    await violates('risk_holds_already_open', d.execute(sql`insert into risk_holds (bill_id, raised_by_flag, signal_ids) values (${ids.bill}, ${flagId}::uuid, '{IDENT.PHONE_SHARED}')`));
    await violates('risk_holds_append_only', d.execute(sql`update risk_holds set cleared_at = now(), cleared_by = ${ids.operator}, clear_reason = 'edited in place, no', clear_verdict = 'resolved' where id = ${open!.id}::uuid`));
    await violates('risk_holds_append_only', d.execute(sql`delete from risk_holds where id = ${open!.id}::uuid`));
    // A clear needs a person, ten characters of reason, and a verdict.
    await violates(
      'risk_holds_clear_shape_check',
      d.execute(sql`insert into risk_holds (bill_id, raised_by_flag, raised_at, signal_ids, cleared_at, cleared_by, clear_reason, clear_verdict) values (${ids.bill}, ${flagId}::uuid, ${open!.raised_at}, '{IDENT.PHONE_SHARED}', now(), ${ids.operator}, 'ok', 'false_positive')`),
    );
    await violates(
      'risk_holds_clear_shape_check',
      d.execute(sql`insert into risk_holds (bill_id, raised_by_flag, raised_at, signal_ids, cleared_at, cleared_by, clear_reason, clear_verdict) values (${ids.bill}, ${flagId}::uuid, ${open!.raised_at}, '{IDENT.PHONE_SHARED}', now(), ${ids.operator}, 'checked with the collector', 'whatever')`),
    );
    // F-37: a clear carries the raise's set exactly. Not a superset (which would
    // mark risk the operator never saw as reviewed), not a subset, not a
    // duplicate; and the raise itself is a set.
    await violates(
      'risk_holds_clear_signals_check',
      d.execute(sql`insert into risk_holds (bill_id, raised_by_flag, raised_at, signal_ids, cleared_at, cleared_by, clear_reason, clear_verdict) values (${ids.bill}, ${flagId}::uuid, ${open!.raised_at}, '{IDENT.PHONE_SHARED,IDENT.NAME_MISMATCH}', now(), ${ids.operator}, 'clearing more than was raised', 'false_positive')`),
    );
    await violates(
      'risk_holds_clear_signals_check',
      d.execute(sql`insert into risk_holds (bill_id, raised_by_flag, raised_at, signal_ids, cleared_at, cleared_by, clear_reason, clear_verdict) values (${ids.bill}, ${flagId}::uuid, ${open!.raised_at}, '{IDENT.MUID_SHARED}', now(), ${ids.operator}, 'clearing something else entirely', 'false_positive')`),
    );
    // A duplicate on a clear is caught by the trigger first (BEFORE triggers run
    // before CHECKs): {A,A} is not the set {A} either way.
    await violates(
      'risk_holds_clear_signals_check',
      d.execute(sql`insert into risk_holds (bill_id, raised_by_flag, raised_at, signal_ids, cleared_at, cleared_by, clear_reason, clear_verdict) values (${ids.bill}, ${flagId}::uuid, ${open!.raised_at}, '{IDENT.PHONE_SHARED,IDENT.PHONE_SHARED}', now(), ${ids.operator}, 'a duplicate is not a set', 'false_positive')`),
    );
    let holds = (await d.execute(sql`select bill_id from risk_current_holds`)) as unknown as { bill_id: string }[];
    expect(holds.map((h) => h.bill_id)).toEqual([ids.bill]);
    await d.execute(
      sql`insert into risk_holds (bill_id, raised_by_flag, raised_at, signal_ids, cleared_at, cleared_by, clear_reason, clear_verdict) values (${ids.bill}, ${flagId}::uuid, ${open!.raised_at}, '{IDENT.PHONE_SHARED}', now(), ${ids.operator}, 'checked with the collector, one household', 'false_positive')`,
    );
    holds = (await d.execute(sql`select bill_id from risk_current_holds`)) as unknown as { bill_id: string }[];
    expect(holds).toEqual([]);
    // Cleared, so a new hold can be raised again later, and the chain keeps both.
    const [second] = (await d.execute(sql`insert into risk_holds (bill_id, raised_by_flag, signal_ids) values (${ids.bill}, ${flagId}::uuid, '{IDENT.PHONE_SHARED,IDENT.MUID_SHARED}') returning raised_at`)) as unknown as { raised_at: Date }[];
    // The same set in another order clears: equality of sets, not of arrays.
    await d.execute(
      sql`insert into risk_holds (bill_id, raised_by_flag, raised_at, signal_ids, cleared_at, cleared_by, clear_reason, clear_verdict) values (${ids.bill}, ${flagId}::uuid, ${second!.raised_at}, '{IDENT.MUID_SHARED,IDENT.PHONE_SHARED}', now(), ${ids.operator}, 'both destinations checked in person', 'resolved')`,
    );
    const [n] = (await d.execute(sql`select count(*)::int as n from risk_holds where bill_id = ${ids.bill}`)) as unknown as { n: number }[];
    expect(n!.n).toBe(4);
    expect(await d.execute(sql`select 1 from risk_current_holds`)).toEqual([]);
  });

  it('shows only the latest run of a subject, and drops a flag the next run did not find', async () => {
    const d = await db();
    const run1 = uid();
    await flag('b1', 'IDENT.PHONE_SHARED', run1);
    await d.execute(sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence, computed_at) values (${run1}::uuid, 'bill', 'b1', 'META.EVALUATED', 'v1', 0, 'info', '{"findings":1}', now() - interval '1 minute')`);
    let current = (await d.execute(sql`select signal_id from risk_current_flags where subject_id = 'b1'`)) as unknown as { signal_id: string }[];
    expect(current.map((c) => c.signal_id)).toEqual(['IDENT.PHONE_SHARED']);
    const run2 = uid();
    await d.execute(sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence) values (${run2}::uuid, 'bill', 'b1', 'META.EVALUATED', 'v1', 0, 'info', '{"findings":0}')`);
    current = (await d.execute(sql`select signal_id from risk_current_flags where subject_id = 'b1'`)) as unknown as { signal_id: string }[];
    expect(current).toEqual([]);
    // The old flag is still there for the audit; it just is not current.
    const [n] = (await d.execute(sql`select count(*)::int as n from risk_flags where subject_id = 'b1'`)) as unknown as { n: number }[];
    expect(n!.n).toBe(3);
  });

  describe('the playerone_risk role', () => {
    /** Runs a statement as the engine's role, inside a rolled-back transaction, and returns the SQLSTATE if it failed. */
    async function asRisk(statement: ReturnType<typeof sql>): Promise<string | null> {
      const d = await db();
      try {
        await d.transaction(async (tx) => {
          await tx.execute(sql`set local role playerone_risk`);
          await tx.execute(statement);
          throw new Rollback();
        });
      } catch (err) {
        if (err instanceof Rollback) return null;
        for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
          const code = (e as { code?: string }).code;
          if (code) return code;
        }
        return 'unknown';
      }
      return null;
    }
    class Rollback extends Error {}

    it('exists, and the engine has no write access to bills, bill_lines, settlements, collectors, or a payout table', async () => {
      const { d, ids } = await scaffold();
      const [role] = (await d.execute(sql`select 1 as ok from pg_roles where rolname = 'playerone_risk'`)) as unknown as { ok: number }[];
      expect(role, 'the migrating user could not CREATE ROLE; see 0014_risk.sql').toBeDefined();
      // Agent B's table, created after the migration: default privileges give SELECT and nothing else.
      await d.execute(sql`create table if not exists payout_attempts (id uuid primary key default gen_random_uuid(), bill_id uuid not null references bills(id), amount_vnd bigint not null, status text not null)`);
      const INSUFFICIENT = '42501';
      expect(await asRisk(sql`update bills set total = 1 where id = ${ids.bill}`)).toBe(INSUFFICIENT);
      expect(await asRisk(sql`delete from bills where id = ${ids.bill}`)).toBe(INSUFFICIENT);
      expect(await asRisk(sql`insert into bill_lines (bill_id, settlement_id) values (${ids.bill}, ${uid()})`)).toBe(INSUFFICIENT);
      expect(await asRisk(sql`insert into settlements (id, episode_review_id, task_id, unit_price, effective_minutes, amount, settlement_state) values (${uid()}, ${uid()}, ${uid()}, 1, 1, 1, 'pending_settlement')`)).toBe(INSUFFICIENT);
      expect(await asRisk(sql`update settlements set settlement_state = 'manually_paid'`)).toBe(INSUFFICIENT);
      expect(await asRisk(sql`update collectors set status = 'suspended' where id = ${ids.collector}`)).toBe(INSUFFICIENT);
      expect(await asRisk(sql`insert into payout_attempts (bill_id, amount_vnd, status) values (${ids.bill}, 1, 'created')`)).toBe(INSUFFICIENT);
      expect(await asRisk(sql`update payout_attempts set status = 'succeeded'`)).toBe(INSUFFICIENT);
      expect(await asRisk(sql`insert into audit_events (action, target_table, target_id, actor_role, operator_id, upload_device_id, upload_centre_id) values ('x.login', 't', 'i', 'operator', null, null, null)`)).toBe(INSUFFICIENT);
      // Reads everywhere, writes on its own tables.
      expect(await asRisk(sql`select count(*) from bills`)).toBeNull();
      expect(await asRisk(sql`select count(*) from payout_attempts`)).toBeNull();
      expect(await asRisk(sql`insert into risk_flags (run_id, subject_type, subject_id, signal_id, threshold_version, points, severity, evidence) values (${uid()}::uuid, 'bill', 'b', 'IDENT.PHONE_SHARED', 'v1', 60, 'hold', '{}'::jsonb)`)).toBeNull();
      await d.execute(sql`drop table payout_attempts`);
    });
  });
});
