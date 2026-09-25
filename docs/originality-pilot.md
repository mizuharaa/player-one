# Originality gate: pilot operations

This gate is mandatory for unpaid, positive-amount bill lines. It follows the
review's ingest ID, never the episode's latest delivery. Both CSV exports,
preflight, new attempts and dispatch enforce it. Existing admitted transfers can
still reconcile; paid work is never clawed back. An already downloaded bank CSV
cannot be revoked: finance must refresh eligibility immediately before transfer.

## Before release

- Apply reviewed migrations 0039 and 0040 before starting the API or workers.
- Inventory affected live deliveries and attest operator identities below.
- Benchmark a real hourly Ego camera part against the shared 15-minute decoder
  deadline. Short fixtures and synthetic videos do not establish field capacity.
- Check the measured index limits before selecting a pilot volume. This is not
  a 40,000-hour or YouTube-scale capacity claim. Crops, overlays and field false
  positives still need calibration. Every usable assessment needs human review.
- Keep all TF-card/source copies. These procedures never clear a card.

## Operator identity and review

A different signed-in administrator must attest each decision maker through
`POST /api/originality/operators/:id/identity`, with the usual machine/operator
authentication and JSON `{ "collector_id": "<collector UUID or null>",
"reason": "Evidence for this identity check" }`. Send JSON null (not the string
"null") only after verifying that the staff member has no collector identity.
An unknown identity is blocked. Self-attestation, the footage's own collector and
its reviewer are excluded. Correcting the identity also changes current payment
eligibility; earlier decisions are not silently rewritten.

Finance opens a bill's originality panel, checks the exact assessment, matching
recordings and sample intervals, then records a reason. `cleared`, `reused` and
`accepted_unassessable` are distinct outcomes. Administrator acceptance of
unassessable work is limited to verified short/low-information/over-length media;
it is not a claim that a matcher cleared the recording. Missing media, bad SHA,
incomplete coverage, untrusted measurements and query limits cannot use it.
Confirmed reuse is sticky, and unpaid settlements are parked as duplicates.

## Missing card inventories and responsible operators

Run this read-only query against the intended environment before cutover. It
names the centre, handover operator and machine that can locate retained media.
No production inventory has been inferred from local test databases.

```sql
SELECT i.ingest_id, i.episode_id, i.source_basename, b.id AS batch_id,
       c.name AS centre, o.external_ref AS handover_operator,
       d.machine_identifier, h.tf_card_id, b.local_cache_cleaned_at
FROM episode_ingests i
JOIN episodes e USING (episode_id)
LEFT JOIN upload_batches b ON b.id=e.upload_batch_id
LEFT JOIN handovers h ON h.id=b.handover_id
LEFT JOIN upload_centres c ON c.id=h.upload_centre_id
LEFT JOIN operators o ON o.id=h.operator_id
LEFT JOIN upload_devices d ON d.id=b.upload_device_id
WHERE i.transport_extra_files IS NULL
  AND NOT EXISTS (SELECT 1 FROM collector_uploads u
    WHERE u.ingest_id=i.ingest_id AND NOT u.measured
      AND u.state IN ('verified','ingested'))
ORDER BY c.name, b.id, i.ingest_id;
```

The centre operator checks both the retained cache and TF card for each row.
`local_cache_cleaned_at` alone does not prove that every source copy is gone.
Record that physical check alongside the named ingest. If neither a complete
retained source nor an authoritative complete inventory exists, the delivery
remains unpayable; receipts alone cannot reconstruct the missing inventory.

For a current card delivery with retained local media, the normal authenticated
`POST /upload-batches/:batch/upload?reverify=1` rehashes transport extras, performs
cloud readback and persists the inventory in the audited verification transaction.
Empty extras are recorded as `[]`; null means unknown. Equal retries are allowed,
different extras are refused. Restore the source to the configured media root
before retrying. An older superseded ingest needs explicit operator recovery;
the normal batch route processes the current delivery only.

## Worker and retries

The reviewed image includes `packages/api/bin/originality-worker.ts` and a cloud
Compose worker service. It uses the runtime database credential and S3 read access;
the media mount is read-only. Run `node packages/api/bin/originality-worker.ts
--once` for a bounded batch, or omit `--once` for the loop. Running code locally is
not evidence that the service or migrations have been deployed.

