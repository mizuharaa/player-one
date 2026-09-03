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
lands in. `quantise(unit_price × effective_minutes, 4)` therefore still
reproduces `amount` on the export, which is the first thing checked when an
invoice is disputed. Note the `quantise`: the *raw* product is not the amount and
never was — one second at 1 a minute stores `0.016667` minutes and `0.0167`,
where the product is `0.016667`. The 16-seconds-at-1200 case above happens not to
round on that last step, so it cannot tell the two apart on its own; the second
case in `money.test.ts` is there to. `settlements_amount_formula_check` is the
same rule as a CHECK — `amount = round(unit_price * effective_minutes, 4)`,
Postgres rounding half away from zero exactly as `quantise` does — so a writer
that never loads `money.ts` gets it too, and negative operands are refused
beside it.

**A CHECK cannot enforce a lifecycle.** `settlements_state_check` names SET-05's
five states and validates the row in front of it, which means it accepts
`manually_paid → pending_review` exactly as readily as the reverse: both are
legal *values*. What is illegal is the *edge*, and an edge needs the previous
value. `0005_settlement_lifecycle.sql` adds, and
`0006_settlement_lifecycle_guards.sql` extends,
`settlements_transition_guard`, a `BEFORE INSERT OR UPDATE` trigger that allows
seven edges and refuses everything else, including every jump out of
`manually_paid`. It also refuses any later change to `unit_price`,
`effective_minutes`, `amount`, `episode_review_id`, `task_id`, `collector_id` or
`currency`, and it refuses `bill_generated` or `manually_paid` on a settlement
that is on no bill — otherwise the whole lane is walkable on a row that was never
billed, and a state name stops being a fact about the world.

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
a zero-value line for work that was refused. `bill_lines_membership_guard` refuses
it outright, so the rule is a row that cannot be inserted rather than a `WHERE`
clause in one generator — and it is the *verdict* that decides, with the amount
as a second condition, because checking only the amount let raw SQL attach a
formula-valid positive settlement to a failed review and bill it. The generator counts them instead and reports
`not_payable` on the response, because a settlement nothing will ever bill is
otherwise a silent backlog.

**`bills.total` is a stored sum, and four guards are what make that safe.**
`bill_lines` deliberately carries no money, so each figure is written down once.
The trigger that orders the states also freezes a settlement's `amount`;
`bill_lines_membership_guard` refuses every UPDATE and DELETE on a line, and
refuses a line whose settlement disagrees with the header on collector or
currency — the two foreign keys are independent and on their own would let one
collector's work be attached to another's bill. On top of those,
`bills_total_matches_lines` is a DEFERRABLE constraint trigger that recomputes
the sum at COMMIT and refuses the transaction if the header disagrees. Deferred
because the generator writes the header before the lines it is the sum of; this
is the only cross-row invariant in the money chain, and no per-row CHECK can
express it. Deriving the total instead would have removed the need for it and was
rejected: a bill is a document finance sends, and the number on it must be the
number that was issued.

**Who is owed, and in what unit, are settlement facts.** Both are copied onto the
settlement when the verdict commits. Read live instead, the payee would come back
through `episode_reviews → episodes → collection_sessions → collectors`, so
reassigning a session afterwards would pay a different person for footage already
scored; and the unit would come from `PLAYERONE_CURRENCY`, so changing an
environment variable would relabel every historic amount without touching a
number.

**A cycle is a position on a lattice, not a window.** The caller names a local
Vietnamese date; the cycle length is a parameter (`settlementCycleDays`,
`PLAYERONE_SETTLEMENT_CYCLE_DAYS`, default 7) and not a constant, because weekly
is `[ASSUMED]` in the brief's §13.2 rather than decided. There is no `period_end`
input. `bills_period_local_midnight_check` pins both ends to local midnight in
`Asia/Ho_Chi_Minh`, and `settle.ts` additionally aligns the start to a Monday
anchor. See the note in Known gaps for why overlap had to be made unexpressible
rather than validated.

