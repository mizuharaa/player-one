# Telling a collector what happened

Before this lane there was no collector notification of any kind. Not a push,
not a Zalo message, not an inbox: `alerts.ts` pages the ops team and `zns.ts`
sends a sign-in code, and neither of them has ever said a word to a collector
about their own work. A collector learned that footage was reviewed by opening
the app and reading a list, and learned that a bill was paid by noticing money.

This lane builds the part that does not need a credential: **the record of what
happened, written in the same transaction as the thing that happened, and an
inbox that reads it back.**

## What is deliberately not built

**Transport.** Push needs an FCM project for Android and an APNs key plus the
Push Notifications capability for iOS. Neither exists. ZNS needs a template per
message type, approved by Zalo, each with its own parameter list. None exist.
Writing transport code against credentials nobody has produces code nobody can
run, and the honest version of that work is the last section of this file.

So every kind below has **transport now: in-app**. The row lands in
`collector_notifications`, `GET /api/me/notifications` serves it, and the phone
shows it when the collector opens the app. Nothing is delivered to a device that
is not looking.

That is a real limitation and it is worth naming: a collector who does not open
the app does not find out. For the pilot — 20 devices, a counter, and an
operator who can phone somebody — that is acceptable. At 500 collectors it is
not, and the section at the end is what closes it.

## The rule every emission obeys

`notify(tx, collectorId, kind, payload, source)` in
`packages/api/src/notifications.ts` takes the transaction handle, never a
database. It is called **inside the `write` callback of the event's own
`mutate`**, so the notification, the change and the audit row are one commit.
Three things follow from that and all three are the point:

- A notification never exists for a change that rolled back. The bill that was
  not issued does not tell anybody it was issued.
- A change never commits without its notification. There is no second write to
  forget, no queue to drain, no worker to be down.
- A retry writes nothing twice. `collector_notifications_source_key` is
  `unique (collector_id, kind, source_table, source_id)` and `notify` inserts
  `on conflict do nothing`, so the second attempt at a delivery, a verdict or a
  bill finds its row already there.

`source_table` and `source_id` are the *event's* row — the upload, the review,
the bill, the attempt — not the notification's. That is what makes the
idempotency mean something: two notifications about one verdict are the same
notification.

**Money-bearing payloads quote the server's stored figure and nothing else.**
No arithmetic, no totals, no per-kind subtotals, no re-derivation from minutes.
The figure in the payload is the string that is in the column, and the app
inserts it into a sentence. This is APP-34 restated on a new surface: the app
computes no money, and a notification is not an exception.

## The catalogue

Priority is a doc-level judgement about how soon a person needs to know, used to
decide what gets a transport when transports exist. **It is deliberately not a
column** — there is nothing to read it yet, and a column nothing reads is a
column that goes wrong quietly.

### Built now

| Kind | Trigger (server event → file) | Audience | i18n key | Money-bearing | Priority |
| --- | --- | --- | --- | --- | --- |
| `upload_verified` | `upload.complete` writes `collector_uploads.state = 'verified'` — `collector-upload.ts` (unmeasured path and measured path) | the upload's own collector | `notif.upload_verified` | no | normal |
| `upload_ingested` | `upload.ingest` writes `state = 'ingested'` — `collector-upload.ts` | the upload's own collector | `notif.upload_ingested` | no | normal |
| `upload_held` | `upload.held` writes `state = 'held'` — `collector-upload.ts` | the upload's own collector | `notif.upload_held` | no | high |
| `upload_failed` | `upload.complete` writes `state = 'failed'` — `collector-upload.ts`, both reasons and both paths | the upload's own collector | `notif.upload_failed` | no | high |
| `review_passed` | `episode.review` with `REVIEW_STATE[decision] = 'pass'` — `review.ts` | the session's collector | `notif.review_passed` | **yes** — `effective_minutes`, `amount` | high |
| `review_partial` | same write, `decision = 'partial'` | the session's collector | `notif.review_partial` | **yes** | high |
| `review_failed` | same write, `REVIEW_STATE = 'fail'` | the session's collector | `notif.review_failed` | **yes** (a `0.0000` amount is still a figure) | high |
| `bill_issued` | `bill.generate` inserts the `bills` row — `settle.ts` | the bill's collector | `notif.bill_issued` | **yes** — `total` | high |
| `payment_recorded` | an attempt reaches `succeeded`: `bill.mark_paid` inserts one that way (`payout/routes/payout.ts`), and on the API rail `applyEvent` moves one there (`payout/domain/attempts.ts`) | the bill's collector | `notif.payment_recorded` | **yes** — `amount_vnd`, plus the reference | high |
| `payout_account_verified` | `payout_account.declare` stores `verify_status = 'verified'` — `payout/routes/payout.ts` | the account's collector | `notif.payout_account_verified` | no | normal |
| `payout_account_refused` | the same write, any other status **that ZaloPay actually answered** — see below | the account's collector | `notif.payout_account_refused` | no | high |
| `task_published` | `task.published` on `PATCH /api/tasks/:id` — `backoffice.ts` | **every collector whose status is not `suspended`** — see below | `notif.task_published` | **yes** — `unit_price` | normal |
| `claim_accepted` | `collector.claim` inserts the `task_claims` row — `collector-app.ts` | the claiming collector | `notif.claim_accepted` | no | low |

