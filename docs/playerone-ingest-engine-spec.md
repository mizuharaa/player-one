# PlayerOne — Ingest engine specification

Draft · 19 Aug 2026 · PT Lab · companion to Engineering Brief v1.0 §5.3, §6.8, Part 10

---

## 1. Why this is not blocked on the Ego SDK

The SDK covers **device communication**: pairing, Wi-Fi transfer, authentication, reading battery and free space. Those gate Path A (`D1`) and Path B (`D2`).

Ingest starts from a **directory on a filesystem**. Path C reaches that state by removing the card, which requires nothing from PaXini. Path A and Path B, whenever they arrive, deliver the same directory by a different route.

**Ingest is therefore the largest piece of P0 work with zero external dependencies.** It is also the piece with the most complete test data already in hand.

**One real risk.** The sample sessions were produced by firmware 1.0.3. A firmware change can alter the manifest shape or file naming. Mitigations are built into the design rather than bolted on: the manifest is advisory in every case, the parser records the firmware version it saw, and `ING-31` gates unknown firmware into review rather than silent misparsing.

---

## 2. Scope

**In scope.** Reading a session directory; identifying and validating media; computing timing and true duration; hashing; assembling multi-part recordings; emitting one episode record; classifying defects; deciding ok / flagged / quarantined.

**Out of scope.** Device communication; uploading; proxy and thumbnail generation; review; settlement; face masking. Ingest produces the record those consume.

**Two callers, one engine.** The same package runs as a CLI at an upload centre with the network down, and as a worker inside the API after a cloud upload completes. No network dependency, no database dependency in the core.

---

## 3. Input contract

One session, one directory, named `ego_{SERIAL}_{YYYYMMDD}_{HHMMSS}`:

```
ego_AZER76400FE_20260813_072310/
├── meta_..._072310.json                    manifest (advisory)
├── ..._calibration_camera.yaml             intrinsics, extrinsics, both cameras
├── ..._calibration_imu.yaml                T_cam_imu, noise model, biases, gravity
├── ..._camera_left_part0001.mp4            H.264
├── ..._camera_left_part0001_pts.csv        one µs timestamp per frame
├── ..._camera_right_part0001.mp4
├── ..._camera_right_part0001_pts.csv
├── ..._imu_part0001.csv                    timestamp_us, x, y, z, type
├── ..._audio.wav
└── ..._audio_pts.csv
```

Video segments at `video_segment_duration_sec: 3600`, so a two-hour session yields `part0001` and `part0002`.

**The governing principle, from §5.3.9: the manifest is a hint, not a source of truth.** Every requirement below follows from that.

---

## 4. Functional requirements

### 4.1 Discovery and resolution

| ID | Pri | Requirement | Source |
|---|---|---|---|
| ING-01 | P0 | Media is located by **directory scan and filename pattern**, never by the manifest's `files` block. That block does not resolve on any known session. | `UPL-09`, §5.3.7 |
| ING-02 | P0 | The manifest is parsed for **context only**: device serial, declared session id, declared start and end, firmware version. Never for duration, frame counts, or file presence. | `UPL-08` |
| ING-03 | P0 | A missing or unparseable manifest does not fail ingest. Session identity is recovered from the directory name and file names. | §5.3.9 |
| ING-04 | P0 | Unknown files in the directory are recorded in the episode record and carried forward, never silently dropped. | — |
| ING-05 | P0 | Filename parsing yields: device serial, session timestamp, stream role, part number. Role and part are the only fields ingest depends on. | §5.2 |

### 4.2 Timing and duration — the money path