The job lease and retry clock are separate from append-only assessments. Transient
failures back off from five minutes to one hour; deterministic failures wait for
inventory/policy changes. A crashed lease expires after three hours. New evidence
invalidates affected unpaid clearances, once per ordered ingest pair. A later
assessment needs its own decision. Decoder input is a private SHA-bound copy;
staged frame rows are invisible until an atomic header publication.

Scratch is container disk, not a 32-GiB RAM mount. Budget space for a complete
delivery per worker (maximum 32 GiB). Successful and handled failed runs delete
only their own scratch directory. If a process is killed, remove abandoned
`playerone-originality-*` directories only after confirming that no worker uses
them; never recursively clean the source/media root.

## Capacity evidence and stop rule

Measurements use isolated PostgreSQL 16 with 2 CPUs/2 GiB and seeded data; they
are not production or real-Ego throughput. The initial grouped query timed out
30/30 times at two million frames. Per-frame LATERAL aggregation with JIT disabled
passed 30/30 at that size (p95 1,073 ms, before the publication-header join).
The final 60-frame query with the publication-header join and `fastupdate=off`
passed 30/30 EXPLAIN and ordinary queries at both 1M and 2M published frames:

| Published frames | Corpus hours at 1 fps | Query p95 | Maximum |
| --- | ---: | ---: | ---: |
| 1,000,000 | 278 | 310 ms | 737 ms |
| 2,000,000 | 556 | 742 ms | 1,879 ms |

The colder first 2M page is included in that maximum. Raw hit p95/max were
454/508 at 1M and 891/941 at 2M; neither hit the 4,097 sentinel. All plans used
GIN, and exact, six-bit-near and mirrored planted references were retrieved.
At 4M frames, 120-frame pages timed out 30/30; 60-frame pages passed 30/30
(p95 1,812 ms, maximum 1,884 ms). The worker now uses 60-frame pages with
240 pages, preserving the full 14,400-frame coverage.
The initial 14,400-frame insert held the global lock for 5,098 ms, so frame writes
now stage outside that lock. The staged publication kernel measured p95 38 ms,
but excludes the full worker assessment and peer-invalidation transaction.
On the frozen integration source, the actual worker's lock duration through
COMMIT was p95 **34 ms** (maximum 46 ms) with no peers, and p95 **1,066 ms**
(maximum 1,140 ms) with 64 unpaid exact-match peers invalidated and reset.
Each case ran 20 times on a 24-frame real-FFmpeg synthetic clip, using isolated
1-CPU/2-GiB PostgreSQL with concurrent test workload. Timing starts after both
locks are acquired; decoding, staging and lock acquisition wait are excluded.
The 14,400-row kernel and 24-frame full-worker results are separate measurements,
not a full-length field benchmark. The stress case meets the two-second ceiling
in this sandbox, but does not meet the nominal tens-of-milliseconds target.

GIN pending lists caused reproducible query timeouts after only 2,400 new rows;
the index uses `fastupdate=off`, moving index maintenance into unlocked staging.
This does not fix footage skew: at 4M background frames, repeated synthetic
footage still exhausted the two-second budget, and 64 duplicate ingests reached
the raw-hit cap. Those results remain incomplete and unpayable. The operational
hours limit cannot guarantee availability for every scene or collection pattern.

At 1 sample/s, 1M frames is about 278 corpus hours; 2M is 556 hours and 4M is
1,111 hours. Uniform-hash collision modelling puts a 1% chance of any ambiguous
frame in a one-hour query near 9.05M frames (2,514 hours), but skewed real footage
and query latency can fail much earlier. Do not use that model as the safe limit.
The 40,000-hour target is about 144M frame rows and requires a different retrieval
capacity plan. Preserve Hamming<=6 recall; requiring two shared byte-pair tokens
would miss six bit flips spread across six distinct bytes.

The initial operational ceiling is **250 indexed corpus hours**, conservatively
below the measured 1M-frame run. The worker emits a structured
`originality_capacity` warning from **125 hours**, and a critical event from 250.
Route these stderr events to the deployment's monitoring before launch. Logging
does not itself stop task publication or recording: the operations owner must
hold new collection admissions at the ceiling. In-flight analyses and existing
payment safety checks continue. A warning is not approval to exceed this limit.
Before launch, the release owner must record the named PlayerOne collection lead
who receives this alert and can stop new admissions; that assignment and live
alert delivery are still unverified release requirements.

At the operational ceiling, hold new admissions and redesign or partition
retrieval, then repeat the same recall and resource proofs before raising the
limit. Do not clear query timeouts or silently truncate candidates. Establish an
alert at 50% of any newly approved measured ceiling before deployment.