Payloads, exactly:

```
upload_verified          { upload_id }
upload_ingested          { upload_id, episode_id }
upload_held              { upload_id }
upload_failed            { upload_id }
review_passed/_partial/  { review_id, episode_id, effective_minutes, amount, currency }
  _failed
bill_issued              { bill_id, total, currency, period_start, period_end }
payment_recorded         { attempt_id, bill_id, amount_vnd, reference }
payout_account_verified  { payout_account_id, method }
payout_account_refused   { payout_account_id, method }
task_published           { task_id, task_name, unit_price }
claim_accepted           { claim_id, task_id }
```

`task_published` carries no currency because `tasks` has no currency column —
it is on `bills` and on the session's price snapshot, and quoting one here would
be inventing it. The app prints dong, as every other price surface does.

`payment_recorded`'s `reference` is what finance typed on the manual rail and
ZaloPay's `zp_trans_id` on the API rail. It is null until there is one.

Ids and stored figures. No reason code, no reviewer, no note, no risk signal, no
exception reason, no dispute text, no constraint name. The same structural rule
`me.ts` holds: there is no field in these payloads that could carry a sentence
somebody wrote about a collector, so a leak would need a new field, not a
mistake.

The failed and held kinds deliberately carry **no** `failed_reason` or
`held_reason`. The phone that made the delivery already has the refusal code
from its own HTTP response; the inbox is the record that it happened, and the
per-kind sentence is what a collector can act on.

#### `task_published` goes to every active collector, and here is why

The brief asked for it to go to collectors whose declared scenarios match the
task. **There is no such declaration anywhere in the schema.** `scenarios` is a
catalogue; `collection_sessions.scenario_id` records the scenario of a recording
that already happened; `collectors` has no scenario column, no preference table
and no interest list. A collector has never told this platform what kind of work
they want.

So the fallback in the brief applies and it is taken literally: the notification
goes to every collector whose `status` is not `suspended`, one row each. At
pilot scale that is twenty rows in the publishing transaction. At 500 it is 500,
which is still one `insert … select` and still fine; the thing that would make
it wrong is 500 *push messages* about a task most people do not want, and that
is a reason to build the declaration before building push, not a reason to guess
at one now.

The honest upgrade is a `collector_scenarios` table the app writes from a
preferences screen. That is a lane of its own and it is not this one.

#### `payout_account_refused` is only sent when ZaloPay answered

`verify_status` is `unverified` in two cases that are not a refusal: a pilot
running with no payout credentials at all, where no verify call is made, and a
transport failure, which stores `error` with no sub code. In both, ZaloPay was
never asked about this person, and "your payout account was refused" would be a
sentence about a question nobody put. So the notification is sent only when the
outcome carries a risk event or a sub code — which is exactly the set where
ZaloPay said something about the account — and `verified` is sent on its own
status. A declaration stored `unverified` because the pilot has no credentials
notifies nobody, which is correct: nothing happened to tell them about.

### Not built, and why

| Kind | Why not |
| --- | --- |
| `upload_received` | The `registered` state is the response to the phone's own POST. A notification for the thing you just did, delivered to the device that did it, is noise. |
| `claim_refused` | There is no committed server event to attach it to. `task_claims_guard` refuses the insert and the whole transaction rolls back, so a refusal row could only be written in a *separate* transaction — which is exactly the commit-together rule this design exists to hold. The collector already gets the refusal as the claim request's own reply. |
| `session_reminder` | Needs a scheduler. Nothing in this service runs on a timer, and "before wearing" is a time the platform does not know: APP-16 binds a session, it does not schedule one. A reminder needs either a device-local notification (no push module) or a job table. |
| `device_assigned` | `device.assign` and `device.bind` are committed events with a collector id and would wire in an afternoon. They are outside the wiring list this lane froze, so they are named here and left. |
| `training_complete`, `exam_recorded` | Both are the collector's own POST, answered in the response. The case that is *not* — an operator correcting a result through `PATCH /api/collectors/:id` — is worth a notification and is the same afternoon's work as the row above. |
| `first_upload`, `first_payment`, `hours_reviewed` | Achievements. Every one of them is a derived fact — a count over a collector's own history — and deriving it needs either a counter column or a query at emit time. There is nothing to be idempotent against: "first upload" is not an event, it is a property of an event. Build them with the transport that makes them worth having. |

