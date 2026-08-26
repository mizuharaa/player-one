# Reviewing an episode

Everything upstream of this screen measures. The ingest engine says how many
seconds of footage exist, the resolver says whose they are, and neither decides
whether any of it is worth anything. A person decides that here, and
`useful minutes × unit price` is the payment — so this is the only place in the
system that produces the number a collector is paid on, and every route in
`packages/api/src/review.ts` is written as money-path code.

The screen itself is `GET /review`: one server-rendered page and one ES module,
no framework and no build step. htmx is used elsewhere in the back office and is
deliberately not used here, because its swap model replaces DOM subtrees and this
screen's whole throughput argument rests on two `<video>` elements that survive
from one episode to the next.

## Four rules, each enforced somewhere an author cannot skip

**The server computes money.** The client sends marked spans and never a
duration or an amount. `money.ts` turns spans into seconds and seconds into a
bill. The running figure on screen is labelled an estimate, because it is one.

**Rounding happens in exactly one function.** `quantise` is it, and the rule is
half away from zero — not banker's rounding, which is defensible statistically
and indefensible to a collector who notices two identical reviews paid
differently. Everything that feeds it converts *exactly*: a decimal string from
Postgres becomes a rational with no loss, and a float64 span boundary becomes the
rational it actually is by doubling until it is integral. That last part matters
more than it looks — rounding a float on the way in would be a second rounding
site with its own rule, and the guarantee is that there is only one.

**A verdict is idempotent on the client's own id.** The browser mints a uuid per
attempt and sends it. A double-tap, or a retry after a write whose response was
lost, returns the first answer. The guarantee is `episode_reviews_verdict_key`, a
unique index, plus `episode_reviews_verdict_id_check`, which refuses to store a
decided review that does not name the request that decided it. Not a check in
application code: through `settlements_review_key` a second review row is a
second payment.

**A verdict and its audit row commit together**, because the write goes through
`mutate` like every other mutation in the service.

## The queue is lazy, and the claim is a lease

There is no enqueue step at submission time. `POST /api/review/claim` does two
statements: take over an existing pending review that is free, or materialise one
for the oldest eligible episode nobody has looked at.

The takeover is a single `update … where id = (select … for update skip locked
limit 1)`. `skip locked` is what makes two reviewers pressing the button at the
same instant land on different rows rather than one waiting behind the other, and
its predicate — `reviewer_ref is null or lease_expires_at < now()` — reclaims
expired leases on every read, so there is no sweeper to forget to run.

Being lazy buys two things. There is no enqueue call in `episodes.ts` for a later
code path to skip, and there is no backfill for episodes that already exist. It
costs one race: two reviewers can pick the same never-seen episode, and
`episode_reviews_delivery_key` decides it — the loser's insert does nothing and
it tries again, at most three times.

A lease is ten minutes, extended by a heartbeat every sixty seconds while the tab
is open, and released best-effort by `sendBeacon` on unload. So the timeout only
ever bites on a reviewer who has actually gone away.

**A single database connection defeats all of this.** `open()` defaults to
`max: 1`, which is right for the ingest CLI and wrong for a server: with one
connection, concurrent claims queue behind each other and `skip locked` has
nothing to skip. `bin/serve.ts` opens a pool. The concurrency test opens a second
connection for the same reason — on one connection it would pass without proving
anything.

## What is eligible, and the QR-02 deviation

An episode reaches the queue when it is `resolved`, its latest ingest is not
`quarantined`, its measured duration is above zero, and it carries no defect
whose catalogue row says `blocks_review`.

The integrity half of that is **the local check the engine already ran**, not a
cloud checksum receipt. QR-02 says no episode enters review before cloud
verification, and the cloud does not exist yet. That is a deliberate deviation
and it has an ADR: `docs/adr/0001-review-reads-local-verification.md`. The
adjacent rule is not deviable and nothing here bends it — **no TF card is
cleared**, and no code path in the review lane or the media route deletes source
media.