| ID | Pri | Requirement | Source |
|---|---|---|---|
| ING-06 | P0 | **Raw duration is computed from stream timestamps, never from the manifest.** The manifest's `duration_sec` is session wall clock and overstates media by up to 34%. | `PLT-09`, §5.3.1 |
| ING-07 | P0 | Per stream, ingest records first PTS, last PTS, sample count and derived span, in microseconds. | `UPL-14` |
| ING-08 | P0 | **Usable extent is the intersection of stream coverage, not the union.** For `072310` that is 8.500 s, not 9.286 s. | `UPL-14`, §5.3.3 |
| ING-09 | P0 | `raw_duration_s` on the episode record equals the usable extent. Settlement reads this field and nothing else. | `QR-03` |
| ING-10 | P0 | Cross-stream skew is computed and stored as a property of the episode. `072310` shows 504 ms between IMU and video. | `P2-05`, §5.3.3 |
| ING-11 | P0 | **Zero-byte or missing PTS files do not fail ingest.** Timing falls back, in order: container PTS via ffprobe, then IMU span, then wall clock. The method used is recorded. | `UPL-12`, §5.3.6 |
| ING-12 | P0 | Timing confidence is recorded per episode: `exact` (PTS sidecar), `derived` (container), `estimated` (IMU or wall clock). Anything below `exact` is flagged. | — |
| ING-13 | P1 | Where wall clock is the only source, `raw_duration_s` is **discounted by the measured start-up offset** rather than taken at face value, and the episode is flagged for manual duration review. | §5.3.1 |

### 4.3 Tolerating broken sessions

| ID | Pri | Requirement | Source |
|---|---|---|---|
| ING-14 | P0 | Sessions with `status: "recording"`, `duration_sec: 0`, absent `end_time` or zeroed statistics **ingest normally** when media is present. Flagged, never discarded. `073055` is 458 MB of payable data behind all four of those conditions. | `UPL-10`, §5.3.5 |
| ING-15 | P0 | The manifest statistics block is never used to decide whether a stream exists. Presence is decided by the file. `audio_frame_count: 0` appears in 5/5 manifests alongside a populated WAV. | §5.3.4 |
| ING-16 | P0 | Declared frame counts are recorded as *declared* and compared against the PTS file. Disagreement is a flag, not a failure. `072310` declares 260, PTS holds 256. | §5.3.2 |
| ING-17 | P0 | **Nothing is ever discarded.** An episode that cannot be trusted goes to quarantine with a reason code and stays there until a human decides. | `UPL-10` |

### 4.4 Multi-part assembly

| ID | Pri | Requirement | Source |
|---|---|---|---|
| ING-18 | P0 | Parts are assembled into one episode in ascending part order, per stream role. | `UPL-11` |
| ING-19 | P0 | Ordering is by **PTS continuity**, with the part number as a tiebreak. A part number that contradicts the timestamps is a flag. | `UPL-11` |
| ING-20 | P0 | A gap between the end of one part and the start of the next, beyond one frame interval, is recorded as a gap and the episode is flagged. Gaps do not reduce `raw_duration_s` silently — they are itemised. | — |
| ING-21 | P0 | A missing part in the middle of a sequence quarantines the episode. A missing part at the tail flags it. | — |

### 4.5 Calibration

| ID | Pri | Requirement | Source |
|---|---|---|---|
| ING-22 | P0 | Both calibration YAMLs travel with the episode and are hashed alongside the media. | `UPL-13`, §5.2 |
| ING-23 | P0 | **A missing calibration file quarantines the episode.** Without it the recording is scientifically worthless — geometry cannot be reconstructed and the IMU cannot be fused. | §5.2 |
| ING-24 | P0 | The calibration's own serial (`CH5LB5400J5` in the sample) differs from the device serial. Both are recorded; the mismatch is not treated as an error. | §5.2 |
| ING-25 | P1 | The camera-naming conflict — manifest says `color_left`/`color_right`, calibration says `IR_L`/`IR_R` — is recorded verbatim from both sources and flagged. Ingest does not resolve it. Open question with PaXini. | §5.3.8 |

### 4.6 Parsing quirks

| ID | Pri | Requirement | Source |
|---|---|---|---|
| ING-26 | P0 | The IMU CSV header is `timestamp_us\t,x\t,y\t,z\t,type` — comma-separated field names each carrying a **trailing tab**. The parser strips whitespace from header fields. A naive split mislabels every column. | §5.2 |
| ING-27 | P0 | Accel and gyro rows are interleaved and share timestamps. Sample count per type is derived by filtering on `type`, not by dividing the row count. `072310` holds 18,480 rows = 9,240 accel + 9,240 gyro. | §5.2 |
| ING-28 | P1 | IMU nominal rate is derived from median inter-sample interval per type, and compared against the declared 1 kHz. | `UPL-18` |

