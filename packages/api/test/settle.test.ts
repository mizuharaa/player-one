import { createHash, randomUUID } from 'node:crypto';
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
    const reviewAll = async () => {
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
    };
    await reviewAll();

    return { d, app, ids, headersA, headersB, send, expected, card, reviewAll };
  }

  /**
   * The cycle that contains now.
   *
   * A caller can no longer name an arbitrary window: `period_start` is a local
   * Vietnamese date and it has to sit on the lattice the anchor defines, so
   * that two cycles cannot overlap and quietly disagree about which one a
   * settlement was paid in. 1970-01-05 was a Monday, so a 7-day cycle always
   * begins on a Monday. This computes the same lattice the endpoint does.
   */
  const ANCHOR = Date.parse('1970-01-05T00:00:00+07:00');
  const DAY = 24 * 60 * 60 * 1000;
  /** The local date, in Vietnam, of the cycle boundary at or before `at`. */
  const cycleStart = (days = 7, at = Date.now()): string => {
    const ms = ANCHOR + Math.floor((at - ANCHOR) / (days * DAY)) * days * DAY;
    // +07:00 back to UTC midnight, so `toISOString` prints the local date.
    return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  };
  const period = () => ({ period_start: cycleStart() });
  const nextPeriod = () => ({ period_start: cycleStart(7, Date.now() + 7 * DAY) });

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
      const start = cycleStart(14);
      const res = await h.send('POST', '/api/settle/bills', { period_start: start });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().cycle_days).toBe(14);
      expect(Date.parse(res.json().period_end) - Date.parse(res.json().period_start)).toBe(14 * DAY);
      // The cycle length also decides which dates are cycle starts at all. A
      // Monday that begins a 7-day cycle need not begin a 14-day one.
      const odd = await h.send('POST', '/api/settle/bills', {
        period_start: cycleStart(7, Date.parse(`${start}T00:00:00+07:00`) + 7 * DAY),
      });
      expect(odd.statusCode).toBe(422);
      expect(odd.json().error).toContain('14-day cycle');
    });

    it('refuses anything that is not the start of a cycle', async () => {
      const h = await harness({ each: 1 });
      /**
       * The period used to be two free instants, and two of them overlapping —
       * `[17 Aug, 24 Aug)` and `[18 Aug, 25 Aug)` — were both valid keys on
       * `bills_collector_period_key`. Whichever generator ran first decided
       * which cycle a settlement was paid in. A cycle is now a position on a
       * lattice, so an overlapping one cannot be asked for.
       */
      for (const period_start of [
        '2026-08-18', // a Tuesday: inside a cycle, not the start of one
        '2026-08-17T00:00:00Z', // the old instant form
        '2026-02-30', // a date that does not exist, and which `Date.parse` rolls
        'last week',
        '',
      ]) {
        const res = await h.send('POST', '/api/settle/bills', { period_start });
        expect(res.statusCode, `${period_start} was accepted`).toBe(422);
      }
      // And a caller still sending the old `period_end` is refused rather than
      // quietly given a whole configured cycle it did not ask for.
      const stale = await h.send('POST', '/api/settle/bills', {
        period_start: period().period_start,
        period_end: '2026-08-18',
      });
      expect(stale.statusCode, stale.body).toBe(422);
      // And the refusal says which cycle the caller probably meant.
      const near = await h.send('POST', '/api/settle/bills', { period_start: '2026-08-18' });
      expect(near.json().error).toContain('2026-08-16T17:00:00.000Z');
    });

    it('bills nothing when nothing was owed before the cutoff', async () => {
      const h = await harness({ each: 1 });
      // 2020-01-06 was a Monday. Every settlement in the fixture was written
      // just now, so nothing was owed as of the end of that cycle.
      const res = await h.send('POST', '/api/settle/bills', { period_start: '2020-01-06' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().created).toBe(0);
      expect(res.json().bills).toEqual([]);
    });

    it('does not strand a settlement that becomes visible after the bill was issued', async () => {
      /**
       * The hole this closes. A review transaction can begin before the cutoff
       * — so its settlement's `created_at` falls inside the cycle — and commit
       * after the generator's SELECT has run. The bill is issued without it.
       *
       * This is also the only test that actually reaches
       * `onConflictDoNothing`: in the plain regeneration test every candidate is
       * already `bill_generated` by the second run, so the second run finds
       * nothing to bill and the unique index is never consulted. Here the
       * collector *does* have a payable settlement on the rerun, the insert is
       * attempted, and the index is what refuses it.
       *
       * Two things then have to be true: the rerun changes nothing at all, and
       * the late settlement is not lost — it is billed by the following cycle.
       */
      const h = await harness({ each: 1 });
      const first = await h.send('POST', '/api/settle/bills', period());
      expect(first.json().created).toBe(2);

      await h.card(h.headersA, h.ids.collector1, h.ids.device1, h.ids.taskHousework, 'CARD-3');
      await h.reviewAll();
      const late = (await h.d.execute(sql`
        select count(*)::int as n from settlements where settlement_state = 'pending_settlement'
      `)) as unknown as { n: number }[];
      expect(late[0]!.n).toBe(1);

      const snapshot = async () => {
        const rows = (await h.d.execute(sql`
          select (select count(*) from bills)::int as bills,
                 (select count(*) from bill_lines)::int as lines,
                 (select count(*) from audit_events where action = 'bill.generate')::int as audits,
                 (select string_agg(id::text || ':' || total, ',' order by id) from bills) as issued
        `)) as unknown as Record<string, unknown>[];
        return rows[0]!;
      };
      const before = await snapshot();
      const again = await h.send('POST', '/api/settle/bills', period());
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json().created).toBe(0);
      expect(await snapshot()).toEqual(before);

      /**
       * Not lost, and not billable early either. It is still `pending_settlement`
       * and on no line, so the following cycle will bill it — and that cycle
       * cannot be asked for until it starts, which is what the cutoff below is
       * for. The proof that a cycle bills an obligation older than itself is the
       * next test; this one only has to show the row survived.
       */
      const stranded = (await h.d.execute(sql`
        select s.settlement_state,
               (select count(*)::int from bill_lines bl where bl.settlement_id = s.id) as lines
          from settlements s
         where s.settlement_state = 'pending_settlement'
      `)) as unknown as { settlement_state: string; lines: number }[];
      expect(stranded).toHaveLength(1);
      expect(stranded[0]!.lines).toBe(0);

      const early = await h.send('POST', '/api/settle/bills', nextPeriod());
      expect(early.statusCode, early.body).toBe(422);
      expect(early.json().error).toContain('has not started');
    });

    it('bills an obligation older than the cycle that pays it', async () => {
      /**
       * `settleable` has no lower bound, and this is the property that needs.
       * A review that commits after its own cycle has been generated would
       * otherwise be stranded for ever: the bill is issued without it, a rerun
       * of that cycle changes nothing, and every later cycle would filter it out
       * for being too old. With no lower bound it appears on the next bill
       * instead, the way a payroll run treats a late timesheet — and each line
       * carries its own `reviewed_at`, so a line that predates its bill says so.
       *
       * The obligation is written directly, at a `created_at` three weeks back,
       * because that is the one field the review lane cannot be asked to fake:
       * `settlements_amount_immutable_check` freezes it the moment it exists.
       */
      const h = await harness({ each: 1 });
      await h.card(h.headersA, h.ids.collector1, h.ids.device1, h.ids.taskHousework, 'CARD-3');
      const [fresh] = (await h.d.execute(sql`
        select i.episode_id, i.ingest_id
          from episode_ingests i
         where not exists (select 1 from episode_reviews r where r.episode_id = i.episode_id)
         limit 1
      `)) as unknown as { episode_id: string; ingest_id: string }[];
      expect(fresh).toBeDefined();
      const reviewId = uid();
      await h.d.execute(sql`
        insert into episode_reviews (id, episode_id, ingest_id, measured_duration_s,
                                     effective_duration_s, review_state, reviewed_at, verdict_id)
          values (${reviewId}, ${fresh!.episode_id}, ${fresh!.ingest_id}, '16.000000',
                  '16.000000', 'pass', now() - interval '21 days', ${uid()});
      `);
      await h.d.execute(sql`
        insert into settlements (id, episode_review_id, task_id, collector_id, currency,
                                 unit_price, effective_minutes, amount, settlement_state,
                                 created_at)
          values (${uid()}, ${reviewId}, ${h.ids.taskHousework}, ${h.ids.collector1}, 'VND',
                  '1200.0000', '0.266667', '320.0004', 'pending_settlement',
                  now() - interval '21 days');
      `);

      const res = await h.send('POST', '/api/settle/bills', period());
      expect(res.statusCode, res.body).toBe(200);
      const bill = (
        res.json().bills as { id: string; collector_ref: string; lines: number }[]
      ).find((b) => b.collector_ref === 'c-0001')!;
      // Two lines: this cycle's verdict, and the three-week-old obligation.
      expect(bill.lines).toBe(2);
      const detail = await h.send('GET', `/api/settle/bills/${bill.id}`);
      const old = (detail.json().lines as { amount: string; reviewed_at: string }[]).find(
        (l) => l.amount === '320.0004',
      )!;
      expect(Date.parse(old.reviewed_at)).toBeLessThan(Date.parse(detail.json().period_start));
    });

    it('refuses a cycle that has not started', async () => {
      /**
       * The server owns the payable cutoff. Without it a caller could name any
       * aligned future cycle and sweep every settlement owed today onto a bill
       * labelled a week nobody has worked yet — and the run for the current
       * cycle would then find nothing left and issue no bill at all, so the
       * collector's pay would exist only on a document that lies about when it
       * was earned.
       */
      const h = await harness({ each: 1 });
      const ahead = await h.send('POST', '/api/settle/bills', nextPeriod());
      expect(ahead.statusCode, ahead.body).toBe(422);
      expect(ahead.json().error).toContain('has not started');
      const bills = (await h.d.execute(
        sql`select count(*)::int as n from bills`,
      )) as unknown as { n: number }[];
      expect(bills[0]!.n).toBe(0);
      // The cycle that contains now is still generatable while it is running: a
      // mid-cycle run bills what is owed so far.
      expect((await h.send('POST', '/api/settle/bills', period())).json().created).toBe(2);
    });

    it('two generators racing one cycle lose no settlement and duplicate none', async () => {
      /**
       * A retried request, an impatient operator, and a cron that fired twice.
       * Neither run may bill a settlement the other billed, and neither may
       * leave one behind. The database is what decides:
       * `bills_collector_period_key` has nowhere to put the second header and
       * `bill_lines_settlement_key` nowhere to put the second line, so the
       * loser rolls back whole rather than issuing half a bill.
       *
       * The loser is allowed to fail loudly — that is the honest answer to two
       * generators — so what is asserted is the state of the money, not the two
       * status codes.
       */
      const h = await harness();
      const [a, b] = await Promise.all([
        h.send('POST', '/api/settle/bills', period()),
        h.send('POST', '/api/settle/bills', period()),
      ]);
      for (const res of [a, b]) expect([200, 500]).toContain(res.statusCode);

      const [counts] = (await h.d.execute(sql`
        select (select count(*)::int from bills) as bills,
               (select count(*)::int from bill_lines) as lines,
               (select count(*)::int from settlements
                 where settlement_state = 'pending_settlement') as unbilled,
               (select count(*)::int from settlements s
                 where s.settlement_state = 'bill_generated'
                   and (select count(*) from bill_lines bl where bl.settlement_id = s.id) <> 1
               ) as mismatched,
               (select count(*)::int from audit_events where action = 'bill.generate') as audits
      `)) as unknown as Record<string, number>[];
      // Four verdicts, two collectors: two bills, four lines, each billed once.
      expect(counts).toEqual({ bills: 2, lines: 4, unbilled: 0, mismatched: 0, audits: 2 });
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

      // The settlement itself survives — it is the score of the review, and
      // what a dispute over a refused episode points at — but it is finished
      // rather than owed. In `pending_settlement` it was a debt always owed and
      // never paid, and every cycle from now to the end of the pilot would
      // rescan and re-count it.
      const zero = (await h.d.execute(sql`
        select settlement_state from settlements where amount = 0
      `)) as unknown as { settlement_state: string }[];
      expect(zero).toHaveLength(1);
      expect(zero[0]!.settlement_state).toBe('not_payable');
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

      // The export is a read, but it takes a collector's pay out of the system
      // in a form that can be forwarded, so PLT-07 wants to know who did it.
      const audits = (await h.d.execute(sql`
        select target_id, operator_id, after->>'lines' as lines
          from audit_events where action = 'bill.export'
      `)) as unknown as { target_id: string; operator_id: string; lines: string }[];
      expect(audits).toHaveLength(2);
      expect(new Set(audits.map((a) => a.target_id))).toEqual(new Set(bills.map((b) => b.id)));
      expect(audits.every((a) => a.operator_id === h.ids.operatorA)).toBe(true);
      expect(audits.every((a) => a.lines === '2')).toBe(true);
      // Which rows left, and a digest of the exact bytes, so a file somebody
      // produces later can be checked against the event rather than believed.
      // Every column in the artifact is live state that can move afterwards, so
      // without the hash the event proves only that an export happened.
      const named = (await h.d.execute(sql`
        select target_id,
               jsonb_array_length(after->'settlement_ids')::int as n,
               after->>'sha256' as sha256,
               after->>'total' as total
          from audit_events where action = 'bill.export'
      `)) as unknown as { target_id: string; n: number; sha256: string; total: string }[];
      expect(named.map((r) => r.n)).toEqual([2, 2]);
      for (const row of named) {
        expect(row.total).toBe(bills.find((b) => b.id === row.target_id)!.total);
        // Recomputed from the file finance was actually handed: the bill's own
        // block of it, in the order it was written.
        const block = res.body
          .replace('\ufeff', '')
          .split('\r\n')
          .filter((line) => line.startsWith(`"${row.target_id}"`))
          .join('\r\n');
        expect(block.split('\r\n')).toHaveLength(2);
        expect(row.sha256).toBe(createHash('sha256').update(block, 'utf8').digest('hex'));
      }

      // The filename carries the cycle's own local date. `toISOString()` on a
      // local-midnight instant prints the previous day, so this used to be off
      // by one for every cycle.
      expect(res.headers['content-disposition']).toContain(
        `playerone-settlement-${period().period_start}.csv`,
      );
    });

    it('does not hand finance a live formula in a task name', async () => {
      /**
       * Quoting a cell is not the same as defusing it. `=1+1` in a quoted CSV
       * field is still a formula when the file is opened, and a task name is
       * text an operator typed. The leading apostrophe is the standard
       * neutraliser and it is visible, which is the honest signal.
       */
      const h = await harness({ each: 1 });
      await h.d.execute(sql`update tasks set name = '=cmd|''/c calc''!A1' where id = ${h.ids.taskHousework}`);
      await h.d.execute(sql`update collectors set external_ref = '@SUM(A:A)' where id = ${h.ids.collector1}`);
      await h.send('POST', '/api/settle/bills', period());

      const body = (await h.send('GET', `/api/settle/export.csv?period_start=${period().period_start}`)).body;
      expect(body).toContain(`"'=cmd|'`);
      expect(body).toContain(`"'@SUM(A:A)"`);
      // Not merely quoted: no cell in the file opens with a formula character.
      for (const row of parseCsv(body)) {
        for (const cell of row) expect(cell[0] ?? '').not.toMatch(/[=+\-@]/);
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

    it('answers 404 for a bill that does not exist, and for one that cannot', async () => {
      const h = await harness({ each: 1 });
      expect((await h.send('POST', `/api/settle/bills/${uid()}/pay`)).statusCode).toBe(404);
      expect((await h.send('GET', `/api/settle/bills/${uid()}`)).statusCode).toBe(404);
      // A path segment that is not a UUID used to reach Postgres and come back
      // as a 500 (22P02, invalid input syntax). It is a missing bill.
      expect((await h.send('GET', '/api/settle/bills/not-a-uuid')).statusCode).toBe(404);
      expect((await h.send('POST', '/api/settle/bills/not-a-uuid/pay')).statusCode).toBe(404);
    });

    it('refuses to start with a cycle length that is not a whole number of days', async () => {
      // Configuration, so it fails at startup rather than answering every
      // billing request with a period of NaN days.
      const d = await db();
      for (const cycleDays of [Number.NaN, 0, -7, 1.5]) {
        expect(() => buildApi({ db: d, tokenSecret: SECRET, settlementCycleDays: cycleDays })).toThrow(
          /whole number of days/,
        );
      }
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
