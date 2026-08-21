# PlayerOne — build status

Against `Player One — Engineering Brief v1.0`, Part 6 requirement IDs.
Last updated 2026-08-21. Branch `fix/payable-window-intervals`, ahead of `main` (`927e00f`).

Everything marked DONE below is claimed with a command that checks it. A reviewer
should run them rather than trust the table.

```
export DATABASE_URL='postgres://postgres:<pw>@localhost:5432/playerone_spine'
pnpm install && pnpm typecheck && pnpm test     # 168 pass, 2 skip
pnpm db:migrate                                 # from an empty database
```

Without `DATABASE_URL` the suite still passes (131 pass, 39 skip) — the engine runs
at upload centres with the link down and must never need a database.

---

## 1. Done

### 1.1 Ingest engine — the measurement

| ID | Requirement | Checked by |
|---|---|---|
| PLT-09 | Raw duration from stream timestamps, never the manifest | `slice3`, `timing-window` |
| UPL-08 | Manifest is advisory | `slice4` "B5 the manifest files block is never used" |
| UPL-09 | Media resolved by directory scan | `MANIFEST-FILES-UNRESOLVED` on all five samples |
| UPL-10 | `status: recording` / zeroed stats ingested and flagged, not discarded | `slice4`, `hardening` |
| UPL-11 | Multi-part assembled in timestamp order | `slice4` B13, B14, B15 |
| UPL-12 | Zero-byte / missing PTS recovered from container or IMU | `slice2` 072538 |
| UPL-13 | Calibration travels with the episode | `CALIB-MISSING` quarantine |
| UPL-14 | Microsecond PTS, usable extent is the INTERSECTION not the union | `timing-window` |
| UPL-15 | Same session by two paths resolves to one episode | `store.test` duplicate case |
| UPL-16 | Idempotent, interrupted imports resume | `slice4` B25, hash cache |
| UPL-18 | IMU rate anomaly flagged | `IMU-RATE-ANOMALY` |

30-code defect taxonomy, all reachable from committed fixtures.

### 1.2 Identity — episode ID and content fingerprint

- `episode_id`: UUID v8 over `playerone:episode:v1:{SERIAL}:{YYYYMMDD}T{HHMMSS}`. Derived
  from the directory basename and nothing else, so a card at the counter and a cloud
  re-download are one episode and one payment.
- `content_fingerprint`: sha256 over `{path}\n{sha256}\n` per file, byte-sorted, manifest
  excluded. **A column, never a key** — an id that moved when the bytes moved would hide
  the corruption `CHECKSUM-MISMATCH` exists to surface.
- Record schema **1.1.0** carries `source_files`, so `contentFingerprint(record.source_files)
  === record.content_fingerprint` holds from the document alone, with no store access.

Checked by `record-contract.test.ts` over every fixture and real session.

### 1.3 Episode store — migration `0000_init`

`episodes`, `episode_ingests` (append-only, one row per run), `episode_files`,
`episode_streams`, `episode_defects`. Files/streams/defects hang off an *ingest*, never an
episode, because two deliveries of one session can legitimately differ and both must
survive. Re-ingest resolves to new / duplicate / mismatch.

### 1.4 Identity spine — migration `0001_identity_spine`

19 tables giving every recording an owner (`grep -c '^CREATE TABLE'
packages/store/drizzle/0001_identity_spine.sql`). `tasks`, `collectors`, `device_types`,
`devices`, `scenarios`, `collection_points` (§6.15 in full), `collection_point_alt_centres`,
`collection_sessions`, `collection_session_devices`, `upload_centres`, `upload_devices`,
`operators`, `handovers`, `upload_batches`, `defect_codes`, `review_reason_codes`,
`episode_reviews`, `episode_review_reasons`, `settlements`.

Rules live in the schema, not in TypeScript, and are tested in raw SQL with no
application in the path (`spine.test.ts`, 21 tests):

| ID | Enforced as |
|---|---|
| PLT-04 | Every episode joins to task, collector, device, scenario, upload path, review, settlement |
| PLT-05 | CHECK — `resolved` requires a session, `quarantined` forbids one, no third state is spellable |
| QR-03 | CHECK — `effective <= measured`, made possible by a composite FK on `(episode_id, ingest_id, measured_duration_s)` |
| SET-02 | Structural — `settlements` has no FK to episodes, ingests or batches; the only route is through a review |
| UPL-06 | CHECK — local cache cannot be cleaned before cloud verification |
| UPL-07 | Schema present; join from episode to centre/machine/batch/handover tested |
| P2-01 | Devices on a join table; phase 1 is one droppable unique index |
| P2-02 | `episode_streams.stream_name` is text with no CHECK — already satisfied, unchanged |
| P2-03 | `device_types` is an entity, not a string on the device |

Defect routing is a catalogue with two independent flags (`blocks_review`,
`suppresses_settlement`). A test asserts every code in the TypeScript union has a row, so
a new code cannot default to "reaches review" by accident. Review reasons localised
`vi` + `zh` (LOC-04, LOC-02).

### 1.5 Corrections made this session

- **Payable window** was three scalars; five payout faults found in review. Now interval
  arithmetic: gaps unioned and clipped, a container length can bound a window but never
  create one, and a cut sidecar's end is measured from its own media rather than borrowed
  from another stream. Properties tested over 600 seeded random stream sets.
