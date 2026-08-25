import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EpisodeRecord } from '@playerone/contracts';
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
  return {
    schema_version: '1.1.0',
    episode_id: uid(),
    content_fingerprint: 'a'.repeat(64),
    state: 'ok',
    source: {
      path: `ego_AZER76400FE_20260813_${String(Math.random()).slice(2, 8)}`,
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
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values (${ids.operatorA}, ${ids.centreA}, 'op-hcm', 'centre_operator', ${hash}), (${ids.operatorB}, ${ids.centreB}, 'op-han', 'centre_operator', ${hash})`);
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

    return { d, app, ids, headersA, headersB, send, expected };
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

  describe('SET-03: finance marks manual payment', () => {
    it('moves every line to manually_paid and audits it in the same transaction', async () => {
      const h = await harness();
      const generated = await h.send('POST', '/api/settle/bills', period());
      const bills = generated.json().bills as { id: string; collector_ref: string }[];
      const target = bills.find((b) => b.collector_ref === 'c-0001')!;
      const other = bills.find((b) => b.collector_ref === 'c-0002')!;

      const paid = await h.send('POST', `/api/settle/bills/${target.id}/pay`);
      expect(paid.statusCode, paid.body).toBe(200);
      expect(paid.json().paid).toBe(true);
      expect(paid.json().marked).toBe(2);
      for (const s of paid.json().settlements as { settlement_state: string }[]) {
        expect(s.settlement_state).toBe('manually_paid');
      }

      // The other collector's bill is untouched. A payment run that quietly
      // settles somebody else's work is the failure worth testing for.
      const untouched = await h.send('GET', `/api/settle/bills/${other.id}`);
      expect(untouched.json().paid).toBe(false);
      for (const l of untouched.json().lines as { settlement_state: string }[]) {
        expect(l.settlement_state).toBe('bill_generated');
      }

      const audits = (await h.d.execute(sql`
        select action, target_id, operator_id, upload_device_id
          from audit_events where action = 'bill.pay'
      `)) as unknown as { target_id: string; operator_id: string; upload_device_id: string }[];
      expect(audits).toHaveLength(1);
      expect(audits[0]!.target_id).toBe(target.id);
      expect(audits[0]!.operator_id).toBe(h.ids.operatorA);
      expect(audits[0]!.upload_device_id).toBe(h.ids.machineA);
    });

    it('paying a bill twice marks nothing the second time', async () => {
      const h = await harness({ each: 1 });
      const bills = (await h.send('POST', '/api/settle/bills', period())).json().bills as { id: string }[];
      await h.send('POST', `/api/settle/bills/${bills[0]!.id}/pay`);

      const again = await h.send('POST', `/api/settle/bills/${bills[0]!.id}/pay`);
      expect(again.statusCode).toBe(200);
      expect(again.json().marked).toBe(0);
      expect(again.json().paid).toBe(true);

      const audits = (await h.d.execute(
        sql`select count(*)::int as n from audit_events where action = 'bill.pay'`,
      )) as unknown as { n: number }[];
      // `mutate` writes no audit row for a write that changed nothing, which is
      // what keeps a retried request from inventing a second payment event.
      expect(audits[0]!.n).toBe(1);
    });

    it('answers 404 for a bill that does not exist', async () => {
      const h = await harness({ each: 1 });
      expect((await h.send('POST', `/api/settle/bills/${uid()}/pay`)).statusCode).toBe(404);
      expect((await h.send('GET', `/api/settle/bills/${uid()}`)).statusCode).toBe(404);
    });

    it('needs both tokens, like every other mutation on this service', async () => {
      const h = await harness({ each: 1 });
      const res = await h.app.inject({ method: 'POST', url: '/api/settle/bills', payload: period() });
      expect(res.statusCode).toBe(401);
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