**Nothing is stranded by a late commit.** The generator's window has a cutoff and
no lower bound: it bills everything still `pending_settlement` whose `created_at`
precedes the end of the cycle. A review transaction that starts before the cutoff
and commits after the generator's SELECT would otherwise be invisible to that
run, and — because the header now exists and re-running changes nothing — filtered
out of every later cycle as too old. With no lower bound it simply appears on the
next cycle's bill, the way a payroll run picks up a late timesheet. The cycle
dates stay the bill's label and each line carries its own `reviewed_at`, so a
line that predates its bill says so.

**The export is audited.** `GET /api/settle/export.csv` writes one
`bill.export` audit row per bill, naming the actor, the bill, the period and the
line count — no amounts, no CSV contents. It is a read, but it takes a
collector's pay out of the system in a form that can be forwarded, and "who
exported this collector's figures" is a question PLT-07 has to be able to answer.
Every cell in that CSV is also quoted *and* defused: a task name is operator
text, and `=1+1` in a quoted field is still a live formula when the file is
opened.

## Known gaps

- **`tasks` has no currency column.** The schema cannot say what a task pays in.
  It is configuration (`PLAYERONE_CURRENCY`, default `VND`) and visible on the
  screen, which is honest but is not a decision anybody has made. What the
  configuration no longer does is decide a *historic* amount's unit: the review
  lane copies it onto the settlement at the moment of the verdict, and a bill
  reads it from there, so changing the variable cannot relabel money that was
  already earned. The gap is that nothing says a task's price is in that unit.

- **The settlement cycle is a fixed lattice anchored on 1970-01-05.** A caller
  names a local Vietnamese date and the cycle length is a parameter (weekly is
  `[ASSUMED]` in §13.2), so a 7-day cycle always starts on a Monday and a
  14-day one on alternate Mondays. There is no `period_end` input. That is not
  tidiness: two overlapping periods are two different keys on
  `bills_collector_period_key`, both insertable, and whichever generator ran
  first would have decided which cycle a settlement was paid in. Overlap cannot
  be validated one request at a time, so it is made unexpressible. The
  milliseconds arithmetic assumes Vietnam's fixed +07:00; if that ever changes,
  `bills_period_local_midnight_check` asks the tz database and refuses the
  insert.
- **`collectors` has no display name.** The screen shows `external_ref`.
- **Frame stepping falls back to 30 fps** when `nominal_rate_hz` is absent from
  the record.
- **Finance is not a role.** `/api/settle/*` takes the same both-token operator
  session as everything else, so today any centre operator can generate, export
  and pay every collector's bill, and the queries are global rather than scoped
  to a centre. It is not a column this slice could add: `audit_events` requires a
  machine and an operator from a centre for every non-login event, so a finance
  identity needs the shared principal model that the reviewer and back-office
  slices need too. Same shape as the reviewer gap above, and it goes away with
  the roles slice. Until then these routes should not be exposed outside the
  centre network.
- **A rejected episode's settlement never leaves `pending_settlement`.** It is
  worth nothing, it cannot be billed, and none of SET-05's five states means
  "scored, and owed nothing". It is counted in `not_payable` on every generation
  — that number is the whole standing backlog, not one cycle's — which is honest
  and is not a resting place. The two candidate fixes
  are a sixth state or SET-01's literal reading — no settlement row at all for a
  `fail`, which would change what `settlements_review_key` and the console's
  settled-value sum mean. That is a decision, not a defect to patch quietly.
- **A bill is never revised, and the database now says so out loud.** There is
  no credit note and no way to take a line off an issued bill, so
  `bill_generated -> exception` is *refused* by `settlements_transition_guard`
  rather than allowed and left half-honoured. Allowing it looked kinder and was
  a trap: `bill_lines` membership is written once, so a settlement that left a
  bill would still be on it — the header would keep counting money nobody
  intends to pay, and re-billing that settlement in a later cycle would fail for
  ever on `bill_lines_settlement_key`. The state would have said "recoverable"
  and the schema would have said otherwise.
  Once a bill exists the only move is `manually_paid`. A settlement that turns
  out to be wrong after it was billed needs a credit note against a new bill,
  and that is what the dispute path (QR-08) has to bring — a reversal changes a
  total, and a total that can change is what `bills_total_matches_lines` exists
  to prevent.
- **Dispute and second review are P2** and deliberately not built.
  `episode_reviews_delivery_key` is one review per delivery; when the dispute
  flow lands it needs a supersedes column rather than a second row, or that index
  moves.