- **CSV parser** 31 → 84 MB/s; bench 73 → 230–326 MB/s against a 150 MB/s gate. The gate
  was measuring the timestamp reader, not SHA-256.
- **`probeContainer`** treated a missing ffprobe as a damaged container, so an upload
  centre without ffmpeg would silently mis-measure every session. Now a named error.
- **CI** installs ffmpeg (six tests fail without it) and raises the test timeout.

---

## 2. Not done

| Area | IDs | State |
|---|---|---|
| Resolver + operator API | UPL-03, UPL-07 (runtime) | **Next.** Schema ready; nothing writes to it |
| Cloud upload and verification | UPL-04, UPL-05, UPL-06 (runtime) | Blocked on a storage target |
| Operator console | BO-09, BO-10 | First UI worth building; needs the API first |
| Review lane | QR-01…08, BO-05, BO-06 | The KPI bottleneck at 40,000 h |
| Settlement | SET-01…10 | Tables and FK path only, no logic |
| Collector app | all APP-* | **Blocked on PaXini** — D1, D5 |
| Path A | UPL-01 | **Blocked on PaXini** — D1, D5 |
| Path B | UPL-02 | Blocked on D2; P1 anyway |
| Compression | PLT-13 | P2 by VNG scoping; PaXini asked for it directly |

---

## 3. Suggested order

**1. Operator API + resolver.** Create handover → create batch → bind card → attach
episodes to a session; raise `SESSION-CONFLICT` when the device's declared session id
disagrees with the counter's record. Turns today's `quarantined / no owner` into
`resolved`. Everything downstream is a join that currently returns nothing.

**2. Upload and verification** (UPL-04/05/06). Multipart with resume, cloud-side checksum,
cache-cleanup gate. Makes QR-02 ("no review before cloud checksum") true rather than
aspirational. Needs the storage decision below.

**3. Operator console** (BO-09/BO-10). Thin: create handover, scan card, start import,
watch status, see exceptions. An upload-centre operator cannot use a CLI. This completes
Path C end to end and is the first screen that earns its place.

**4. Review lane** (QR-01/02/03, BO-05/06) then settlement generation (SET-01…05).
Reviewer ergonomics is a throughput problem: every second per episode multiplies by tens
of thousands. Pre-triage on the existing taxonomy so blocking defects never reach a human.

**No testing UI.** The CLI (`pnpm ingest <dir> --store`, `--list`, `--show`) already covers
verification and is how the work above was checked. A throwaway UI is work you delete.

---

## 4. Blocked on someone else

| What | Who | Why it matters |
|---|---|---|
| **D1** device↔phone Wi-Fi protocol | PaXini | Blocks the entire Path A flow. Promised, not received |
| **D5** device SDK and documentation | PaXini | Blocks "everything". Promised 13 Aug, not received |
| **Storage target** for PLT-01 | VNG | Endpoint, bucket, credentials. Step 2 cannot start without it |
| **Sample sessions 072415, 073055** | Alois | See §5 |
| **CALIB-MISSING routing** | Product owner | Seeded `blocks_review = false`; either answer is one UPDATE |
| **§11.2 site verification** | Ops | Not software, but an unverified site must not receive tasks |

---

## 5. Known problem with the local corpus

The brief's §5.3.5 says the five sample sessions carry 40 / 39 / 41 / 86 / 458 MB. This
machine has **0 MB for 072415 and 0.3 MB for 073055**.

Both `EgoCamera Sample Data*.zip` in `Downloads` are **truncated downloads** — no
end-of-central-directory record — and a raw scan of the larger one shows it only ever
contained four sessions with 073055 at two files. The extracted corpus faithfully matches
the archive; nothing was lost locally. The media is not on this machine and is not in
`huggingface.co/datasets/paxini/Omnisharing_DB_SampleData` (that is PaXini's glove and
tactile HDF5 dataset, a different product).

Consequence: **acceptance 10.3.9 cannot be fully run here.** Two of the five sessions
currently quarantine for `MEDIA-MISSING`, correctly, but for the wrong reason. Re-obtain
the archive from Alois and re-run before quoting a quarantine rate.

Also: the engineering brief itself is not in this repo. It lives at
`~/Downloads/Player One — Engineering Brief v1.0.md`.

---

## 6. Decisions taken, so they are not re-litigated

- **Session creation.** The collector app binds the session before recording (APP-16); the
  operator creates the handover record when the card arrives (BO-10). Different objects,
  different moments. For the pilot the operator also creates the session, stamped
  `session_origin = 'handover'`, so the drift is measurable when the app lands.
- **No UNIQUE on `content_fingerprint`.** Two different empty sessions share
  `e3b0c442…b855`, the sha256 of nothing, and 072415 is one of them. A unique index would
  reject the second and lose a real episode (ING-17).
- **`episode_streams` unchanged.** Keyed on `ingest_id` (per delivery) and already an open
  set, so P2-02 is satisfied without a migration.
- **Review carries `measured_duration_s`** under a composite FK. A CHECK cannot reach into
  another table, and this binds a verdict to the exact delivery it judged.
- **Privacy handled by legal, collectors wear masks.** Not an engineering concern here
  beyond capturing the two APP-17b flags on the session.
