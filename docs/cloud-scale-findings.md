# Cloud upload leg at pilot scale — 2026-09-05

Measured against MinIO on localhost, before any contact with GreenNode. Every
number here was produced by `packages/api/scripts/scale-bench.ts` on this
machine; nothing is estimated.

**Payload.** 6,829,124,978 bytes (6.83 GB), built by concatenating the real
`ego_AZER76400FE_19700101_003357_camera_left_part0001.mp4` 34 times. That is a
true one-hour segment: the device writes `video_segment_duration_sec = 3600`
and the real footage runs at 1.89 MB/s per camera. Real H.264 bytes, not
compressible padding, so the transport sees what it will see in the field.

## What was measured

| Step | Wall | On the wire | Peak RSS |
|---|---|---|---|
| sha256 of the file | 44.0 s | — | — |
| upload, 102 × 64 MiB parts | 238.4 s | up 6,846.18 MB / down 12.67 MB | 241.80 MB |
| read-back verification | 108.8 s | up 2.38 MB / down 6,837.01 MB | 233.62 MB |
| resume after a killed link | 106.5 s | up 3,953.23 MB / down 7.23 MB | 237.94 MB |

## Three findings

### 1. The serial part loop, not the network, is the ceiling

Upload ran at **28.6 MB/s (229 Mbps)** to a container on loopback, where there
is no network at all. Each 64 MiB part took 2.34 s and the next did not start
until it finished. Read-back over the same link ran at **62.8 MB/s** — more
than twice as fast — because a download streams continuously.

GreenNode sells us 10 Gbps shared. At 28.6 MB/s we would use **2.29%** of it
(10 Gbps is 1250 MB/s), leaving 97.71% headroom at the measured serial rate.
The pipe is not the constraint and buying more of it would change nothing.

Scale: 40,000 hours is roughly 560 TB, which at this rate is about **227 days**
of continuous single-stream upload. The ~20-device pilot will not meet that
wall; 500 devices would. The fix is concurrency in `uploadEpisode`, not a
bigger link. `PART_SIZE` is fixed at 64 MiB with a `ponytail:` note capping one
file at 640 GiB, which is not the limit that bites — the serial loop is.

### 2. Resume is correct, and does not re-send

MinIO was stopped 70 s into the upload and restarted. **43 of 102 parts
survived on the server (2,885,681,152 bytes)**, and the resumed run sent
**3,953.23 MB instead of 6,846.18 MB** — skipping 2,892.95 MB, which matches
the held bytes to within 7.27 MB of protocol overhead. It re-sent the 59
missing parts and nothing else.

This is worth stating plainly because the repo has been bitten before: a re-run
that "re-downloaded every byte it had already verified". That failure does not
occur on this path. `ListMultipartUploads` / `ListParts` are consulted and the
held parts are honoured.

### 3. Memory is bounded, and the protocol is nearly free

Peak RSS stayed at **241.80 MB uploading and 233.62 MB verifying** a 6.83 GB
file. Neither direction buffers a whole file or a whole part beyond what it
needs. Wire overhead on the upload was **0.25%** (6,846.18 MB sent for
6,829.12 MB of payload).

## What this costs per session, end to end

One hourly camera file: 44.0 s hashing at import, 238.4 s upload, 108.8 s
verification — 391.2 s, or **6.5 minutes**, and **2.004× the payload in traffic**
(13,683 MB moved for 6,829 MB stored). A two-camera hourly session is roughly
**13 minutes of pipeline time** before a reviewer can start.

That 2× figure is the one to put in front of GreenNode when asking about
egress: verification re-reads every byte by design, because their suggested
"read the hash back from object metadata" returns the hash we sent rather than
a hash of the bytes they stored, and proves nothing.

## GreenNode answers — 2026-09-06

International egress is a self-service dedicated package at 200 or 500 Mbps.
The 500 Mbps package is 75,000,000 VND/month at −50%.

The vServer↔vStorage internal link is 1 Gbps. Our measured serial upload uses
~229 Mbps of it (22.9%), leaving 771 Mbps (77.1%) headroom.

**GreenNode's answer, 2026-09-06.** The 1 Gbps is per vServer instance
(flavor); a bigger flavor buys more, by resize. The vStorage quota page for
HCM04 gives, per farm: download 10 Gbps domestic (shared) / 300 Mbps
international, upload 10 Gbps domestic (shared) / 300 Mbps international.
What that means here: an upload centre in Vietnam is domestic, so GreenNode's
side is not its ceiling; the centre's own uplink is. The 300 Mbps international
figure touches only two things, this US-based dev box and any raw video
streamed to Shenzhen (D11, which data residency argues against anyway). The
0.236 MB/s (1.9 Mbps) measured below from Massachusetts is 0.6% of that
international cap, so it is the transpacific path, not a quota, and says
nothing about the pilot. At 1 Gbps a verification read-back of one hourly
camera file (6,829 MB) is about 55 s; twenty collectors' eight-hour days,
two cameras, are about five hours of read-back on one instance per day.