`resolution_state = 'resolved'` is the other half and is not negotiable. An
episode with no session has no collector and no task, so there is nobody to pay
and no price to pay them at; those stay in the counter's quarantine queue until a
human attaches them.

## The three verdicts

`good` pays the whole **measured** duration — not the video's length. Measured
duration is the intersection of stream coverage (§5.3.3, UPL-14), and the
container a reviewer watched can legitimately run longer than that. Paying the
video's length would pay for seconds no IMU covered. The scrub bar shows where
the payable window ends for the same reason.

`bad` pays nothing, which `episode_reviews_fail_is_zero_check` insists on, and
must name at least one reason. QR-01 requires the codes and QR-04 requires them
in a form the collector can act on, which is why they come from
`review_reason_codes` — a server-side enumeration with an `en`, a `zh` and a `vi`
label — and never from free text.

`partial` pays exactly what was marked, after normalisation: validate, clamp to
the measured duration, quantise to microseconds, drop the empty, sort, merge.
That order is not arbitrary. Clamping before merging means a span running past the
end folds into whatever preceded it. Merging last means the sum is over disjoint
intervals, so the same second is never paid for twice — which is what lets the
client allow overlapping marks, because forbidding them would make marking
fiddly.

**Marking spans rather than typing a number** is the whole design. It is faster,
it cannot be mistyped, and it leaves an auditable range. The spans are persisted
in `episode_review_spans`, because a collector paid for 4 of 11 minutes will ask
*which* 4, and "the reviewer typed 4" is not an answer anyone can check. Their sum
equals `effective_duration_s` by construction; that cannot be a CHECK because a
CHECK cannot sum other rows, so it is a property of `normaliseSpans` and is
tested there.

Shapes that were not asked for are **refused, not ignored**: spans on a `good`
verdict, reasons on a `good` verdict, a `partial` with nothing marked, an
inverted span, an unknown reason code. All 422. Silently tolerating any of them
would let a client bug run a whole pilot with no symptom — the payment would look
ordinary and the marks the reviewer thought they made would be nowhere.

## Why the bill is off by four ten-thousandths, on purpose

`settlementFor` computes `effective_minutes` from the seconds and then the
`amount` from the **rounded** minutes. At 1200 a minute, 16 seconds gives
`0.266667` minutes and `320.0004`, where the exact product is `320.0000`.

That is deliberate and it is pinned by a test. A bill has to explain its own
arithmetic: anybody who multiplies the `unit_price` and `effective_minutes`
columns must get the `amount` column back, because that is the first thing
checked when an invoice is disputed. Computing the amount from the unrounded
value would be marginally more accurate and would leave the three stored columns
unable to reproduce each other. The error is bounded by a millionth of a minute
of price and is unbiased in direction.

## The advance is optimistic, and the rollback is loud

Reviewer throughput is the programme's capacity ceiling at 40,000 hours, so a
network round trip per verdict is not a slow screen — it is the bottleneck. The
client fetches the next episode's metadata from `GET /api/review/next` (which
peeks and deliberately does not claim, so a prefetch cannot idle an episode for
the length of a lease) and warms its first video part in the hidden element.
Committing swaps which element is visible and reconciles the write behind it.

What that costs is a real rollback. If the write fails, the reviewer is put back
on the episode they judged with their spans, reasons and note intact, behind a
modal that cannot be worked past, and the optimistically-claimed next episode is
released. Not a toast: a verdict that vanished is a payment that vanished, and a
notification that fades after four seconds is exactly how one goes unnoticed
until settlement. Retrying from the modal re-sends the same `verdict_id`, so a
retry after a write that actually landed returns the original result.

## Serving the footage

`GET /media/episode/:id/part/:index` streams bytes with `Range` support. Without
that, a browser asked to seek to the eighty-percent mark of a 437 MB file
downloads everything before it first — not a slow page, an unreviewable
programme.

