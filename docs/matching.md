# Matching an episode to a session

A session folder on a TF card is named `ego_AZER76400FE_20260813_072310`. That
encodes a device serial and a start time. It does not encode a collector, a task,
or a claim. The Ego device knows nothing about task claims, and the phone app
registers a `collection_session` before recording without anything physically
linking that registration to the folder that later appears on the card. So
something has to decide *this folder belongs to that session*, and that decision
is what a collector is paid against. It lives in `packages/api/src/resolve.ts`,
it is pure — no database, no clock, no randomness — and it is written so that the
whole decision table can be read in one place and replayed identically in a
dispute six months later.

**The candidate set is a handover, not a device and not a time window.** The
caller supplies the sessions declared against one physical card, handed across
one counter, once. That scope was bought with a bug: candidates were once scoped
by *collector*, so every session a collector had ever declared became a candidate
for every later card. One card per collector hides this completely — which is why
the test suite was green — and on the second card the whole batch quarantines,
while under time matching it could attach this week's footage to last week's task
at last week's unit price (SET-08). Time is a filter *inside* the handover's set;
it is never the outer bound. The regression test lives at
`packages/api/test/episodes.test.ts` as *"only considers sessions declared against
THIS card"*, and it is the reason the whole scoping design exists.

Only one upload path has this problem. **Path A** (device → phone → cloud) needs
no resolution at all: the app already holds the collection session, because
APP-16 has it create one before recording begins. **Path C** (TF card → upload
centre) is the resolution problem, and the handover is the correct scope because
it is the physical event that bounds which sessions could possibly be on the
card. **Path B** (device → cloud direct) has neither a handover nor an app, and
therefore no scoping mechanism at all; it is out of scope here, and UPL-02 is P1
and blocked on D2 regardless.

## The three outcomes

**One eligible session on the card** resolves automatically. The operator
verified the card against that declared task face to face (PRD §11.3.1 rule 1),
so there is nothing to choose between. The console still shows the episode count
against the session count before batch close, because one declared task holding
seven episodes is not an error but is worth an operator's glance — footage
recorded outside the declared task would otherwise be paid at the declared task's
rate.

**More than one, all app-origin**, is matched by time: the latest session that
began at or before the episode wins, and the result still carries
`needsConfirmation` so a human endorses it before the batch closes.

**Everything else quarantines for a human.** In the pilot this is the normal
path, not the exception, because every session is handover-origin — reconstructed
at the counter from what the collector remembered. Matching a microsecond-precise
PTS start against an operator's typed estimate, and paying on the result, is
precision on one side of the comparison only. The collector standing at the
counter is a better source than any heuristic, so the machine proposes an
ordering and the operator decides.

## Why there is no tie-break

If two sessions survive and the episode could belong to either, the function
refuses. It does not pick the closest, the earliest, the most recent, or the
highest-scoring. This is the single rule the whole component exists to enforce: a
wrong match pays the wrong person silently, while an unmatched recording sits
visibly in a queue where somebody fixes it. A plausible guess that becomes a
payment is worse than an explicit gap a human closes.

There is one `sort` in the file and it is not a tie-break. `propose()` orders the
candidates so the console can present work in a sensible order rather than as an
unsorted list, and it refuses outright at `withinTolerance >= 2`. The one path
that acts on its ordering returns `needsConfirmation: true`. Ordering a queue for
a human is a different act from choosing who gets paid. If a future change makes
a comparator decide an outcome without a human, that is a bug regardless of how
sensible the heuristic looks — the shuffle-invariance test exists to catch
exactly that, because an implicit tie-break shows up as a decision that changes
when the input array is reordered.

## Every candidate is recorded, and so is the config

`evaluated[]` carries every candidate supplied, with why it survived or was
dropped, on every outcome including successful ones. One proposal and one reason
was enough to route an episode to a human and not enough for that human to
overturn it, or for finance to defend it later. The time delta is signed
microseconds — the engine's own unit — and it is signed because a collector who
began recording before the registered start did nothing wrong, and the direction
is the evidence of that.

