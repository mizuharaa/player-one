import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, hasDb, truncate, useDatabase, violates } from '../../store/test/db.ts';
import { insertAttemptAs, P0, seedAccount, seedBill, seedBills, seedPayout } from './payout/domain/fixture.ts';

useDatabase('migration_replay');

/**
 * 0011 and 0012 were edited after they were journaled, so a database migrated
 * before the edits has none of those guards and drizzle will never re-apply
 * them. 0016 replays the edited parts. This test puts a current database into
 * that older shape, runs 0016 over it, and proves every replayed guard fires;
 * then runs 0016 a second time over the now-current database to prove it puts
 * the same text back. The reproduction against a real pre-edit database
 * (migrated at c1cf15e, then 3907767, then HEAD) is in the commit that added
 * 0016.
 *
 * Since 0022 the second run is no longer a no-op in every respect, and the word
 * was removed for that reason: 0016's copy of `bills_total_matches_lines`
 * excuses any bill with no lines, and 0022 narrowed that to a bill worth
 * nothing. Replaying 0016 by hand therefore puts the older, weaker body back —
 * inside this file's own database, which `db()` keeps between runs. That is
 * correct for what this file claims, which is only that 0016 restores the
 * 0011/0012 text, and it cannot happen in a real database because drizzle
 * applies a tag once. But an assertion added here about the total check would
 * be exercising the pre-0022 function, so add it to `spine.test.ts` instead.
 */
describe.skipIf(!hasDb())('0016 replays the in-place edits to 0011 and 0012', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  async function replay(): Promise<void> {
    const d = await db();
    const text = await readFile(new URL('../../store/drizzle/0016_replay_bill_and_payout_guards.sql', import.meta.url), 'utf8');
    for (const stmt of text.split('--> statement-breakpoint')) {
      if (stmt.trim() !== '') await d.execute(sql.raw(stmt));
    }
  }

  /** The shape of a database that ran 0011 at c1cf15e and 0012 at 3907767. */
  async function regress(): Promise<void> {
    const d = await db();
    await d.execute(sql`
      drop trigger if exists bills_total_matches_lines on bills;
      drop trigger if exists bill_lines_total_matches on bill_lines;
      drop trigger if exists bill_lines_immutable on bill_lines;
      drop function if exists bills_total_matches_lines();
      drop function if exists bill_lines_immutable();
    `);
    // The pre-d84d60c guard did everything except read verify_status; a guard
    // that reads nothing stands in for it here, since the only claim tested is
    // that the replay puts the current body back.
    await d.execute(sql`
      create or replace function payout_attempts_guard() returns trigger language plpgsql as $$
      begin return new; end
      $$;
    `);
  }

  async function guardsFire(): Promise<void> {
    const d = await db();
    const ids = await seedPayout(d);
    const { bill2 } = await seedBills(d, ids);
    // 0011 (a8b20c6)
    await violates('bill_lines_immutable', d.execute(sql`delete from bill_lines where bill_id = ${bill2}`));
    // 0011 (e6624e5)
    await violates('bills_total_matches_lines', seedBill(d, ids, 1, P0, ['1200.0000'], '9.0000'));
    // 0012 (d84d60c)
    await d.execute(sql`update payout_accounts set is_current = false where collector_id = ${ids.collector2}`);
    const account = await seedAccount(d, ids, 2, { verifyStatus: 'unverified' });
    await violates(
      'payout_attempts_account_unverified',
      insertAttemptAs(d, ids, ids.finA, { billId: bill2, accountId: account, amountVnd: 1200 }),
    );
  }

  it('brings an old database up to the current 0011/0012 text', async () => {
    await regress();
    const d = await db();
    const before = await d.execute(sql`select count(*)::int as n from pg_trigger where tgname in ('bill_lines_immutable', 'bills_total_matches_lines', 'bill_lines_total_matches')`);
    expect((before as unknown as { n: number }[])[0]!.n).toBe(0);
    await replay();
    await guardsFire();
  });

  it('puts the same 0011/0012 text back on a database that is already current', async () => {
    await replay();
    await guardsFire();
  });
});