Two things follow from the files themselves. An episode is one or more
`_partNNNN.mp4` files written by the device, and to the reviewer it is a single
recording: a span crossing a file boundary is still one span. Per-part container
durations are not in the store — the engine records stream spans and payable
windows, not file lengths — so the client measures them with one metadata request
per part and builds the episode timeline from that.

And that measurement, and every seek, is cheap only if the `moov` atom is at the
**front** of each file. If PaXini's encoder writes the index last, the fix is a
remux in the import path (`ffmpeg -c copy -movflags +faststart`) and not anything
the console can do. `node packages/api/scripts/moov.ts <files>` answers the
question and exits non-zero if any file has it at the back. The committed
fixtures are 32-byte stubs and cannot answer it; run it over the real corpus.

## Two transports for one session

The counter API puts both tokens in headers, which a program can do and a browser
cannot do for everything this screen needs. A `<video>` element sets no custom
headers, and neither does `sendBeacon` — the only thing that reliably runs on
unload and therefore the only way to release a lease when a tab closes.

So the same signed claims also travel as `HttpOnly`, `SameSite=Strict` cookies,
set by `POST /review/login` and checked by the same `verifyToken`. This is a
second envelope, not a second authorisation model: same tokens, same centre
check, same access. `Secure` is off by default because pilot centres are a LAN
over plain HTTP, where a `Secure` cookie is never sent and the symptom is a
sign-in that appears to succeed and does nothing.

Reviewers sign in with an **upload-centre operator credential**, because that is
the session auth that exists. Reviewer accounts and roles are a later slice;
inventing half of them here would have left two auth models to reconcile.

## What the reviewer is shown, and why

Both durations, side by side, with the gap named. `measured_duration_seconds` is
the engine's reading and is what the verdict is scored against;
`claimed_duration_seconds` is the device manifest's, which UPL-08 makes advisory
and which overstates media by about a third. Showing the gap is the reviewer's
only window onto a device with a clock problem; hiding it would make a fleet-wide
fault invisible until settlement.

`recorded_at` comes from the PTS epoch and never from the folder name.
`20260813_072310` carries no timezone and neither does the manifest's
`start_time`, so parsing either gives a different moment in Hanoi than in UTC.
D4 would settle it and has not arrived.

The attribution line comes out of the audit trail rather than being recomputed —
the resolver already recorded every candidate it considered, the config it decided
under and which clock the start came from, and a reviewer looking at footage that
seems to belong to a different task needs to see exactly what was recorded.

## The design system

`shell.ts` holds the tokens; this was the first back-office screen, so there was
nothing to consume. Three of its decisions are constraints rather than taste and
a test enforces the first two:

- **One theme, and it is dark.** A reviewer's job includes judging whether
  footage is too dark or overexposed. `VQ-DARK` and `VQ-OVEREXPOSED` are reject
  reasons a collector is paid or not paid on, so a bright interface beside the
  video is a money bug wearing a stylesheet.
- **System fonts, and nothing from the internet.** Upload centres run on a LAN
  and the service is built to work with the link down.
- **Every colour lives in `:root`.** A screen that needs one adds it there, so
  the next screen inherits it rather than inventing a near-miss.

## After the verdict: the bill

`settle.ts` is the rest of the money chain — SET-03, SET-05, SET-06, SET-07 and
BO-08 — and it writes no arithmetic of its own. Every figure on a bill is already
on a settlement, computed once by `settlementFor`; the bill total is a sum taken
with `money.ts`' exact rationals and quantised at the scale of the column it
lands in. `unit_price × effective_minutes = amount` therefore still reads true on
the export, which is the first thing checked when an invoice is disputed.

**A CHECK cannot enforce a lifecycle.** `settlements_state_check` names SET-05's
five states and validates the row in front of it, which means it accepts
`manually_paid → pending_review` exactly as readily as the reverse: both are
legal *values*. What is illegal is the *edge*, and an edge needs the previous
value. `0005_settlement_lifecycle.sql` adds
`settlements_transition_guard`, a `BEFORE INSERT OR UPDATE` trigger that allows
seven edges and refuses everything else, including every jump out of
`manually_paid`. It also refuses any later change to `unit_price`,
`effective_minutes`, `amount`, `episode_review_id` or `task_id`.

