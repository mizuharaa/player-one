import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { schema, type Db } from '@playerone/store';

/**
 * Telling a collector what happened to their own work.
 *
 * `docs/notifications.md` is the catalogue — every kind, the exact server event
 * that produces it, its audience, whether it quotes money, and what transport it
 * will get when credentials for one exist. This file is the one way a row gets
 * written.
 *
 * **`notify` takes a transaction, never a database, and that is the whole
 * design.** Every call site is inside the `write` callback of the event's own
 * `mutate`, so the notification, the change and the audit row are one commit.
 * Three properties follow and all three are the point:
 *
 *   - A notification never exists for a change that rolled back. The bill that
 *     was not issued does not tell anybody it was issued.
 *   - A change never commits without its notification. There is no second write
 *     to forget, no queue to drain, and no worker to be down.
 *   - A retry writes nothing twice. `collector_notifications_source_key` is
 *     unique on (collector_id, kind, source_table, source_id) and the insert
 *     below is `on conflict do nothing`, so the second attempt at a delivery, a
 *     verdict or a payment finds its row already there.
 *
 * The `source` pair names the EVENT's row — the upload, the review, the bill,
 * the attempt — and never the notification's own id. That is what makes the
 * idempotency mean anything: two notifications about one verdict are the same
 * notification.
 *
 * `Kind` is a union here AND a CHECK in the database (0031), deliberately in
 * both places. The union is what makes a typo a compile error at the call site;
 * the CHECK is what makes an invented kind impossible whatever writes the row.
 * Adding one means a migration, this union, and a sentence in three languages
 * in the app — in that order, and the migration is what stops the last step
 * being forgotten.
 */

export type NotificationKind =
  | 'upload_verified'
  | 'upload_ingested'
  | 'upload_held'
  | 'upload_failed'
  | 'review_passed'
  | 'review_partial'
  | 'review_failed'
  | 'bill_issued'
  | 'payment_recorded'
  | 'payout_account_verified'
  | 'payout_account_refused'
  | 'task_published'
  | 'claim_accepted';

/**
 * What may go in a payload: ids, and the server's stored figures as the strings
 * they are stored as.
 *
 * Money-bearing kinds quote the column, never a computation. The app inserts
 * the string into a sentence and does no arithmetic on it — APP-34's rule,
 * restated on a new surface. `number` is admitted for counts and `null` for a
 * reference that does not exist; neither is a currency.
 *
 * Nothing internal has a shape here. No reason code, no reviewer, no note, no
 * risk signal, no exception reason, no dispute text, no constraint name. That
 * is the same structural argument `me.ts` makes: a leak would need a new field,
 * not a mistake.
 */
export type NotificationPayload = Record<string, string | number | null>;

/** The event's own row, for the idempotency key. */
export type NotificationSource = { table: string; id: string };

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function notify(
  tx: Tx,
  collectorId: string,
  kind: NotificationKind,
  payload: NotificationPayload,
  source: NotificationSource,
): Promise<void> {
  await tx
    .insert(schema.collectorNotifications)
    .values({
      id: randomUUID(),
      collectorId,
      kind,
      payload,
      sourceTable: source.table,
      sourceId: source.id,
    })
    .onConflictDoNothing({
      target: [
        schema.collectorNotifications.collectorId,
        schema.collectorNotifications.kind,
        schema.collectorNotifications.sourceTable,
        schema.collectorNotifications.sourceId,
      ],
    });
}

/**
 * The same notification to every collector who is not suspended, in one
 * statement.
 *
 * Used by task publication, and it exists because the audience it was specified
 * for does not: the brief asked for collectors whose DECLARED SCENARIOS match
 * the task, and there is no such declaration anywhere in the schema.
 * `scenarios` is a catalogue, `collection_sessions.scenario_id` describes a
 * recording that already happened, and `collectors` has no scenario column, no
 * preference table and no interest list. A collector has never told this
 * platform what kind of work they want. `docs/notifications.md` records the
 * fallback and names the upgrade.
 *
 * One `insert … select` rather than a loop, so the cost is one statement at any
 * pilot size. `on conflict do nothing` means a republished task — `task.edit`
 * then `task.published` again — does not notify anybody twice.
 *
 * Suspended collectors are excluded because a suspended collector cannot claim
 * (`task_claims_guard` reads `collectors.status`), and a notification about
 * work somebody may not take is a dead end with a button on it.
 */
export async function notifyActiveCollectors(
  tx: Tx,
  kind: NotificationKind,
  payload: NotificationPayload,
  source: NotificationSource,
): Promise<void> {
  await tx.execute(sql`
    insert into collector_notifications (id, collector_id, kind, payload, source_table, source_id)
    select gen_random_uuid(), c.id, ${kind}, ${JSON.stringify(payload)}::jsonb, ${source.table}, ${source.id}
      from collectors c
     where c.status <> 'suspended'
    on conflict (collector_id, kind, source_table, source_id) do nothing
  `);
}