## The routes

All three sit under `/api/me`, take the collector id off the token and nowhere
else, and are guarded by the existing `requireActor` — an operator or reviewer
token is refused on this prefix by `index.ts` before the handler runs.

```
GET /api/me/notifications?after=<uuid>&limit=<1..100>
200 {
  "notifications": [
    {
      "id": "…",
      "kind": "review_passed",
      "payload": { "review_id": "…", "episode_id": "…",
                   "effective_minutes": "10.0000", "amount": "12000.0000",
                   "currency": "VND" },
      "created_at": "2026-09-14T03:11:02.417Z",
      "read_at": null
    }
  ],
  "next": "…uuid of the last row, or null when the page is the last one"
}
```

Newest first, ordered by `(created_at desc, id desc)` — the pair, not the
timestamp alone, because two notifications written in one transaction share an
instant and a cursor on a non-unique key loses rows. `after` is the id of the
last row of the previous page and the keyset continues strictly after it.

```
POST /api/me/notifications/:id/read
200 { "id": "…", "read_at": "2026-09-14T03:12:00.000Z" }
404 when the id belongs to another collector — never 403, which would confirm
    the row exists
```

`read_at` is set once: a second call returns the first instant rather than
restamping it, so "when did they see it" survives a double tap.

```
GET /api/me/notifications/unread-count
200 { "unread": 3 }
```

Cheap on purpose — Home calls it to draw a number on a chip, and it must not
cost the inbox query.

## The table

Migration `0033_collector_notifications`, appended (never edited into an applied
one), journal `when` after `0030_release_held_delivery`.

| | |
| --- | --- |
| `collector_notifications_pkey` | `id` |
| `collector_notifications_collector_id_fk` | → `collectors(id)` |
| `collector_notifications_kind_check` | names all thirteen kinds above, and no others |
| `collector_notifications_source_key` | `unique (collector_id, kind, source_table, source_id)` — the idempotency |
| `collector_notifications_payload_check` | `jsonb_typeof(payload) = 'object'` |
| `collector_notifications_inbox_idx` | `(collector_id, created_at desc, id desc)` — the listing keyset |

A kind added later is a new migration that replaces the CHECK, the way
`0030_release_held_delivery` replaces the upload reason CHECK. The vocabulary
lives in the schema and not in TypeScript, so a route that invents a kind is
refused by Postgres and not by a code review.

Grants follow `0021_app_role`: `playerone_app` gets `select, insert, update` and
**no delete**. A collector's record of what happened to their money is not
something the application may remove.

## What push will need, when the credentials exist

Nothing below is built. This is the shopping list, so that the day somebody has
the credentials the work is wiring and not design.

**Android.** An FCM project under the VNG Google account, its
`google-services.json` in the Expo config, and the `expo-notifications` module —
which is a native module, so it needs a development build; it cannot be tested
in Expo Go and it cannot be compiled or verified on the machine this was written
on.

**iOS.** An APNs authentication key (`.p8`) from an Apple Developer account, the
Push Notifications capability on the app id, and the same module. Nobody has an
Apple Developer account for this yet.

**Both.** A `collector_push_tokens` table (collector, token, platform, last
seen), a route for the app to register one, and a sender that reads
`collector_notifications` and marks what it delivered — which means a `sent_at`
column or a delivery table, because the inbox row and the push are two different
facts and conflating them makes a failed send look like a notification that
never happened.

**Zalo ZNS.** One approved template per kind that gets one, each with its own
parameter list, plus the existing `PLAYERONE_ZNS_ACCESS_TOKEN` and a second
template id per message. ZNS is transactional and costs money per send, so it
suits `payment_recorded`, `bill_issued` and `payout_account_refused` and suits
`task_published` very badly. The same limitation as sign-in applies and is
already recorded: **a collector whose number has no Zalo account cannot be
reached at all.**

The ordering that follows from that: push for the high-priority kinds, ZNS for
money only, and nothing at all for `claim_accepted` — which is why the priority
column above is in this file rather than in the table.