## What was NOT tested

- **GreenNode itself.** S3 keys now exist for HCM04. Everything measured here is MinIO
  on loopback, which flatters latency and says nothing about their throttling,
  their 200 PUT/s and 500 GET/s per-IP limits, or real internet loss.
  *Superseded 2026-09-06: HCM04 has now been contacted. See the section below
  for what that run did and did not cover.*
- **Concurrency.** The serial ceiling is measured; no concurrent variant was
  built or benchmarked, so the speed-up is unquantified.
- **A real multi-part session** (`part0002` and beyond). Still faked — no
  recording over one hour has ever been captured from the device.
- **Bucket lifecycle rules** for aborting incomplete multipart uploads. The
  code's own abort is scoped `Prefix: key` and is per-key hygiene during an
  upload, *not* a global orphan reaper; a lifecycle rule would add cleanup we
  do not have. Untested because there is no bucket.
- Sustained multi-file batches, and anything about cost.

## HCM04 — first real run (2026-09-06)

The first bytes PlayerOne has ever sent to GreenNode. Everything above this
heading is MinIO on loopback; everything below is `hcm04.vstorage.vngcloud.vn`
(42.1.110.200), bucket `playerone-pilot-test`.

**Read the vantage before reading the numbers.** This ran from a machine on a
US university network in Massachusetts, over the public internet, to Ho Chi
Minh City. It is not the GreenNode VPC and it is not the upload centre's link.
Every MB/s below is a floor and none of them is the pilot's number.

`packages/api/scripts/scale-bench.ts` now takes its store from `STORAGE_*` via
the product's own `s3StoreFromEnv`, falling back to the MinIO container when
`STORAGE_ENDPOINT` is unset. `wire()` reads the MinIO container's `eth0` and
cannot see a remote store, so against HCM04 the wire columns print `n/a`. The
byte counts below come from the file and the part plan, not from a counter.

### The bucket

Created by `CreateBucket` at 15:45:05 UTC. The account held zero buckets
before. `HeadObject` reports the storage class as `STANDARD_TIERING`; whether
that string is HCM04's name for Gold cannot be told from the S3 response, which
carries no tier name of its own — it needs confirming against the portal or
GreenNode. No Instant Archive was touched.

**`CreateBucket` refuses `region: 'auto'`.** `S3ObjectStore` builds its client
with `region: 'auto'`, and the SDK turns that into
`<LocationConstraint>auto</LocationConstraint>`, which HCM04 answers with
`InvalidLocationConstraint`, HTTP 400, *The specified location-constraint is not
valid*. The identical call with `region: 'us-east-1'` — which makes the SDK omit
the element entirely — created the bucket. This is a control-plane problem only:
every data-plane call in this run went out with `region: 'auto'` and was
accepted, so that setting stands for everything the product actually does. A
bucket is created once, by hand.

### What was measured

| Step | Bytes | Wall | Rate | Peak RSS |
|---|---|---|---|---|
| sha256 of the file | 200,856,617 | 1.9 s | 108.0 MB/s | — |
| upload, 3 × 64 MiB parts | 200,856,617 | 852.6 s | 0.236 MB/s | 207.13 MB |
| read-back verification | 200,856,617 | 737.8 s | 0.272 MB/s | 146.10 MB |
| resume after a killed process | 133,747,753 sent | 1794.4 s | 0.075 MB/s | 208.22 MB |
| read-back of the resumed object | 200,856,617 | 478.9 s | 0.419 MB/s | 149.63 MB |

The read-back verdict, which is the point of the whole run: `verify` printed
`mismatches=[] bytes=200856617`.

The payload is the real
`ego_AZER76400FE_19700101_003357_camera_left_part0001.mp4`, 200,856,617 bytes.
The 436 MB often quoted is the whole session directory; this one camera file is
200.86 MB. `planParts` cut it into 67,108,864 + 67,108,864 + 66,638,889 bytes.

### 1. GreenNode stores the bytes we sent

`verify` read all 200,856,617 bytes back out of HCM04, hashed them, and
returned `mismatches=[]`. The digest is
`dc8a52f97b7d86475c3ef5a4450ef9840298c3e5d802b4ece1fe9b0eb2493b12`, the same
one the local file hashes to. `HeadObject` shows the `sha256` user metadata
round-tripped intact and an ETag of `"681acb864c28642069dd9113eb0f1f56-3"`.

This is the result the whole cloud leg was waiting on and it is clean.