The alternative considered was an append-only transition table. It can make an
illegal jump uninsertable, but only with a self-referencing composite foreign key
from `(settlement, seq-1, from_state)` to `(settlement, seq, to_state)`, which
needs a generated `prev_seq` column, a per-settlement sequence, a special case
for the first row, and a second place the current state is written down. The
trigger refuses the same jumps with one function and one source of truth, and the
history it would have kept is already kept: every move goes through `mutate`,
which writes an `audit_events` row in the same transaction.

**Regenerating a cycle changes nothing, and the index is what says so.** Not a
"have we run this already?" query, which races a second operator, a retried
request and a cron that fired twice. `bills_collector_period_key` has nowhere to
put a second bill for the same collector and period; `bill_lines`' primary key is
the settlement alone, so a settlement that is already billed has nowhere to
appear twice. The generator inserts and lets the index decide, and when it
decides against, `mutate` sees `undefined`, writes no audit row, and the second
run is a read. Both are tested in raw SQL with the generator bypassed.

**A rejected episode cannot be billed.** SET-01 makes settlement records out of
pass and partial-pass reviews; the review lane writes one for a `fail` as well,
worth `0.0000`, and that row stays because it is the *score* of the review — what
the console's settled-value sum reads and what a dispute over a refused episode
points at. What must not happen is that row reaching a bill, where it would print
a zero-value line for work that was refused. `bill_lines_payable_guard` refuses
it outright, so the rule is a row that cannot be inserted rather than a `WHERE`
clause in one generator. The generator counts them instead and reports
`not_payable` on the response, because a settlement nothing will ever bill is
otherwise a silent backlog.

`bill_lines` deliberately carries no money. `bills.total` is the sum of its
lines, and the same trigger that orders the states also freezes the amounts, so
an issued bill cannot quietly stop adding up.

The cycle length is a parameter (`settlementCycleDays`,
`PLAYERONE_SETTLEMENT_CYCLE_DAYS`, default 7) and not a constant, because weekly
is `[ASSUMED]` in the brief's §13.2 rather than decided. It only ever supplies
the *end* of a period whose start the caller gave.

## Known gaps

- **`tasks` has no currency column.** The schema cannot say what a task pays in.
  It is configuration (`PLAYERONE_CURRENCY`, default `VND`) and visible on the
  screen, which is honest but is not a decision anybody has made.
- **`collectors` has no display name.** The screen shows `external_ref`.
- **Frame stepping falls back to 30 fps** when `nominal_rate_hz` is absent from
  the record.
- **Finance is not a role.** `/api/settle/*` takes the same both-token operator
  session as everything else, so today any centre operator can generate and pay a
  bill. Same shape as the reviewer gap above, and it goes away with the roles
  slice.
- **A rejected episode's settlement never leaves `pending_settlement`.** It is
  worth nothing, it cannot be billed, and none of SET-05's five states means
  "scored, and owed nothing". It shows up as `not_payable` on every cycle it
  falls in, which is honest and is not a resting place. The two candidate fixes
  are a sixth state or SET-01's literal reading — no settlement row at all for a
  `fail`, which would change what `settlements_review_key` and the console's
  settled-value sum mean. That is a decision, not a defect to patch quietly.
- **A bill is never revised.** There is no credit note and no way to take a line
  off an issued bill; a settlement that turns out to be wrong goes to
  `exception`, and the bill it is on shows as unpaid for ever. That is honest and
  it is not a workflow. It needs one when the dispute path (QR-08) lands.
- **Dispute and second review are P2** and deliberately not built.
  `episode_reviews_delivery_key` is one review per delivery; when the dispute
  flow lands it needs a supersedes column rather than a second row, or that index
  moves.
