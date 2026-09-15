import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, hasDb, truncate, violates, useDatabase } from './db.ts';

/**
 * `collector_notifications` (0032), in raw SQL with no application in the path.
 *
 * Two invariants carry the design and both are asserted here rather than in
 * TypeScript, because both are the kind that a route could bypass:
 *
 *   - the kind vocabulary, so an invented kind cannot reach a collector's inbox
 *   - the (collector, kind, source) uniqueness, which is what makes a retry of
 *     a delivery, a verdict or a payment free rather than a second sentence
 *     about the same event
 *
 * The rest of the file pins the shapes that would otherwise go wrong quietly: a
 * payload that is not an object, an empty source, a read stamp before the row
 * existed, and a collector id that names nobody.
 */

useDatabase('collector_notifications');

const uid = () => randomUUID();

async function seed() {
  const d = await db();
  const ids = { collector1: uid(), collector2: uid() };
  // Two collectors, never one: a single-actor fixture is the exact shape that
  // hid a payment bug in this repository once.
  await d.execute(sql`insert into collectors (id, external_ref, status)
    values (${ids.collector1}, 'c-0001', 'qualified'), (${ids.collector2}, 'c-0002', 'qualified')`);
  return ids;
}

const insert = (
  id: string,
  collectorId: string,
  kind: string,
  source: [string, string],
  payload = `'{}'`,
) => sql`
  insert into collector_notifications (id, collector_id, kind, payload, source_table, source_id)
  values (${id}, ${collectorId}, ${kind}, ${sql.raw(payload)}::jsonb, ${source[0]}, ${source[1]})`;

describe.skipIf(!hasDb())('collector_notifications (0032)', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  it('accepts every kind the catalogue names', async () => {
    const d = await db();
    const ids = await seed();
    const kinds = [
      'upload_verified',
      'upload_ingested',
      'upload_held',
      'upload_failed',
      'review_passed',
      'review_partial',
      'review_failed',
      'bill_issued',
      'payment_recorded',
      'payout_account_verified',
      'payout_account_refused',
      'task_published',
      'claim_accepted',
    ];
    for (const kind of kinds) {
      await d.execute(insert(uid(), ids.collector1, kind, ['collector_uploads', uid()]));
    }
    const rows = (await d.execute(
      sql`select count(*)::int as n from collector_notifications`,
    )) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(kinds.length);
  });

  it('refuses a kind nobody wrote a sentence for', async () => {
    const d = await db();
    const ids = await seed();
    // The failure this prevents: a route ships a kind, the row lands, and the
    // app has no sentence for it — so the collector reads a column name.
    await violates(
      'collector_notifications_kind_check',
      d.execute(insert(uid(), ids.collector1, 'achievement_unlocked', ['collectors', uid()])),
    );
  });

  it('refuses a second notification about the same event', async () => {
    const d = await db();
    const ids = await seed();
    const source: [string, string] = ['collector_uploads', uid()];
    await d.execute(insert(uid(), ids.collector1, 'upload_verified', source));
    await violates(
      'collector_notifications_source_key',
      d.execute(insert(uid(), ids.collector1, 'upload_verified', source)),
    );
  });

  it('lets one event notify two collectors, and one collector twice about two kinds', async () => {
    const d = await db();
    const ids = await seed();
    // A published task notifies everybody, so the uniqueness has to be per
    // collector and not per event — otherwise the second collector's row is
    // refused and one person silently never hears about the task.
    const task: [string, string] = ['tasks', uid()];
    await d.execute(insert(uid(), ids.collector1, 'task_published', task));
    await d.execute(insert(uid(), ids.collector2, 'task_published', task));
    // And a delivery that is verified and then ingested is two facts about one
    // row, which the kind in the key is what keeps apart.
    const upload: [string, string] = ['collector_uploads', uid()];
    await d.execute(insert(uid(), ids.collector1, 'upload_verified', upload));
    await d.execute(insert(uid(), ids.collector1, 'upload_ingested', upload));
    const rows = (await d.execute(
      sql`select count(*)::int as n from collector_notifications`,
    )) as unknown as { n: number }[];
    expect(rows[0]!.n).toBe(4);
  });

  it('refuses a payload that is not an object', async () => {
    const d = await db();
    const ids = await seed();
    for (const payload of [`'[]'`, `'"a string"'`, `'7'`, `'null'`]) {
      await violates(
        'collector_notifications_payload_check',
        d.execute(insert(uid(), ids.collector1, 'bill_issued', ['bills', uid()], payload)),
      );
    }
  });

  it('refuses an empty or blank source', async () => {
    const d = await db();
    const ids = await seed();
    for (const source of [['', uid()], ['bills', ''], ['   ', uid()]] as [string, string][]) {
      await violates(
        'collector_notifications_source_check',
        d.execute(insert(uid(), ids.collector1, 'bill_issued', source)),
      );
    }
  });

  it('refuses a read stamp from before the row existed', async () => {
    const d = await db();
    const ids = await seed();
    const id = uid();
    await d.execute(insert(id, ids.collector1, 'bill_issued', ['bills', uid()]));
    await violates(
      'collector_notifications_read_check',
      d.execute(sql`update collector_notifications set read_at = created_at - interval '1 second' where id = ${id}`),
    );
    await d.execute(sql`update collector_notifications set read_at = now() where id = ${id}`);
  });

  it('refuses a collector who does not exist', async () => {
    const d = await db();
    await seed();
    await violates(
      'collector_notifications_collector_id_fk',
      d.execute(insert(uid(), uid(), 'bill_issued', ['bills', uid()])),
    );
  });
});