`configSnapshot` travels with the decision for the same reason. A match made at a
two-minute tolerance and one made at fifteen minutes are different claims about
the world, and the tolerance *will* move once device clock discipline is known
(D4). Without the snapshot, a re-run under a later config produces a different
answer with nothing on record to explain the change. It is persisted into
`audit_events.after`, which is `jsonb`, so none of this needed a migration.

Eligibility runs before any strategy and records each drop. The expiry check
compares against **the episode's start, never `now`**: a collector who began
inside a valid claim and recorded past its expiry recorded legitimately, and
comparing against `now` would retroactively invalidate every past episode as
claims age — in bulk, weeks later, on the money path. Note that `claimStatus` and
`claimExpiresAt` have no column yet; both fields are optional and an absent one
can never drop a candidate, because inventing an ineligibility out of missing
data is the same class of mistake as inventing a match.

## Which clock the start comes from

Camera PTS is not the only absolute clock in the folder, and refusing on its
absence alone sent two of the five real sessions to a human unnecessarily —
`072538` has zero-byte camera sidecars. So the start is tried in order of how far
the clock behind it can be trusted: camera PTS, then audio PTS, then the IMU,
then the human queue. Container duration is deliberately absent from that chain,
because it yields a length and not an absolute instant, so it cannot anchor
anything.

Every rung passes the same plausibility window first, and that gate is what makes
the chain an improvement rather than a hazard: `072516`'s IMU carries the epoch
twice and would otherwise anchor a payment in 1970 with full confidence. A source
that fails the gate falls through instead of winning. The source and its
confidence travel on the decision, because a resolution anchored on the IMU is
weaker evidence than one anchored on camera PTS and settlement should be able to
see which it got.

The resolver reads no clock, so its future bound defaults to the year 2100.
Narrowing it to `now + slack` is the adapter's job, in `episodes.ts`, which is
the only place a clock is allowed.

## The folder name is never parsed into an instant

`20260813_072310` carries no timezone, and neither does the manifest's
`start_time` — `"2026-08-13T09:00:00.000"` has no zone suffix, so `Date.parse`
returns a different moment depending on the host's zone. Seven hours, in Vietnam.
D4, the official file naming and directory specification, would settle it and has
not been received.

None of that matters here, because the resolver never converts either string into
a moment. It takes the start from the PTS sidecar's `timestamp_us`, which is an
absolute epoch. The one place the engine does call `Date.parse` on the manifest
(`timing.ts:635`) is safe only because it takes a *difference* between start and
end, so the offset cancels; do not extend that pattern to anything that resolves
an instant.

## What would change if the device wrote a claim token

Today it writes nothing useful: firmware 1.0.3 emits no `task_id`, no `worker_id`
and no `collection_session_id`, and the manifest's `session_id` is absent in all
five real samples. `resolverDefects` already cross-checks a declared session id
against the resolved one and raises `SESSION-CONFLICT` where they disagree, which
is defensive code waiting for D4.

If the device gained the ability to write a claim token, it would become a
**fourth strategy ahead of the other three**, and two rules would come with it.
An exactly-matching token resolves without a human. A token that matches nothing
must **stop** — return unmatched, and never fall through to time matching. A token
that matches nothing means the card carries a registration we do not have, or the
token was corrupted; both need a person, and degrading to a weaker strategy would
paper over a real fault at exactly the moment it mattered. A token matching more
than one candidate should be impossible, and if it happens it is a serious fault
that must surface rather than be tie-broken away.

The manifest could not be trusted to carry it. UPL-08 makes the manifest advisory
throughout — its `duration_sec` overstates media by 34% and its file list names
files that do not exist — and a device rewriting its own metadata must not be able
to re-attribute a payment. A token would need to be written where the device
cannot revise it, and the same argument that keeps the episode id derived from the
folder basename rather than from content applies here too.
