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

## Two lanes, a priority and an assignee

`episode_reviews` carries three more columns, and all three exist because the
pool is the default and the pool has to be wrong safely.

**`queue` is QR-07, and it is an absence, not a ranking.** An episode whose
collection session carries either APP-17b declaration — others in frame, or
sensitive information — is in the `privacy` lane, and `GET /api/review/next` and
`POST /api/review/claim` do not return it. Not ranked lower: not in the answer.
A reviewer reaches it by asking for it, `?queue=privacy`, and there is no way to
arrive there by scrolling. Footage with a bystander in it that a reviewer with no
clearance watches cannot be un-watched, so the failure mode that matters is the
one where a filter is forgotten, and a filter that has to be added to see the
lane fails the safe way round.

The lane is derived at claim time and stored. It has to be stored, because
PRV-04 says a reviewer can flag privacy risk mid-review — and the two APP-17b
booleans are **what the collector declared before recording**. A reviewer's later
judgement is a different fact; writing it over the declaration would destroy the
only evidence of what was declared. So the flag moves the review row and leaves
the session alone.

**`priority` is higher-first, and only a row that exists can carry one.** That is
the real cost of a lazy queue: an episode nobody has claimed has no review row,
so nothing to prioritise. `POST /api/review/route/:episodeId` materialises the
row rather than refusing — which is also what makes BO-15 work, flagging footage
from a browse screen that no reviewer has ever opened.

**`assignee_ref` is not `reviewer_ref`.** The lease moves on its own — it expires,
it is reclaimed, it transfers. An assignment is somebody's intent and outlives all
of that. A reviewer is never offered a row assigned to somebody else, and their
queue depth does not count it either, on the same argument the depth was written
under: a number that counts work you cannot pick up stops being read.

One endpoint sets all three, because all three are one `UPDATE` of one row.
`review.route` in the audit trail is a reviewer quarantining what they are
watching, an operator flagging from a browse screen, or a supervisor moving work
— the `after` says which. A privacy move stamps `CO-PRIVACY`, §6.9's only
compliance code, so the reason is the taxonomy's and not free text somebody has
to interpret.

Today any authenticated operator may call it. "Specialist review" is a role, and
roles are the reviewer-auth slice, not this one.

### The index, measured

`episode_reviews_queue_idx` was `(review_state, lease_expires_at, created_at)`
and is now `(review_state, queue, priority desc, created_at)`.

`lease_expires_at` never earned second position. The predicate that reclaims an
expired lease is `reviewer_ref is null or lease_expires_at < now()` — an OR
across two columns, which no btree can use as a key. It was always a filter, and
holding second place stopped `created_at` from supplying the sort.

Over 200,000 rows, 60,000 of them pending, on the claim's own ordering:

| | old index | new index |
|---|---|---|
| plan | Bitmap Heap Scan + top-N sort | Index Scan, stops at row 1 |
| rows examined | 60,014 | 1 |
| buffers | 2,244 | 4 |
| execution | 24.4 ms | 0.093 ms |

`review_state` and `queue` are both equality, so the remaining two index columns
are the `ORDER BY` exactly and the scan stops at the first row it can hand out.

### Throughput, and what the denominator is

`GET /api/review/throughput` is QR-06, per reviewer, computed from
`time_to_verdict_s` and `reviewed_at` — columns the verdict already writes.
Nothing is stored, incremented or sampled, for the same reason the shift figures
are not: a counter written on every verdict is a counter that can disagree with
the rows it counts.

**`reviews_per_hour` is per hour of measured review time**, `3600 × verdicts ÷ Σ
time_to_verdict_s`, and not per hour on shift. A wall-clock denominator needs a
shift table nobody has, and would report a reviewer who spent half the day on
something else as half as fast as they are. The inputs travel alongside, so
anybody who wants a different denominator can compute one rather than argue with
this one. `since` is optional and has no default: a default window would be an
operational decision and this endpoint does not get to make it.

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

Those rows are **configuration, and the boot-time seed no longer overwrites
them**. §6.9's own note says to build the codes configurable rather than
hard-coded, because PaXini said on 13 Aug that the in-the-wild standard does not
exist yet and will be rewritten during the pilot. `seedCatalogues` used to upsert
the category and all three labels on every server start, so an operator's `UPDATE`
lasted until the next restart and then quietly reverted — the worse of the two
failures, because nothing errors and the pilot's own tuning is simply lost. It
now inserts codes the deployment does not have and leaves the rest exactly as it
found them, `active` included. `defect_codes` still upserts: `blocks_review` is a
routing decision the deployed engine owns, and that is a different kind of thing.

Retiring a code is `active = false`, which takes it out of the picker and leaves
every verdict that cites it intact. Deleting one is refused by
`episode_review_reasons_code_review_reason_codes_code_fk`, and so is renaming the
primary key — tested in raw SQL, because the edit that would orphan a past
verdict will be typed into psql by somebody who has never read this repository.

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

## Known gaps

- **`tasks` has no currency column.** The schema cannot say what a task pays in.
  It is configuration (`PLAYERONE_CURRENCY`, default `VND`) and visible on the
  screen, which is honest but is not a decision anybody has made.
- **`collectors` has no display name.** The screen shows `external_ref`.
- **Frame stepping falls back to 30 fps** when `nominal_rate_hz` is absent from
  the record.
- **Dispute and second review are P2** and deliberately not built.
  `episode_reviews_delivery_key` is one review per delivery; when the dispute
  flow lands it needs a supersedes column rather than a second row, or that index
  moves.