### 4.7 Integrity and identity

| ID | Pri | Requirement | Source |
|---|---|---|---|
| ING-29 | P0 | SHA-256 is computed for every file during a single streaming pass and stored per file in the episode record. This is the checksum the cloud verifies against. ETag is never used — GreenNode's is not a plain digest. | `UPL-04` |
| ING-30 | P0 | A **content fingerprint** is derived from device serial + session start + the sorted media hashes. Two deliveries of the same session by different paths resolve to one episode. | `UPL-15` |
| ING-31 | P0 | The firmware version seen in the manifest is recorded on every episode. An unrecognised version ingests, flags, and raises a compatibility warning rather than parsing optimistically. | §5.3.9 |
| ING-32 | P0 | Ingest is **idempotent**. Re-running over the same directory produces the same episode identity and creates no duplicate rows. | `UPL-16` |
| ING-33 | P0 | An interrupted ingest resumes without duplication and without re-hashing completed files. | `UPL-16` |

### 4.8 Safety

| ID | Pri | Requirement | Source |
|---|---|---|---|
| ING-34 | P0 | **Ingest never writes to the source directory.** Not a lock file, not a marker, not a log. The TF card is evidence. | `UPL-03` |
| ING-35 | P0 | Free-space check before an import begins; refusal states the shortfall. | `UPL-17` |
| ING-36 | P0 | Ingest has no network dependency in its core path and completes with the link down. | `NFR-06` |

---

## 5. Output — the episode record

One JSON document per episode. This is the contract every downstream component reads.

```jsonc
{
  "schema_version": "1.0.0",
  "episode_id": "<uuid v7, assigned at first ingest>",
  "content_fingerprint": "<sha256>",
  "state": "ok | flagged | quarantined",

  "source": {
    "path": "ego_AZER76400FE_20260813_072310",
    "ingest_tool_version": "0.3.1",
    "ingested_at": "2026-08-19T09:14:22Z",
    "ingest_host": "uc-hcm-01"
  },

  "device": {
    "serial": "AZER76400FE",
    "firmware_declared": "1.0.3",
    "calibration_serial": "CH5LB5400J5"
  },

  "declared": {                       // from the manifest, for comparison only
    "session_id": "...",
    "status": "recording",
    "duration_sec": 0,
    "start_time": "...",
    "end_time": null,
    "video_left_frame_count": 260
  },

  "streams": [
    {
      "role": "camera_left",
      "parts": [
        { "file": "..._part0001.mp4", "bytes": 20447232, "sha256": "..." }
      ],
      "pts_source": "sidecar | container | absent",
      "first_pts_us": 1786605795008991,
      "last_pts_us":  1786605803508991,
      "sample_count": 256,
      "span_s": 8.500,
      "nominal_rate_hz": 30.0
    }
  ],

  "timing": {
    "method": "pts_sidecar | container | imu_span | wall_clock",
    "confidence": "exact | derived | estimated",
    "usable_start_us": 1786605795008991,
    "usable_end_us":   1786605803508991,
    "raw_duration_s": 8.500,           // ← settlement reads this and nothing else
    "max_stream_skew_ms": 504.2
  },

  "calibration": {
    "present": true,
    "files": [ { "file": "..._calibration_camera.yaml", "sha256": "..." } ]
  },

  "discrepancies": [
    { "code": "DUR-MANIFEST-INFLATED", "severity": "info",
      "detail": "declared 12.852 s vs measured 8.500 s (1.51x)" }
  ],

  "unclassified_files": []
}
```

**Design notes.** `declared` is kept beside the measured values rather than discarded, so any dispute is answerable from the record alone. `streams` is an open list rather than fixed fields, per `P2-02` — Phase 2 adds glove encoder and tactile streams without a migration.

---

## 6. Discrepancy taxonomy

