import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { closeDb, db, dbUrl, hasDb, truncate, useDatabase } from '../../../../store/test/db.ts';
import { P1, insertAttemptAs, seedAccount, seedBills, uid } from '../domain/fixture.ts';
import { seedPayout } from '../domain/fixture.ts';

/**
 * `bin/payout-shadow.ts`, run the way an operator runs it.
 *
 * `shadowRun` and `shadowDiff` were reachable from tests and from nothing
 * else — no route, no process — so the G7 gate they exist to serve ("two
 * shadow cycles diffed clean") could not be reached on a deployment at all.
 * This file is why the entry point may not be deleted again: it spawns the
 * real process against a real database, with no ZaloPay credentials in its
 * environment, which is the manual pilot exactly.
 *
 * Spawned rather than imported, like `strip-only.test.ts`: the thing being
 * pinned is that the file starts under plain Node, reads its arguments, and
 * says what it found in an exit status a cron can act on.
 */

useDatabase('payout_shadow_cli');

const BIN = join(import.meta.dirname, '..', '..', '..', 'bin', 'payout-shadow.ts');

type Run = { status: number; out: string };

const shadow = (args: string[]): Run => {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: dbUrl(),
      PLAYERONE_PAYOUT_MODE: 'manual',
      /** No credentials: the pilot has none, and a run must not need any. */
      PLAYERONE_ZALOPAY_APP_ID: '',
      PLAYERONE_ZALOPAY_PAYMENT_ID: '',
      PLAYERONE_ZALOPAY_KEY1: '',
      PLAYERONE_ZALOPAY_PUBLIC_KEY: '',
    },
  });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};

const iso = (d: Date): string => d.toISOString();

describe.skipIf(!hasDb())('bin/payout-shadow.ts', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it('records the rail’s intention, and diffs clean once the operator has paid the cycle by hand', async () => {
    const d = await db();
    const ids = await seedPayout(d);
    const { bill1, bill2 } = await seedBills(d, ids);
    const account1 = await seedAccount(d, ids, 1);
    const account2 = await seedAccount(d, ids, 2);

    const run = shadow(['run', iso(P1.start), iso(P1.end)]);
    expect(run.status, run.out).toBe(0);
    const recorded = JSON.parse(run.out) as {
      runId: string;
      preflight_ok: boolean;
      refusal: string;
      intended: { bill_id: string; would_send: boolean; amount_vnd: number }[];
    };
    /** No wallet to read a balance from, said on the run rather than folded into every bill. */
    expect(recorded.preflight_ok).toBe(false);
    expect(recorded.refusal).toMatch(/no ZaloPay client/);
    expect(recorded.intended.map((i) => [i.bill_id, i.would_send, i.amount_vnd])).toEqual([
      [bill1, true, 2400],
      [bill2, true, 1200],
    ]);

    // The operator pays both, by hand, and types the references back.
    await insertAttemptAs(d, ids, ids.finA, {
      billId: bill1, accountId: account1, amountVnd: 2400, mode: 'manual', manualReference: 'VCB-1', settledAt: new Date(),
    });
    await insertAttemptAs(d, ids, ids.finA, {
      billId: bill2, accountId: account2, amountVnd: 1200, mode: 'manual', manualReference: 'VCB-2', settledAt: new Date(),
    });

    const diff = shadow(['diff', recorded.runId]);
    expect(diff.status, diff.out).toBe(0);
    expect(JSON.parse(diff.out)).toMatchObject({ bills: 2, agreed: 2, raised: 0, findings_by_kind: {} });
  });

  it('exits 1 and names the bill when the cycle was not paid as the rail intended', async () => {
    const d = await db();
    const ids = await seedPayout(d);
    const { bill1 } = await seedBills(d, ids);
    const account1 = await seedAccount(d, ids, 1);
    await seedAccount(d, ids, 2);

    const run = shadow(['run', iso(P1.start), iso(P1.end)]);
    expect(run.status, run.out).toBe(0);
    const runId = (JSON.parse(run.out) as { runId: string }).runId;

    // Only the first collector is paid; the second is the finding.
    await insertAttemptAs(d, ids, ids.finA, {
      billId: bill1, accountId: account1, amountVnd: 2400, mode: 'manual', manualReference: 'VCB-1', settledAt: new Date(),
    });

    const diff = shadow(['diff', runId]);
    expect(diff.status, diff.out).toBe(1);
    expect(JSON.parse(diff.out)).toMatchObject({ bills: 2, agreed: 1, raised: 1, findings_by_kind: { SHADOW_UNPAID: 1 } });
  });

  it('refuses what it cannot be asked, and never with a zero status', () => {
    expect(shadow([]).status).toBe(2);
    expect(shadow(['run']).status).toBe(2);
    expect(shadow(['run', 'not-a-date']).status).toBe(2);
    expect(shadow(['run', iso(P1.end), iso(P1.start)]).status).toBe(2);
    expect(shadow(['diff', uid()]).status).toBe(2);
    expect(shadow(['sprint']).status).toBe(2);
  });
});
