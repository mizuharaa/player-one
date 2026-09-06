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

## What was NOT tested

- **GreenNode itself.** S3 keys now exist for HCM04. Everything measured here is MinIO
  on loopback, which flatters latency and says nothing about their throttling,
  their 200 PUT/s and 500 GET/s per-IP limits, or real internet loss.
- **Concurrency.** The serial ceiling is measured; no concurrent variant was
  built or benchmarked, so the speed-up is unquantified.
- **A real multi-part session** (`part0002` and beyond). Still faked — no
  recording over one hour has ever been captured from the device.
- **Bucket lifecycle rules** for aborting incomplete multipart uploads. The
  code's own abort is scoped `Prefix: key` and is per-key hygiene during an
  upload, *not* a global orphan reaper; a lifecycle rule would add cleanup we
  do not have. Untested because there is no bucket.
- Sustained multi-file batches, and anything about cost.
