import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveEpisodeId, type EpisodeRecord } from '@playerone/contracts';
import { buildApi, hashCredential } from '../src/index.ts';
import { ZERO, add, fromDecimal, mul, quantise } from '../src/money.ts';
import { closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('settle');

/**
 * The rest of the money chain, over HTTP: SET-03, SET-05, SET-06, SET-07, BO-08.
 *
 * The fixture is deliberately not the smallest one that works. It has **two
 * collectors, two upload centres, two cards and two tasks at two prices**,
 * because a single-handover fixture is the exact shape that hid a payment bug in
 * the resolver: everything passed while candidate sessions were scoped to the
 * wrong thing, and one card per collector cannot tell the difference. A bill is
 * per collector, so a fixture with one collector cannot show that grouping works
 * either.
 *
 * The arithmetic is the one already pinned in `money.test.ts`: 16 seconds at
 * 1200 a minute is `0.266667` minutes and `320.0004`, where the exact product is
 * `320.0000`. It is carried end to end here on purpose — from a verdict, through
 * a settlement, onto a bill total and out into the CSV — because the property
 * that matters to a disputed invoice is that `unit_price × effective_minutes`
 * reproduces `amount` at every one of those stops.
 */

const SECRET = 'k';
const uid = () => randomUUID();
const T = Date.parse('2026-08-21T09:00:00.000Z');

/** Sixteen seconds of clean footage, which is the case the money tests pin. */
const record = (): EpisodeRecord => {
  const measured = 16;
  const path = `ego_AZER76400FE_20260813_${String(Math.random()).slice(2, 8)}`;
  return {
    schema_version: '1.1.0',
    // The submit route re-derives this from the basename and refuses anything else.
    episode_id: deriveEpisodeId(path),
    content_fingerprint: 'a'.repeat(64),
    state: 'ok',
    source: {
      path,
      ingest_tool_version: '0.3.1',
      ingested_at: new Date().toISOString(),
      ingest_host: 'test',
    },
    device: { serial: 'AZER76400FE', firmware_declared: '1.0.3', calibration_serial: null },
    declared: null,
    streams: [
      {
        role: 'camera_left',
        parts: [{ file: 'left_part0001.mp4', bytes: 64, sha256: 'b'.repeat(64) }],
        pts_source: 'sidecar',
        first_pts_us: String(T * 1000),
        last_pts_us: String((T + measured * 1000) * 1000),
        sample_count: 480,
        span_s: measured,
        nominal_rate_hz: 30,
      },
    ],
    timing: {
      method: 'pts_sidecar',
      confidence: 'exact',
      usable_start_us: String(T * 1000),
      usable_end_us: String((T + measured * 1000) * 1000),
      raw_duration_s: measured,
      max_stream_skew_ms: 0,
    },
    calibration: { present: true, files: [] },
    source_files: [],
    discrepancies: [],
    unclassified_files: [],
  };
};

/** Every field is quoted on the way out, and nothing in this fixture escapes. */
const parseCsv = (body: string): string[][] =>
  body
    .replace(/^﻿/, '')
    .trimEnd()
    .split('\r\n')
    .map((line) => line.slice(1, -1).split('","'));

describe.skipIf(!hasDb())('the settlement lifecycle', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  /**
   * Two centres, two operators, two collectors, two cards, two tasks.
   *
   * Each collector's episodes arrive on their own card at their own centre and
   * are reviewed by that centre's operator, which is the only arrangement that
   * can show a bill grouping by collector rather than by whoever happened to be
   * signed in.
   */
  async function harness(
    options: { cycleDays?: number; each?: number; reject?: number } = {},
  ) {
    const d = await db();
    const each = options.each ?? 2;
    const ids = {
      centreA: uid(),
      centreB: uid(),
      machineA: uid(),
      machineB: uid(),
      operatorA: uid(),
      operatorB: uid(),
      /** 0013: a bill is paid by finance, and never by the operator who issued it. */
      financeA: uid(),
      collector1: uid(),
      collector2: uid(),
      deviceType: uid(),
      device1: uid(),
      device2: uid(),
      taskHousework: uid(),
      taskFactory: uid(),
      scenario: uid(),
    };
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values (${ids.centreA}, 'HCM', 'District 7', 'active'), (${ids.centreB}, 'HAN', 'Cau Giay', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values (${ids.machineA}, ${ids.centreA}, 'HCM-01', 'active', ${hash}), (${ids.machineB}, ${ids.centreB}, 'HAN-01', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values (${ids.operatorA}, ${ids.centreA}, 'op-hcm', 'centre_operator', ${hash}), (${ids.operatorB}, ${ids.centreB}, 'op-han', 'centre_operator', ${hash}), (${ids.financeA}, ${ids.centreA}, 'fin-hcm', 'finance', ${hash}), (${uid()}, null, 'pax-01', 'reviewer', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector1}, 'c-0001', 'qualified'), (${ids.collector2}, 'c-0002', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego_headset', 'gen1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${ids.device1}, ${ids.deviceType}, 'AZER76400FE', 'active'), (${ids.device2}, ${ids.deviceType}, 'AZER76400FF', 'active')`);
    // SET-08: two prices, so a bill total cannot be right by accident.
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.taskHousework}, 'housework', 1200, 5, 'published'), (${ids.taskFactory}, 'factory', 900, 5, 'published')`);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);

    const app = buildApi({ db: d, tokenSecret: SECRET, settlementCycleDays: options.cycleDays });
    await app.ready();

    const login = async (machine: string, operator: string) => {
      const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: machine, secret: 'pw' } });
      const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: operator, secret: 'pw' } });
      return {
        'x-machine-token': `Bearer ${m.json().token}`,
        authorization: `Bearer ${o.json().token}`,
      };
    };
    const headersA = await login('HCM-01', 'op-hcm');
    const headersB = await login('HAN-01', 'op-han');
    /**
     * Who pays. `settlements_paid_by_finance` (0013) refuses `manually_paid`
     * unless the transaction's audit row names a finance operator who did not
     * issue the bill, so the operator who generates the cycle cannot also mark
     * it paid — that is the separation of duty, and it holds here too.
     */
    const headersF = await login('HCM-01', 'fin-hcm');
    /** A PaXini reviewer, signed in the way the console does it; scoped to `/api/review/`. */
    const headersR = await (async () => {
      const session = await app.inject({
        method: 'POST',
        url: '/api/session',
        payload: { role: 'reviewer', external_ref: 'pax-01', operator_secret: 'pw' },
      });
      expect(session.statusCode, session.body).toBe(200);
      const setCookie = [session.headers['set-cookie'] ?? []].flat().join(' | ');
      const token = /po_operator=([^;]+)/.exec(setCookie)?.[1] ?? '';
      return { authorization: `Bearer ${decodeURIComponent(token)}` };
    })();

    const send = async (
      method: 'POST' | 'GET',
      url: string,
      payload?: unknown,
      who: Record<string, string> = headersA,
    ): Promise<LightMyRequestResponse> =>
      (await app.inject({ method, url, payload: payload as never, headers: who })) as unknown as LightMyRequestResponse;

    /** One card, at one centre, carrying `each` episodes for one collector. */
    const card = async (
      who: Record<string, string>,
      collectorId: string,
      deviceId: string,
      taskId: string,
      tfCardId: string,
    ) => {
      const handover = uid();
      await send('POST', '/handovers', {
        id: handover,
        collector_id: collectorId,
        device_id: deviceId,
        tf_card_id: tfCardId,
        handover_time: new Date(T).toISOString(),
      }, who);
      const batch = uid();
      await send('POST', '/upload-batches', {
        id: batch,
        handover_id: handover,
        import_started_at: new Date(T).toISOString(),
      }, who);
      await send('POST', `/handovers/${handover}/sessions`, {
        id: uid(),
        task_id: taskId,
        scenario_id: ids.scenario,
        others_in_frame: false,
        sensitive_info_present: false,
        prepare_time: new Date(T - 60_000).toISOString(),
      }, who);
      const episodes = Array.from({ length: each }, record);
      const submitted = await send('POST', `/upload-batches/${batch}/episodes`, { episodes }, who);
      expect(submitted.statusCode, submitted.body).toBe(200);
      for (const e of submitted.json().episodes as { resolution_state: string }[]) {
        expect(e.resolution_state).toBe('resolved');
      }
    };

    await card(headersA, ids.collector1, ids.device1, ids.taskHousework, 'CARD-1');
    await card(headersB, ids.collector2, ids.device2, ids.taskFactory, 'CARD-2');

    /**
     * Review everything, all `good`, and record what each verdict was worth
     * against the collector it belongs to. The expectation is built from what
     * the queue actually handed out rather than from the fixture, so the test
     * does not quietly agree with itself about which episode is whose.
     */
    const expected = new Map<string, string[]>();
    let rejected = 0;
    for (const who of [headersA, headersB]) {
      for (;;) {
        const claimed = await send('POST', '/api/review/claim', undefined, who);
        if (claimed.statusCode === 204) break;
        expect(claimed.statusCode, claimed.body).toBe(200);
        const episode = claimed.json();
        expect(episode.measured_duration_seconds).toBe('16.000000');
        /**
         * `reject` episodes are refused rather than scored. The review lane
         * still writes a settlement for them, worth 0.0000, and it must not
         * reach a bill: SET-01 pays for pass and partial-pass only.
         */
        const reject = rejected < (options.reject ?? 0);
        const committed = await send('POST', '/api/review/verdict', {
          verdict_id: uid(),
          episode_id: episode.episode_id,
          decision: reject ? 'bad' : 'good',
          spans: [],
          reject_reasons: reject ? ['VQ-DARK'] : [],
        }, who);
        expect(committed.statusCode, committed.body).toBe(200);
        if (reject) {
          rejected += 1;
          expect(committed.json().amount).toBe('0.0000');
          continue;
        }
        const collector = episode.collector.display_name as string;
        const amounts = expected.get(collector) ?? [];
        amounts.push(committed.json().amount as string);
        expected.set(collector, amounts);
      }
    }

    return { d, app, ids, headersA, headersB, headersF, headersR, send, expected };
  }

  /**
   * A window that contains everything the harness writes. Fixed once, not
   * recomputed per call: a period built from `Date.now()` at each use drifts by
   * however long the test took, and a bill is looked up by the exact period it
   * was issued for.
   */
  const START = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const period = () => ({ period_start: START.toISOString() });

  // -------------------------------------------------------------------------

  describe('SET-07: generating a cycle', () => {
    it('writes one bill per collector, totalling exactly its own lines', async () => {
      const h = await harness();
      const res = await h.send('POST', '/api/settle/bills', period());
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();

      expect(body.created).toBe(2);
      expect(body.cycle_days).toBe(7);
      expect(body.bills).toHaveLength(2);

      type Bill = {
        id: string;
        collector_ref: string;
        total: string;
        lines: number;
        currency: string;
        paid: boolean;
      };
      const byCollector = new Map((body.bills as Bill[]).map((b) => [b.collector_ref, b]));
      const bill = (ref: string): Bill => byCollector.get(ref)!;
      // Two episodes each, 16 s apiece: 1200/min gives 320.0004 a line and
      // 900/min gives 240.0003. Neither total is reachable from the other's
      // price, so a bill grouped by the wrong collector cannot pass.
      expect(bill('c-0001').total).toBe('640.0008');
      expect(bill('c-0002').total).toBe('480.0006');
      expect(bill('c-0001').lines).toBe(2);
      expect(bill('c-0002').currency).toBe('VND');
      expect(bill('c-0001').paid).toBe(false);

      for (const ref of ['c-0001', 'c-0002']) {
        const detail = await h.send('GET', `/api/settle/bills/${bill(ref).id}`);
        const lines = detail.json().lines as {
          unit_price: string;
          effective_minutes: string;
          amount: string;
          settlement_state: string;
          episode_id: string;
        }[];
        expect(lines.map((l) => l.amount).sort()).toEqual(h.expected.get(ref)!.sort());
        for (const line of lines) {
          // The one property a disputed invoice is checked against.
          expect(
            quantise(mul(fromDecimal(line.unit_price), fromDecimal(line.effective_minutes)), 4),
          ).toBe(line.amount);
          expect(line.effective_minutes).toBe('0.266667');
          expect(line.settlement_state).toBe('bill_generated');
          // SET-04: the line names the episode it was paid for.
          expect(line.episode_id).toMatch(/^[0-9a-f-]{36}$/);
        }
      }
    });

    it('regenerating the cycle provably changes nothing', async () => {
      const h = await harness();
      const first = await h.send('POST', '/api/settle/bills', period());
      expect(first.json().created).toBe(2);

      const snapshot = async () => {
        const rows = (await h.d.execute(sql`
          select (select count(*) from bills)::int as bills,
                 (select count(*) from bill_lines)::int as lines,
                 (select count(*) from audit_events where action = 'bill.generate')::int as audits,
                 (select coalesce(sum(total), 0)::text from bills) as total,
                 (select string_agg(id::text || ':' || settlement_state, ',' order by id)
                    from settlements) as states,
                 (select string_agg(id::text || ':' || total, ',' order by id) from bills) as issued
        `)) as unknown as Record<string, unknown>[];
        return rows[0]!;
      };

      const before = await snapshot();
      const again = await h.send('POST', '/api/settle/bills', period());
      expect(again.statusCode, again.body).toBe(200);
      // Not "no error" — nothing moved. Same bill ids, same totals, same
      // settlement states, and no second audit row, because `mutate` never saw
      // a write: `bills_collector_period_key` refused the insert.
      expect(again.json().created).toBe(0);
      expect(await snapshot()).toEqual(before);
      expect(before['bills']).toBe(2);
      expect(before['lines']).toBe(4);
      expect(before['audits']).toBe(2);
    });

    it('takes the cycle length as a parameter, because weekly is only assumed', async () => {
      const h = await harness({ cycleDays: 14, each: 1 });
      const res = await h.send('POST', '/api/settle/bills', period());
      expect(res.json().cycle_days).toBe(14);
      expect(Date.parse(res.json().period_end) - START.getTime()).toBe(14 * 24 * 60 * 60 * 1000);

      // An explicit end still wins over the cycle.
      const explicit = await h.send('GET', '/api/settle/bills?period_start=2026-08-17T00:00:00Z&period_end=2026-08-18T00:00:00Z');
      expect(explicit.json().period_end).toBe('2026-08-18T00:00:00.000Z');
    });

    it('refuses a period that ends before it starts', async () => {
      const h = await harness({ each: 1 });
      const res = await h.send('POST', '/api/settle/bills', {
        period_start: '2026-08-24T00:00:00Z',
        period_end: '2026-08-17T00:00:00Z',
      });
      expect(res.statusCode).toBe(422);
    });

    it('bills nothing when the cycle contains no verdicts', async () => {
      const h = await harness({ each: 1 });
      const res = await h.send('POST', '/api/settle/bills', {
        period_start: '2020-01-06T00:00:00Z',
        period_end: '2020-01-13T00:00:00Z',
      });
      expect(res.json().created).toBe(0);
      expect(res.json().bills).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------

  describe('SET-01: a rejected episode is not billable', () => {
    it('leaves the zero-value settlement off the bill and reports it', async () => {
      // Two episodes per collector, one of which is rejected: one collector's
      // bill loses a line, the other's does not.
      const h = await harness({ reject: 1 });
      const res = await h.send('POST', '/api/settle/bills', period());
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();

      expect(body.not_payable).toBe(1);
      // Whose episode came off the queue first is the queue's business, so the
      // expectation is built from the verdicts that actually paid: one collector
      // is billed for one line, the other for two, and each total is the exact
      // sum of the amounts the review lane returned.
      expect(body.bills).toHaveLength(2);
      for (const b of body.bills as { collector_ref: string; total: string; lines: number }[]) {
        const paidFor = h.expected.get(b.collector_ref)!;
        expect(b.lines).toBe(paidFor.length);
        expect(b.total).toBe(
          quantise(paidFor.reduce((acc, a) => add(acc, fromDecimal(a)), ZERO), 4),
        );
      }
      expect(
        (body.bills as { lines: number }[]).map((b) => b.lines).sort(),
      ).toEqual([1, 2]);

      const lines = (await h.d.execute(
        sql`select count(*)::int as n from bill_lines`,
      )) as unknown as { n: number }[];
      expect(lines[0]!.n).toBe(3);

      // The settlement itself survives — it is the score of the review — and
      // stays where the review lane put it.
      const zero = (await h.d.execute(sql`
        select settlement_state from settlements where amount = 0
      `)) as unknown as { settlement_state: string }[];
      expect(zero).toHaveLength(1);
      expect(zero[0]!.settlement_state).toBe('pending_settlement');
    });
  });

  describe('SET-06: the export finance checks', () => {
    it('exports every line of every bill, with its arithmetic intact', async () => {
      const h = await harness();
      await h.send('POST', '/api/settle/bills', period());

      const res = await h.send('GET', `/api/settle/export.csv?period_start=${encodeURIComponent(period().period_start)}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      // Excel reads a BOM-less UTF-8 CSV as the local code page, and task names
      // are Chinese in production.
      expect(res.body.startsWith('﻿')).toBe(true);

      const rows = parseCsv(res.body);
      const header = rows[0]!;
      expect(rows).toHaveLength(5);
      const col = (row: string[], name: string) => row[header.indexOf(name)]!;

      const totals = new Map<string, string[]>();
      for (const row of rows.slice(1)) {
        expect(
          quantise(
            mul(fromDecimal(col(row, 'unit_price')), fromDecimal(col(row, 'effective_minutes'))),
            4,
          ),
        ).toBe(col(row, 'amount'));
        expect(col(row, 'currency')).toBe('VND');
        expect(col(row, 'settlement_state')).toBe('bill_generated');
        expect(col(row, 'episode_id')).toMatch(/^[0-9a-f-]{36}$/);
        const key = col(row, 'bill_id');
        totals.set(key, [...(totals.get(key) ?? []), col(row, 'amount')]);
      }

      // The sum of the exported amounts is the stored bill total, to the last
      // ten-thousandth, on both bills.
      const bills = (await h.send('GET', `/api/settle/bills?period_start=${encodeURIComponent(period().period_start)}`)).json().bills as { id: string; total: string }[];
      expect(bills).toHaveLength(2);
      for (const bill of bills) {
        // Exact, with `money.ts`'s own rationals. `toBeCloseTo` on floats would
        // pass for a bill that is a ten-thousandth out, which is the whole class
        // of error this column exists to catch.
        const summed = quantise(
          totals.get(bill.id)!.reduce((acc, a) => add(acc, fromDecimal(a)), ZERO),
          4,
        );
        expect(summed).toBe(bill.total);
        expect(totals.get(bill.id)).toHaveLength(2);
      }
    });
  });

  // -------------------------------------------------------------------------

  describe('SET-05: exception, and the way back', () => {
    type Row = { id: string; settlement_state: string; amount: string };
    const settlements = async (h: Awaited<ReturnType<typeof harness>>): Promise<Row[]> =>
      (await h.d.execute(sql`select id, settlement_state, amount::text as amount from settlements order by created_at, id`)) as unknown as Row[];
    const events = async (h: Awaited<ReturnType<typeof harness>>, action: string): Promise<number> => {
      const rows = (await h.d.execute(sql`select count(*)::int as n from audit_events where action = ${action}`)) as unknown as { n: number }[];
      return rows[0]!.n;
    };

    it('parks a queued settlement with a reason, and generating the cycle leaves it out and counts it', async () => {
      const h = await harness();
      const [first] = await settlements(h);
      const parked = await h.send('POST', `/api/settle/settlements/${first!.id}/exception`, {
        reason: 'wrong_collector',
        note: 'card CARD-1 was carried by c-0002 that week',
      });
      expect(parked.statusCode, parked.body).toBe(200);
      expect(parked.json()).toEqual({
        id: first!.id,
        amount: first!.amount,
        settlement_state: 'exception',
        exception_from_state: 'pending_settlement',
        exception_reason: 'wrong_collector',
        exception_note: 'card CARD-1 was carried by c-0002 that week',
      });

      const res = await h.send('POST', '/api/settle/bills', period());
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().exception).toBe(1);
      expect(res.json().created).toBe(2);
      const lines = (await h.d.execute(sql`select count(*)::int as n from bill_lines`)) as unknown as { n: number }[];
      expect(lines[0]!.n).toBe(3);
      expect((res.json().bills as { exceptions: number }[]).map((b) => b.exceptions)).toEqual([0, 0]);
      expect((await h.send('GET', `/api/settle/bills?period_start=${encodeURIComponent(period().period_start)}`)).json().exception).toBe(1);

      // The event says who, what and why, in the same transaction as the move.
      const [event] = (await h.d.execute(sql`
        select operator_id::text as operator_id, reason, before, after from audit_events where action = 'settlement.exception'
      `)) as unknown as { operator_id: string; reason: string; before: unknown; after: unknown }[];
      expect(event!.operator_id).toBe(h.ids.operatorA);
      expect(event!.reason).toBe('wrong_collector');
      expect(event!.before).toEqual({ settlement_state: 'pending_settlement' });
      expect(event!.after).toMatchObject({ settlement_state: 'exception', exception_from_state: 'pending_settlement' });
    });

    it('is idempotent: the same request twice is one event, and a release twice is one event', async () => {
      const h = await harness({ each: 1 });
      const [first] = await settlements(h);
      const body = { reason: 'disputed', note: 'PaXini disputed the effective minutes' };
      const once = await h.send('POST', `/api/settle/settlements/${first!.id}/exception`, body);
      const twice = await h.send('POST', `/api/settle/settlements/${first!.id}/exception`, body);
      expect(once.statusCode).toBe(200);
      expect(twice.statusCode).toBe(200);
      expect(twice.json()).toEqual(once.json());
      expect(await events(h, 'settlement.exception')).toBe(1);
      // A different reason on a parked row does not overwrite the first one.
      const other = await h.send('POST', `/api/settle/settlements/${first!.id}/exception`, { reason: 'duplicate', note: 'second thoughts' });
      expect(other.json().exception_reason).toBe('disputed');
      expect(await events(h, 'settlement.exception')).toBe(1);

      const released = await h.send('POST', `/api/settle/settlements/${first!.id}/release`, { note: 'resolved with PaXini' });
      expect(released.statusCode, released.body).toBe(200);
      expect(released.json()).toEqual({
        id: first!.id,
        amount: first!.amount,
        settlement_state: 'pending_settlement',
        exception_from_state: null,
        exception_reason: null,
        exception_note: null,
      });
      const again = await h.send('POST', `/api/settle/settlements/${first!.id}/release`);
      expect(again.statusCode).toBe(409);
      expect(again.json().constraint).toBe('settlements_not_in_exception');
      expect(await events(h, 'settlement.release')).toBe(1);
    });

    it('validates the reason, the id and the actor', async () => {
      const h = await harness({ each: 1 });
      const [first] = await settlements(h);
      const url = `/api/settle/settlements/${first!.id}/exception`;
      expect((await h.send('POST', url, {})).statusCode).toBe(400);
      expect((await h.send('POST', url, { reason: 'because', note: 'n' })).statusCode).toBe(400);
      // The reason code AND the sentence are both required: SET-05's slice asks
      // for a code to count on and free text for whoever has to undo this.
      expect((await h.send('POST', url, { reason: 'disputed' })).statusCode).toBe(400);
      // `superseded` is reserved for the dispute lane's own SQL and no route
      // may write it: a row parked under it can never be released.
      expect((await h.send('POST', url, { reason: 'superseded', note: 'n' })).statusCode).toBe(400);
      expect((await h.send('POST', url, { reason: 'disputed', note: '   ' })).statusCode).toBe(400);
      expect((await h.send('POST', url, { reason: 'disputed', note: 'x'.repeat(2001) })).statusCode).toBe(400);
      expect((await h.send('POST', '/api/settle/settlements/not-a-uuid/exception', { reason: 'disputed', note: 'n' })).statusCode).toBe(400);
      expect((await h.send('POST', `/api/settle/settlements/${uid()}/exception`, { reason: 'disputed', note: 'n' })).statusCode).toBe(404);
      expect((await h.send('POST', `/api/settle/settlements/${uid()}/release`)).statusCode).toBe(404);
      // A reviewer session is scoped to review (PLT-10) and never reaches settlement.
      expect((await h.send('POST', url, { reason: 'disputed', note: 'n' }, h.headersR)).statusCode).toBe(403);
      expect((await h.send('POST', `/api/settle/settlements/${first!.id}/release`, {}, h.headersR)).statusCode).toBe(403);
      // Nothing above moved the row or wrote an event.
      expect((await settlements(h))[0]!.settlement_state).toBe('pending_settlement');
      expect(await events(h, 'settlement.exception')).toBe(0);
      // Finance may park too; a centre operator at the other centre may as well.
      expect((await h.send('POST', url, { reason: 'manual_hold', note: 'finance hold pending the ZaloPay reconciliation' }, h.headersF)).statusCode).toBe(200);
      expect((await h.send('POST', `/api/settle/settlements/${first!.id}/release`, {}, h.headersB)).statusCode).toBe(200);
    });

    it('parks a billed line: the bill keeps it, shows it, and cannot be paid until it is released', async () => {
      const h = await harness({ each: 1 });
      const generated = await h.send('POST', '/api/settle/bills', period());
      const bill = (generated.json().bills as { id: string; collector_ref: string; total: string }[]).find((b) => b.collector_ref === 'c-0001')!;
      const [line] = (await h.send('GET', `/api/settle/bills/${bill.id}`)).json().lines as { settlement_id: string }[];

      const parked = await h.send('POST', `/api/settle/settlements/${line!.settlement_id}/exception`, { reason: 'duplicate', note: 'same footage already paid on last week’s bill' });
      expect(parked.statusCode, parked.body).toBe(200);
      expect(parked.json().exception_from_state).toBe('bill_generated');

      const detail = (await h.send('GET', `/api/settle/bills/${bill.id}`)).json();
      expect(detail.exceptions).toBe(1);
      expect(detail.paid).toBe(false);
      expect(detail.total).toBe(bill.total);
      expect(detail.lines).toHaveLength(1);
      expect(detail.lines[0].settlement_state).toBe('exception');
      const listed = (await h.send('GET', `/api/settle/bills?period_start=${encodeURIComponent(period().period_start)}`)).json();
      expect((listed.bills as { id: string; exceptions: number }[]).find((b) => b.id === bill.id)!.exceptions).toBe(1);
      // SET-05: a parked line cannot be billed, paid OR exported. The line is
      // excluded from the file, and because it is still inside the bill's
      // stored total the export then refuses that bill by name rather than
      // handing finance a file whose lines do not add up to its own total
      // column. Both halves are here: the excluded row is worth the whole
      // bill, so `exported_total` is zero against a non-zero `total`.
      const exported = await h.send('GET', `/api/settle/export.csv?period_start=${encodeURIComponent(period().period_start)}`);
      expect(exported.statusCode, exported.body).toBe(409);
      expect(exported.json().constraint).toBe('settle_export_bill_in_exception');
      expect(exported.json().bills).toEqual([
        {
          id: bill.id,
          collector_ref: bill.collector_ref,
          total: bill.total,
          exported_total: '0.0000',
          excluded_lines: 1,
        },
      ]);
      // Not one byte of CSV, so the parked settlement cannot be in it.
      expect(exported.body).not.toContain(line!.settlement_id);

      // The manual rail refuses by name, before it asks about the account or the total.
      const pay = await h.send('POST', `/api/payout/bills/${bill.id}/mark-paid`, { manual_reference: 'TX-1', amount_vnd: 320 }, h.headersF);
      expect(pay.statusCode, pay.body).toBe(409);
      expect(pay.json().constraint).toBe('payout_settlement_exception');
      expect(await events(h, 'bill.mark_paid')).toBe(0);
      // What the collector's own income screen is told (APP-33/34). `approved`
      // is printed as "Đã duyệt, chờ chi trả" — approved, awaiting payment —
      // and neither rail will pay this bill, so it must not say that. It falls
      // into the existing neutral `on_hold` bucket, and the response carries no
      // reason code and no note: the reason may name another collector and the
      // note is internal evidence.
      const income = await h.send('GET', `/api/payout/collectors/${h.ids.collector1}/income`, undefined, h.headersF);
      expect(income.statusCode, income.body).toBe(200);
      const shown = (income.json().periods as { bill_id: string | null; status: string }[]).find((p) => p.bill_id === bill.id)!;
      expect(shown.status).toBe('on_hold');
      expect(income.body).not.toContain('duplicate');
      expect(income.body).not.toContain('exception');
      expect(income.body).not.toContain('same footage already paid');

      // And the preflight lists it as an issue rather than a payable bill.
      const preflight = await h.send('POST', `/api/payout/batches/${encodeURIComponent(period().period_start)}/preflight`, {}, h.headersF);
      expect(preflight.statusCode, preflight.body).toBe(200);
      expect(preflight.json().counts.line_in_exception).toBe(1);
      expect((preflight.json().exceptions as { id: string; issues: string[] }[]).find((b) => b.id === bill.id)!.issues).toContain('line_in_exception');

      // Released: back onto the bill, not into the queue, and the cycle does not re-bill it.
      const released = await h.send('POST', `/api/settle/settlements/${line!.settlement_id}/release`);
      expect(released.json().settlement_state).toBe('bill_generated');
      expect((await h.send('POST', '/api/settle/bills', period())).json().created).toBe(0);
      expect((await h.send('GET', `/api/settle/bills/${bill.id}`)).json().exceptions).toBe(0);
      // Released, the same screen goes back to saying the money is approved.
      const reopenedIncome = await h.send('GET', `/api/payout/collectors/${h.ids.collector1}/income`, undefined, h.headersF);
      expect((reopenedIncome.json().periods as { bill_id: string | null; status: string }[]).find((p) => p.bill_id === bill.id)!.status).toBe('approved');

      const after = await h.send('POST', `/api/payout/bills/${bill.id}/mark-paid`, { manual_reference: 'TX-1', amount_vnd: 320 }, h.headersF);
      expect(after.json().constraint).not.toBe('payout_settlement_exception');

      // And with nothing parked the export runs again, with the line back in
      // it and its own arithmetic unchanged.
      const reopened = await h.send('GET', `/api/settle/export.csv?period_start=${encodeURIComponent(period().period_start)}`);
      expect(reopened.statusCode, reopened.body).toBe(200);
      const csv = parseCsv(reopened.body);
      const header = csv[0]!;
      const row = csv.slice(1).find((r) => r[header.indexOf('bill_id')] === bill.id)!;
      expect(row![header.indexOf('settlement_state')]).toBe('bill_generated');
      expect(row![header.indexOf('amount')]).toBe(bill.total);
    });

    it('a row released after its collector was billed is deferred, counted, and billed by the NEXT cycle', async () => {
      /**
       * The scenario the summary used to answer `200 {created: 0}` for, walked
       * end to end.
       *
       * Park a queued settlement, run the cycle so the collector's bill for the
       * period goes out without it, release it back to `pending_settlement`,
       * and run the same period again. `bills_collector_period_key` has nowhere
       * to put a second bill for that collector and period, so the insert
       * conflicts and `mutate` writes nothing — and before this the answer was
       * byte-identical to a period in which nothing at all was owed.
       *
       * Daniel's decision: the money rolls into the next cycle and there is no
       * supplementary bill. So the re-run says who is owed and how much is
       * waiting, and the next cycle actually pays it — exactly once. That last
       * half only works because `settleable` has no start date; with one, this
       * row's `created_at` sat inside a period already billed and outside every
       * later one, and no cycle would ever have found it again.
       */
      const h = await harness();
      const [first] = await settlements(h);
      const parked = await h.send('POST', `/api/settle/settlements/${first!.id}/exception`, {
        reason: 'wrong_collector',
        note: 'checking whose card this was before it goes on a bill',
      });
      expect(parked.statusCode, parked.body).toBe(200);
      expect(parked.json().exception_from_state).toBe('pending_settlement');

      const generated = await h.send('POST', '/api/settle/bills', period());
      expect(generated.json().created).toBe(2);
      expect(generated.json().deferred_to_next_period).toEqual({ settlements: 0, collector_refs: [] });
      // The parked row's collector was billed for the period, one line short.
      const short = (generated.json().bills as { id: string; collector_ref: string; lines: number }[]).find((b) => b.lines === 1)!;
      expect(short).toBeDefined();

      const released = await h.send('POST', `/api/settle/settlements/${first!.id}/release`, { note: 'it was the right collector after all' });
      expect(released.json().settlement_state).toBe('pending_settlement');

      const again = await h.send('POST', '/api/settle/bills', period());
      expect(again.statusCode, again.body).toBe(200);
      const body = again.json();
      // The money is owed, and the answer names whose it is instead of reading
      // like an empty period. `not_payable` counts zero-amount rows and
      // `exception` counts still-parked ones: neither can see this row.
      expect(body.deferred_to_next_period).toEqual({ settlements: 1, collector_refs: [short.collector_ref] });
      expect(body.created).toBe(0);
      expect(body.not_payable).toBe(0);
      expect(body.exception).toBe(0);

      // And nothing was written by the re-run: no second bill, no line, no event.
      const state = (await h.d.execute(sql`
        select (select count(*) from bills)::int as bills,
               (select count(*) from bill_lines)::int as lines,
               (select settlement_state from settlements where id = ${first!.id}) as state,
               (select count(*) from bill_lines where settlement_id = ${first!.id})::int as billed
      `)) as unknown as { bills: number; lines: number; state: string; billed: number }[];
      expect(state[0]).toMatchObject({ bills: 2, lines: 3, state: 'pending_settlement', billed: 0 });
      expect(await events(h, 'bill.generate')).toBe(2);

      // The next cycle bills it, on its own bill, for exactly what it is worth.
      const nextStart = new Date(START.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const next = await h.send('POST', '/api/settle/bills', { period_start: nextStart });
      expect(next.statusCode, next.body).toBe(200);
      expect(next.json().created).toBe(1);
      expect(next.json().deferred_to_next_period).toEqual({ settlements: 0, collector_refs: [] });
      // `billsIn` windows on the bill's own period_start, so this list is the
      // new period's bills only: one, for the collector who was owed.
      const nextBills = next.json().bills as { id: string; collector_ref: string; total: string; lines: number }[];
      expect(nextBills).toHaveLength(1);
      const arrears = nextBills[0]!;
      expect(arrears.collector_ref).toBe(short.collector_ref);
      expect(arrears.id).not.toBe(short.id);
      expect(arrears.lines).toBe(1);
      expect(arrears.total).toBe(first!.amount);

      // Exactly once: one line, on the new bill, and the row has moved on.
      const billed = (await h.d.execute(sql`
        select bill_id::text as bill_id from bill_lines where settlement_id = ${first!.id}
      `)) as unknown as { bill_id: string }[];
      expect(billed).toHaveLength(1);
      expect(billed[0]!.bill_id).toBe(arrears.id);
      expect((await settlements(h)).find((s) => s.id === first!.id)!.settlement_state).toBe('bill_generated');

      // And running the next cycle a second time still changes nothing.
      const twice = await h.send('POST', '/api/settle/bills', { period_start: nextStart });
      expect(twice.json().created).toBe(0);
      expect(twice.json().deferred_to_next_period).toEqual({ settlements: 0, collector_refs: [] });
      expect(await events(h, 'bill.generate')).toBe(3);
    });

    it('refuses to park a paid settlement, because paid is final', async () => {
      const h = await harness({ each: 1 });
      const [first] = await settlements(h);
      // Paid the way 0013 requires: a finance operator who did not issue the
      // bill, in the same transaction as the move. Straight SQL, so the row is
      // `manually_paid` without a payout account in the fixture.
      await h.send('POST', '/api/settle/bills', period());
      const [bill] = (await h.d.execute(sql`select bill_id::text as bill_id from bill_lines where settlement_id = ${first!.id}`)) as unknown as { bill_id: string }[];
      await h.d.transaction(async (tx) => {
        await tx.execute(sql`update settlements set settlement_state = 'manually_paid', updated_at = now() where id = ${first!.id}`);
        await tx.execute(sql`
          insert into audit_events (action, target_table, target_id, actor_role, operator_id, upload_device_id, upload_centre_id)
            values ('bill.pay', 'bills', ${bill!.bill_id}, 'operator', ${h.ids.financeA}, ${h.ids.machineA}, ${h.ids.centreA})
        `);
      });
      const res = await h.send('POST', `/api/settle/settlements/${first!.id}/exception`, { reason: 'disputed', note: 'too late, it is paid' });
      expect(res.statusCode).toBe(409);
      expect(res.json().constraint).toBe('settlements_transition_check');
      expect((await settlements(h)).find((s) => s.id === first!.id)!.settlement_state).toBe('manually_paid');
      expect(await events(h, 'settlement.exception')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  it('SET-02 holds through the bill: a settlement still reaches an episode only via a review', async () => {
    const h = await harness({ each: 1 });
    await h.send('POST', '/api/settle/bills', period());
    const rows = (await h.d.execute(sql`
      select ccu.table_name as target
        from information_schema.table_constraints tc
        join information_schema.constraint_column_usage ccu
          on ccu.constraint_name = tc.constraint_name
       where tc.table_name in ('bills', 'bill_lines') and tc.constraint_type = 'FOREIGN KEY'
    `)) as unknown as { target: string }[];
    const targets = new Set(rows.map((r) => r.target));
    expect(targets).not.toContain('episodes');
    expect(targets).not.toContain('upload_batches');
    expect(targets).toEqual(new Set(['bills', 'collectors', 'settlements']));
  });
});