| Code | Severity | Meaning |
|---|---|---|
| `DUR-MANIFEST-INFLATED` | info | Declared duration exceeds measured. Expected on every session. |
| `FRAMECOUNT-MISMATCH` | info | Declared frame count differs from PTS count. |
| `AUDIO-STATS-ZERO` | info | `audio_frame_count: 0` with audio present. Expected on every session. |
| `MANIFEST-FILES-UNRESOLVED` | info | The `files` block does not match disk. Expected on every session. |
| `SESSION-UNCLOSED` | flag | `status: recording`, or no `end_time`. |
| `STATS-ZEROED` | flag | Statistics block all zero with media present. |
| `PTS-EMPTY` | flag | Zero-byte PTS sidecar; timing fell back. |
| `PTS-ABSENT` | flag | No PTS sidecar at all. |
| `TIMING-ESTIMATED` | flag | Confidence below `exact`. |
| `STREAM-SKEW-HIGH` | flag | Skew beyond a configured threshold. |
| `PART-GAP` | flag | Discontinuity between parts. |
| `PART-ORDER-CONFLICT` | flag | Part number contradicts PTS order. |
| `FIRMWARE-UNKNOWN` | flag | Firmware version not in the tested set. |
| `CAMERA-NAMING-CONFLICT` | flag | Manifest and calibration disagree on camera type. |
| `IMU-RATE-ANOMALY` | flag | Measured rate deviates from 1 kHz beyond tolerance. |
| `CALIB-MISSING` | **quarantine** | Calibration absent. Episode is scientifically worthless. |
| `MEDIA-MISSING` | **quarantine** | No video stream found. |
| `MEDIA-UNREADABLE` | **quarantine** | Container corrupt, ffprobe fails. |
| `PART-MISSING-INTERIOR` | **quarantine** | Gap in the part sequence. |
| `CHECKSUM-MISMATCH` | **quarantine** | Hash differs from a prior ingest of the same fingerprint. |

**State rules.** `ok` — no flags above info. `flagged` — proceeds to review, defects visible to the reviewer. `quarantined` — does not enter the review queue, does not generate settlement, is never deleted.

---

## 7. Non-functional requirements

| ID | Pri | Requirement |
|---|---|---|
| ING-N1 | P0 | **Constant memory.** Media is streamed, never buffered. A 32 GB session must not use materially more RAM than a 40 MB one. |
| ING-N2 | P0 | **Deterministic.** The same input yields byte-identical output apart from `ingested_at` and `ingest_host`. |
| ING-N3 | P0 | **Read-only on source.** Verifiable by running against a read-only mount. |
| ING-N4 | P0 | Throughput must exceed upload throughput, or ingest becomes the upload-centre bottleneck. Target **≥ 150 MB/s** on upload-centre hardware, dominated by SHA-256. |
| ING-N5 | P0 | Runs on Ubuntu 22.04 amd64 and inside the API worker container. One package, one implementation. |
| ING-N6 | P1 | Structured logging with one correlation id per ingest run. |
| ING-N7 | P1 | Progress reporting suitable for a UI: files done, bytes done, current stage. |

---

## 8. Acceptance benchmarks

Gate for milestone 0.1. Every one is machine-checkable and belongs in CI.

### 8.1 Against the five real sessions