The first attempt at this measurement died after about 94 minutes with
`getaddrinfo ENOTFOUND hcm04.vstorage.vngcloud.vn`, after the SDK's three
retries. That is this machine's DNS, not GreenNode: `nslookup` resolved the
name a minute later and the immediately re-run verification passed. It is
recorded because it is a link fault on a leg the pilot will run unattended.

### 2. Resume works on HCM04, and Complete lied about it once

Two kills, on a second key.

Killed at 400 s: `heldParts=0`. Not one 64 MiB part had finished, so nothing
was held. The brief asked for a ~30 s interruption; on a 0.236 MB/s link that
holds nothing by construction, which is why 400 s and then 560 s were used.

Killed at 560 s: `heldParts=1`, `heldBytes=67,108,864` — and the second run had
adopted **the same `uploadId` the first killed run created**
(`2~QK1H3a7pc8JGFaHZtG3NSc6ysD2U1Al`). `ListMultipartUploads` and `ListParts`
behave as they do on MinIO; no orphan second upload was started. While those
67,108,864 bytes were held, `ListObjectsV2` on the key reported **0 objects** —
the invisible storage cost `docs/RUNNING.md` warns about reproduces exactly on
GreenNode, and the lifecycle rule that reaps it is still not set on this bucket.

The third run skipped the held part and sent parts 2 and 3 — **133,747,753 of
200,856,617 bytes, 66.6%, skipping 67,108,864 bytes (33.4%)**. Then
`CompleteMultipartUpload` threw `InvalidPart`, HTTP 400, request id
`tx00000695661fc271dfb22-006a9db26e-4e60369a5-default`, and `put()` failed.

**The object was already there.** `HeadObject` gives it a `LastModified` of
18:31:12 UTC, 200,856,617 bytes, ETag `"681acb864c28642069dd9113eb0f1f56-3"` —
byte-identical to the object from the clean run — while the process did not
exit until 18:35:28 UTC. The complete had succeeded about four minutes before
the caller was told it had failed. Reading that object back gave
`mismatches=[]` as well, so the resumed bytes are right.

Re-running the same `put` afterwards returned `kept` in 3.8 s and moved
nothing.

What this costs: a spurious `InvalidPart` makes the transport mark a delivery
failed on an object that is present and correct, and the recovery is a re-run
costing 3.8 s. What is not known: whether this was a lost or late response plus
an SDK retry of Complete, or HCM04 answering a single Complete late and wrong.
It happened once and was not reproduced.

### 3. From this vantage the link is the ceiling, not the serial part loop

Upload 0.236 MB/s, download 0.272 MB/s — a ratio of 1.15. On MinIO over
loopback, download was 2.2× upload, and that gap is what exposed the serial
part loop as the constraint. Here both directions are pinned by a transpacific
link and the loop never gets a chance to be the slow part. Nothing in this run
confirms or refutes the serial-loop finding above; it is untestable from
Massachusetts.

The rate also wandered in a way loopback never did: uploads between 0.075 and
0.236 MB/s, downloads between 0.272 and 0.419 MB/s, across five transfers of
the same 200 MB file inside three hours.

### 4. Nothing here went near GreenNode's published limits

Peak concurrency was one request. The whole session issued on the order of 15
PUT-class calls (CreateMultipartUpload, UploadPart, CompleteMultipartUpload,
DeleteObject) and about 30 GET-class ones, spread over three hours. The 200
PUT/s and 500 GET/s per-IP limits and the 1500 PUT/s per-path limit were never
approached and remain untested.

### Cleanup

Both objects were deleted. `ListObjectsV2` and `ListMultipartUploads` on
`playerone-pilot-test` both return empty. The bucket was kept — it is the
pilot's. No multi-gigabyte local file was built.

### What was NOT tested, still

- **Anything from inside the GreenNode VPC**, or from the upload centre. Every
  rate above is the public internet from a US campus and says nothing about the
  1 Gbps vServer↔vStorage link the pilot runs on.
- **The 6.83 GB payload against HCM04.** Disk allowed it (27 GB free against
  the 15 GB needed). At the 0.236 MB/s measured here that upload is 28,980 s —
  8.05 hours — plus about 7 hours of read-back, on a link that already dropped
  DNS once in this session. It was skipped deliberately: it would re-measure the
  same rate for 34× as long.
- **Whether the `InvalidPart` reproduces.** One occurrence.
- **The bucket lifecycle rule** for aborting incomplete multipart uploads. Still
  not set on `playerone-pilot-test`, and the orphan-parts behaviour it exists to
  reap has now been seen on GreenNode and not only on MinIO.
- **Concurrency.** Still no concurrent variant, still unquantified.
- Sustained multi-file batches, GreenNode's throttling behaviour, and cost.
