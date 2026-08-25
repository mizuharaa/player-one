# ADR 0001 — the review gate reads local verification, not a cloud receipt

**Status** Accepted, in force only while `REVIEW_VERIFICATION_GATE=local` (the
default). The exit mechanism is built — see "The exit, as built" below — and
setting the gate to `cloud` on a deployment whose uploads a real endpoint is
verifying supersedes this ADR.
**Date** 2026-08-24, exit mechanism 2026-08-25
**Affects** QR-02; PRD §11.3.1 rule 6

## Context

QR-02 requires that no episode enters review until the cloud has verified its
checksum. The intent is sound: a reviewer should never spend time on footage that
did not arrive intact, and a collector should never be paid for a delivery that is
still in flight.

The cloud does not exist. UPL-04, UPL-05 and UPL-06 are unbuilt, and the upload
path is blocked on deliverables PaXini owes (D1 and D2). There is no service that
can issue a verification receipt, so QR-02 as written is not a gate that can
currently be passed — it is a gate with nothing behind it.

Meanwhile the review standard itself does not exist either. PaXini said on
13 August that the in-the-wild standard must be rewritten during the pilot, and
the tool is how it gets written. Reviewer throughput is the programme's
bottleneck at 40,000 hours and needs the most time in front of actual PaXini
reviewers. Waiting for the cloud before anyone can review anything means the
review tool is exercised for the first time at the point the pilot is already
running.

## Decision

The review queue reads **the local integrity check the ingest engine already
performed**, at the moment the card was imported at the counter. Concretely, an
episode is eligible when:

- `episodes.resolution_state = 'resolved'` — it has a collector and a task
- `episode_ingests.state <> 'quarantined'` — the engine did not reject it
- no defect on that ingest whose `defect_codes.blocks_review` is true
- `measured_duration_s > 0`

`episodes.verification_state` stays `'pending'`, which is accurate: it means the
cloud has not confirmed anything, and it has not.

The engine's local check is not weak. It hashes every source file at import,
measures duration from stream timestamps rather than from the manifest, and
raises `MEDIA-TRUNCATED` when a container is structurally short — which is the
specific failure a transfer-integrity check exists to catch. `CHECKSUM-MISMATCH`
covers a second delivery whose bytes differ from the first. What the local check
cannot catch is corruption introduced *after* import, in transit to a cloud that
does not yet receive anything.

## The half that is not deviable

PRD §11.3.1 rule 6 has two parts. This ADR deviates from the review-gate half.
It does **not** deviate from the other half:

> **No TF card is cleared under this arrangement.**

The card is the only remaining copy until the cloud exists. No code path in the
review lane, the media route or the counter workflow deletes, moves or truncates
source media, and none may be added while this ADR is in force. `docs/review.md`
states this and `packages/api/src/media.ts` says it at the top of the file.

Operationally this means cards accumulate and are not returned to circulation for
reuse during the deviation. That is a real cost in card inventory and it is the
price of the deviation.

## Consequences

- Reviewers can work from the day footage is imported, and the review standard
  can be written against real material during the pilot rather than after it.
- An episode can be reviewed, settled and billed before any cloud copy exists.
  Between review and cloud upload, the TF card is the only copy of footage that
  has already been paid for. This is why the no-clearing rule is not deviable.
- `verification_state` remains a live column with a real meaning. When the cloud
  lands it starts moving to `'verified'` and can be added to the eligibility
  predicate without a migration.

## When this expires

This ADR is superseded the moment cloud verification exists — specifically, when
UPL-04/05/06 are running and `verification_state` is being set to `'verified'` by
something other than a human. At that point:

1. Add `verification_state = 'verified'` to the eligibility predicate in
   `packages/api/src/review.ts`.
2. Decide what to do about episodes already reviewed and settled under this
   deviation whose cloud copy then fails verification. That is a settlement
   question, not a review question, and it needs an answer before the switch —
   the review row and its spans are preserved, so it is answerable.
3. Only then may card-clearing policy be revisited, and separately.

## The exit, as built (2026-08-25)

The cloud leg landed (`packages/api/src/upload.ts`, migration 0007): multipart
upload to an S3-compatible endpoint configured by `STORAGE_*` environment
variables, verification by byte read-back against the per-file sha256 the
engine recorded at import — never an ETag, which GreenNode does not make a
content digest — and the UPL-06 cache gate as schema state. Against the exit
conditions above:

1. **Built, behind a flag.** `REVIEW_VERIFICATION_GATE=cloud` puts
   `verification_state = 'verified'` into the eligibility predicate. The flag
   defaults to `local` because no real endpoint exists until the GreenNode
   contract is signed, and a cloud gate with no cloud behind it reviews
   nothing. One addition applies under **both** settings: an episode whose
   cloud copy *failed* read-back is blocked from review — a copy known to be
   bad is not a pending one.
2. **Still owed, and still blocking the flip.** What settlement does about an
   episode reviewed and paid under this deviation whose cloud copy then fails
   verification remains undecided. The review row and its spans are preserved,
   so it stays answerable — but the flag stays `local` in production until it
   is answered.
3. Unchanged: card-clearing policy is revisited only after the flip, and
   separately. Nothing in the upload leg deletes anything — the cache-clean
   route records; no code path touches TF-card source media.

## Alternatives considered

**Wait for the cloud.** Rejected: it blocks the one piece of the system that
most needs pilot exposure on a dependency owed by a third party, and the review
standard is itself a pilot deliverable.

**Treat local verification as satisfying QR-02.** Rejected as dishonest. It is a
different check with different coverage, and recording it as if it were the
required one would leave nothing on record to explain the gap.

**Gate on cloud verification but let reviewers "preview" without settling.**
Rejected: it splits the review lane into two paths with different payment
semantics, which is more surface than the deviation it avoids, and a reviewer
whose verdict may not count is not exercising the real workflow.