| # | Benchmark | Pass condition |
|---|---|---|
| B1 | All five ingest | 5/5 produce a record. 0 discarded. |
| B2 | **The money benchmark** | `072310` → `raw_duration_s` = **8.500 s ± 0.01**. Must not equal 12.852 (manifest) or 9.252 (IMU span). |
| B3 | Unclosed session with zeroed stats | `073055` → ingests, `raw_duration_s` ≈ **134.07 s ± 1%**, flags `SESSION-UNCLOSED` and `STATS-ZEROED`, state `flagged`. |
| B4 | Zero-byte PTS | `072538` → ingests, `raw_duration_s` ≈ **21.71 s ± 1%**, `timing.method` ≠ `pts_sidecar`, flags `PTS-EMPTY`. |
| B5 | Manifest file block never used | 0/5 sessions resolve media via `files`; 5/5 resolve via scan. Asserted by a test that deliberately corrupts the block and expects no change in output. |
| B6 | Audio detected despite zeroed stats | Audio stream present in 5/5, span > 0 in 5/5. |
| B7 | Frame count from PTS | `072310` → `camera_left.sample_count` = **256**, `declared.video_left_frame_count` = 260, `FRAMECOUNT-MISMATCH` raised. |
| B8 | Stream skew measured | `072310` → `max_stream_skew_ms` = **504 ± 5**. |
| B9 | Intersection not union | `072310` → usable extent 8.500 s. A union implementation would give ≈ 9.286 s and fails. |
| B10 | Calibration attached | 2 calibration files hashed and attached in 5/5. |
| B11 | IMU parsed correctly | `072310` → 18,480 rows resolve to **9,240 accel and 9,240 gyro**, columns correctly labelled despite the trailing-tab header. |
| B12 | Duration ratios reproduced | Measured-to-declared ratios match §5.3 across all five, within 1%. This is the table shown to finance and PaXini. |

### 8.2 Against synthetic fixtures

The five real sessions are all single-part and all have calibration. These cases must be constructed.

| # | Benchmark | Pass condition |
|---|---|---|
| B13 | Multi-part assembly | Three parts, correct order, one episode, `raw_duration_s` = sum of spans minus gaps. |
| B14 | Part order conflict | Part numbers reversed relative to PTS → assembled by PTS, `PART-ORDER-CONFLICT` raised. |
| B15 | Interior part missing | `part0002` removed from a three-part session → **quarantined**, `PART-MISSING-INTERIOR`. |
| B16 | Truncated container | MP4 cut mid-file → **quarantined**, `MEDIA-UNREADABLE`, no crash, no partial record. |
| B17 | Calibration removed | → **quarantined**, `CALIB-MISSING`. |
| B18 | Duplicate delivery | Same session ingested twice by different paths → **one** episode, identical `content_fingerprint`. |
| B19 | Manifest absent | → ingests, identity from directory and filenames. |
| B20 | Unknown firmware string | → ingests, `FIRMWARE-UNKNOWN` flagged. |

### 8.3 Non-functional

| # | Benchmark | Pass condition |
|---|---|---|
| B21 | Constant memory | Peak RSS on a synthetic 32 GB session **< 512 MB**. |
| B22 | Throughput | **≥ 150 MB/s** sustained. A 16 GB recorded hour completes in under ~2 minutes. |
| B23 | Read-only source | Run against a read-only mount → completes with zero write attempts. |
| B24 | Idempotency | Second run → identical fingerprint, zero new episode rows. |
| B25 | Resume | Kill at 50% of hashing, restart → completes without re-hashing finished files, output identical to an uninterrupted run. |
| B26 | Determinism | Two runs → byte-identical output apart from `ingested_at` and `ingest_host`. |

**Gate: ingest proof.** B1–B12 green against the real sessions, B13–B20 green against fixtures, B21–B26 green in CI. Nothing downstream of milestone 0.1 starts until this passes.

---

## 9. Deferred

`UPL-18` IMU continuity and drop-out validation beyond a rate check — P2. Automatic quality inspection — out of Phase 1 entirely. Proxy and thumbnail generation — a separate worker consuming the episode record, not part of ingest. Face masking — separate, and downstream of proxy generation.

---

## 10. Open items this spec creates

| ID | Item | Owner | Needed by |
|---|---|---|---|
| `ING-Q1` | Camera naming: `color_left` or `IR_L`? Determines whether the imagery is colour or infrared, and what the dataset is worth. | PaXini | Before dataset spec |
| `ING-Q2` | Confirm hourly segmentation is the only segmentation trigger, or whether size or storage pressure can also split a file. | PaXini | Before B13 fixtures are trusted |
| `ING-Q3` | Firmware versions in scope for the pilot fleet, so `ING-31` has a known set. | PaXini | Before 500-device wave |
| `ING-Q4` | Stream-skew threshold for `STREAM-SKEW-HIGH`. 504 ms is observed and apparently normal; what is abnormal? | PT Lab + PaXini | Milestone 0.1 |
