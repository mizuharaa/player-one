# Ego device checkout — 19-test acceptance protocol

For the PaXini Ego head-worn camera, before a unit joins the pilot fleet and
again whenever a unit comes back from a collector. One section per test:
purpose, the exact command, what a pass looks like, and a blank for the result.

**【HANDS】 marks a step a human must physically do** — press a button, wear the
unit, pull the cable, remove the card. Everything else runs from a terminal.

**Evidence policy.** A result marked ✅ was produced by a command re-run while
writing this document. A result marked 📋 is a transcript record from an earlier
session that could **not** be re-run — the bench unit was not attached — so it is
retained as a record, not as a verified result; re-run it before acceptance.
⚠️ marks a claim deliberately narrowed to what was actually observed. Full unit
serials are not printed here; keep them in the local `probe.py --json` output.

Two scripts back this document, both plain Python 3.11 with no third-party
imports and no database:

| script | what it does |
| --- | --- |
| `packages/hardware-checkout/probe.py` | ctypes against `OrbbecSDK.dll`; dumps the connected device as JSON |
| `packages/hardware-checkout/corpus_check.py` | four analysers over a directory of session folders |

## Before you start

Extract the SDK once. The kit and the extracted tree are both gitignored.

```bash
python - <<'EOF'
import zipfile, io
z = zipfile.ZipFile('docs/sdks/开发工具包.zip')
n = [i for i in z.namelist() if 'OrbbecSDK_v2.9.0' in i][0]
open('tools/orbbec_sdk.zip', 'wb').write(z.read(n))
EOF
python -c "import zipfile; zipfile.ZipFile('tools/orbbec_sdk.zip').extractall('tools/orbbec')"
```

`probe.py` then finds `tools/orbbec/bin/OrbbecSDK.dll` with no arguments;
`--sdk-bin DIR` overrides it. Running any Orbbec binary drops a `Log/`
directory in the working directory — gitignored, delete it freely.

`corpus_check.py` takes a sessions directory, `--json` for a machine-readable
report, `--packets` to count MP4 packets with `ffprobe` (a second full read of
every video, so it is opt-in), and `--check` to assert the reference numbers and
print PASS/FAIL. `--check` implies `--packets`. `--selftest` runs the built-in
assertions and needs no corpus and no device — it covers the cases the reference
corpus cannot show, chiefly a camera sidecar whose MP4 is absent.

Exit codes, `probe.py`: 0 ok, 1 the DLL would not load, 2 an SDK call failed,
3 the SDK loaded and found no device. `corpus_check.py`: 0 ok, 1 no corpus or a
failed expectation, 2 bad arguments.

---

## A. Unboxing and power

### 1. Physical inventory and labels

**Purpose.** Every unit that enters the fleet has a readable serial on the
case, and the serial matches what the firmware reports (test 17 closes the
loop).

**【HANDS】** Unbox. Photograph the case label. Record the serial, the USB-C
cable type, the TF card capacity, and the head strap condition.

**Command.** None.

**Expected.** Serial matches the `AZER764xxxxx` scheme. TF card seated and its
capacity noted.

**Result.** ______________________________________________

### 2. Charge and power-on, LED states

**Purpose.** The front LED is the only status channel the collector has. It has
to be unambiguous before a unit goes out.

**【HANDS】** Charge to full. Press and hold power. Watch the front panel.

**Command.** None.

**Expected.** Per the vendor's firmware document (appendix): solid **green** =
ready, blinking **green** = still connecting, solid **blue-white** = USB
factory/upgrade mode. Anything else is a fail and the LED map has to be
re-asked of PaXini.

**Result.** ______________________________________________

### 3. Button map

**Purpose.** Write down what each button does on THIS firmware, because
volume-plus is also the upgrade-mode key (appendix step 1) and a collector must
never enter that mode by accident.

**【HANDS】** Press each button short and long. Note the effect.

**Command.** None.

**Expected.** Volume-plus held during USB plug-in enters upgrade mode
(blue-white LED). Volume-plus alone during normal operation does NOT.

**Result.** ______________________________________________

### 4. Battery runtime under continuous record

**Purpose.** A collector session budget depends on it, and the brief targets
40,000 hours across the fleet.

**【HANDS】** From full charge, start a recording and leave it. Note the wall
clock at start and at shutdown.

**Command.** Afterwards, over the produced session:

```bash
python packages/hardware-checkout/corpus_check.py /path/to/sessions
```

**Expected.** Record the minutes. No expectation is asserted yet — this test
establishes the fleet baseline. The session must still close cleanly
(`status: completed`, nothing in the `== buffer` section; see test 10).

**Result.** ______________________________________________

### 5. Thermal after sustained record

**Purpose.** It sits on a head.

**【HANDS】** After test 4, touch the case near the camera bar and near the
battery. Note if it is uncomfortable to wear.

**Command.** None.

**Expected.** Wearable without discomfort for the whole runtime measured in
test 4.

**Result.** ______________________________________________

---

## B. Recording

### 6. A session starts, stops, and lands on the card

**Purpose.** The unit produces the directory shape the ingest engine expects:
`ego_<serial>_<YYYYMMDD>_<HHMMSS>/`. The episode id derives from that basename
and from nothing else.

**【HANDS】** Wear the unit. Start a recording, walk for two minutes, stop it
with the normal stop control (not by pulling power).

**Command.** With the card in a reader (test 13):

```bash
python packages/hardware-checkout/corpus_check.py /path/to/card/sessions
```

**Expected.** One new `ego_<serial>_<date>_<time>` folder. `status` reads
`completed`. Ten files: five media/sidecar pairs plus the two calibration YAMLs
and `meta_*.json`.

**Result.** ______________________________________________

### 7. Stream completeness

**Purpose.** All five streams recorded: left colour, right colour, audio, IMU
accel, IMU gyro.

**Command.** Same run as test 6, `== truncation` table.

**Expected.** A row for `audio`, `camera_left` and `camera_right`, each with a
non-zero `rows`, and a non-zero `rows` figure in the `== gravity` table.

Note the manifest is advisory throughout. On the real corpus
`audio_frame_count` reads **0** on all five sessions while the audio PTS
sidecar holds 207–2891 rows. That is a manifest defect, not a stream defect,
which is why test 18 measures against the media and not against the manifest.

**Result.** ______________________________________________

### 8. Warm-up gap per stream

**Purpose.** The device claims a `start_time` before its sensors are actually
producing. The gap is real and consistent, and anything that pays on wall clock
would over-pay by it.

**Command.**

```bash
python packages/hardware-checkout/corpus_check.py /path/to/sessions
```

Read the `== warm-up` table.

**Expected.** IMU first sample **≈ +3.5 s** after the manifest `start_time`;
audio and both cameras **≈ +4.0 s**. Measured on the reference corpus
(2026-08-25):

| session | imu | audio | cam_l | cam_r |
| --- | --- | --- | --- | --- |
| 072310 | +3.527 | +4.019 | +4.031 | +4.031 |
| 072415 | +3.519 | +4.014 | +4.017 | +4.050 |
| 072516 | −1.528 † | +4.023 | +4.030 | +4.030 |
| 072538 | +3.521 | +4.013 | — | — |
| 073055 | +3.515 | +4.010 | +4.018 | +4.018 |

† Session 072516 opens with **916 IMU rows whose device clock is roughly 56
years ahead**, then snaps back. The analyser counts those rows, excludes them,
and measures from the first sane row — which lands 1.528 s *before* the
manifest `start_time`. Both numbers are pinned by `--check`. This is a device
defect to raise with PaXini, not a parser problem: a naive reader that trusts
row 0 reports a 1.77-billion-second warm-up.

**Result (reference corpus, re-run 2026-08-25).** ✅ 27/27 expectations pass
under `--check`, including the 072516 clock defect. Per unit: ____________

### 9. IMU gravity consistency

**Purpose.** A mis-scaled or mis-wired accelerometer is invisible in the video
and fatal to any downstream pose work.

**【HANDS】** During test 6, wear the unit normally — head upright, looking
forward.

**Command.** Same run, `== gravity` table.

**Expected.** `mean|a|`, the mean of the per-sample magnitudes, lands at
**9.87–10.0 m/s²**. The mean vector's sign signature is **−Y −Z** for
head-upright wear.

Reference corpus:

| session | rows | mean\|a\| | mean x, y, z | \|mean\| | sig |
| --- | --- | --- | --- | --- | --- |
| 072310 | 9240 | 9.998 | −0.414, −6.607, −2.073 | 6.937 | −Y−Z |
| 072415 | 10120 | 9.932 | −0.362, −7.079, −6.794 | 9.818 | −Y−Z |
| 072516 | 12640 | 9.914 | −0.097, −7.378, −6.538 | 9.858 | −Y−Z |
| 072538 | 21645 | 9.905 | −0.759, −5.559, −5.733 | 8.021 | −Y−Z |
| 073055 | 133880 | 9.870 | +0.221, −8.422, −4.869 | 9.731 | −Y−Z |

Read `mean|a|` for the gravity check and never `|mean|`. The magnitude of the
mean *vector* collapses when the head turns — 072310 reads 6.937 there for that
reason alone, with a perfectly healthy sensor. `|mean|` is reported as a
head-steadiness number only.

**Result (reference corpus, re-run 2026-08-25).** ✅ mean |a| 9.870–9.998
m/s² on all five sessions, −Y−Z on all five. Per unit: ____________

### 10. Abrupt stop leaves a *recognisably truncated* PTS sidecar

**Purpose.** This is how the fleet will fail in the field — a flat battery or a
yanked strap — and the resulting session must be *recognisable* as truncated
rather than silently short.

**【HANDS】** Start a recording. After about a minute, pull the battery or hold
power off hard. Do **not** stop normally.

**Command.**

```bash
python packages/hardware-checkout/corpus_check.py /path/to/sessions
```

Read the `== buffer` section.

**Expected — this is what pass/fail turns on.** Read the `== truncation`
section first: the interrupted session's streams must come back
`PTS-TRUNCATED`, i.e. **measured** loss — an unterminated final row, or fewer
PTS rows than the media has packets — and `status` stays `recording`. A cleanly
closed session must show no `PTS-TRUNCATED` stream.

The `== buffer` 4096-byte table is **corroborating telemetry, not the test**. A
4 KiB-multiple size on an interrupted sidecar supports the buffering story; its
absence does not clear the unit, and its presence on a clean session does not
condemn one. Do not fail a unit on a boundary hit alone, and do not pass one
that shows measured truncation without a boundary hit.

**The boundary hit is a signal, not a proof, and it is not proof of firmware
buffering specifically.** Any 4096-byte file trips it. The analyser therefore
tests **each sidecar file separately** — summing the parts of a multi-part
stream could land on a multiple by accident — and prints the corroborating
evidence next to every hit: an unterminated final row, a `status` that is not
`completed`, or a sidecar short of its media packet count. A hit with no
corroboration is reported as a coincidence. Where the write was actually lost —
device firmware, the filesystem, the card — is **unverified**.

On the reference corpus every hit is corroborated, and all six are in the two
interrupted sessions:

| session | stream | bytes |
| --- | --- | --- |
| 072538 | audio | 8192 |
| 072538 | camera_left | 0 |
| 072538 | camera_right | 0 |
| 073055 | audio | 49152 |
| 073055 | camera_left | 65536 |
| 073055 | camera_right | 65536 |

The three closed sessions have sizes 3532, 3872, 4365, 4705, 4790, 4807, 5334 —
none of them a multiple, and none of them corroborated by anything else.

**Result (reference corpus, re-run 2026-08-25).** ✅ Measured: every stream of
both interrupted sessions is `PTS-TRUNCATED`, no stream of the three closed
sessions is. Corroborating: six 4096-boundary hits, all six in the two
interrupted sessions and all six carrying other evidence; zero on the closed
ones — on this corpus the boundary signal happens to agree with the measurement
exactly, which is why it is easy to mistake for the test itself.
Per unit: ____________

---

## C. Host interface

### 11. USB enumeration on Windows — **observed once, not re-run**

**Purpose.** Establish what the host actually sees, and specifically whether
the TF card is reachable over USB.

**【HANDS】** Plug the unit into a PC with a USB-C cable, in normal mode (do
NOT hold volume-plus).

**Command.**

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'USB' } | Format-Table -Auto
```

**Expected / measured 2026-08-25.** In the one mode observed — normal power-on,
volume-plus not held, one unit, one card state — the unit enumerated as a **UVC
composite device**: left camera, right camera, audio, and an HID interface, with
**no mass-storage function present at that moment**.

**Scope of that claim.** This is a single observation, not a proof that the card
can never mount. It specifically does **not** hold in upgrade mode: the vendor's
own firmware document (appendix, step 2.3) instructs the operator to select the
Ego from the tool's device list as **"XXX: USB Mass Storage Device"**, so the
unit does expose mass storage when volume-plus is held during plug-in. Unknown
and untested: other firmware versions, an absent or unformatted card, a
different host OS, and the second unit.

What the pilot can rely on is only the narrow version: in normal recording mode
the operator cannot read the card over the cable, so the card-handover workflow
is the data path. Re-run this test per firmware version.

**Result.** ⚠️ Observed once: UVC composite (2× camera, audio, HID), no mass
storage in normal mode. Mass storage IS present in upgrade mode. Other modes
unverified.

### 12. SDK enumerates the device — **transcript record, not re-run**

**Purpose.** The OrbbecSDK sees the unit and reports an identity the platform
can key on.

**【HANDS】** Unit plugged in, normal mode, front LED solid green.

**Command.**

```bash
python packages/hardware-checkout/probe.py
```

**Expected.** Exit 0 and one device in the JSON. The values below are the
transcript record from earlier on 2026-08-25. **Re-running `probe.py` while
writing this document returned `{"devices": []}` and exit 3** — the SDK loads
and enumerates, the bench unit was simply not attached. So the DLL binding is
verified and the device values are not. Re-run before acceptance.

```json
{
  "devices": [
    {
      "name": "Orbbec Ego",
      "serial": "AZER764…HV",
      "firmware": "0.0.13",
      "hardware": "1.0.0",
      "connection": "USB2.0",
      "sensor_ids": [4, 5, 11, 12, 13],
      "sensors": ["ACCEL", "GYRO", "COLOR_LEFT", "COLOR_RIGHT", "AUDIO"]
    }
  ]
}
```

Sensor names come from the real `OBSensorType` enum in
`include/libobsensor/h/ObTypes.h`: `ACCEL = 4`, `GYRO = 5`, `COLOR_LEFT = 11`,
`COLOR_RIGHT = 12`, `AUDIO = 13`. The values are **not** contiguous with the v1
SDK's, and an off-by-one table reports GYRO/IR_LEFT/IR_RIGHT/COLOR_LEFT
instead — which is exactly what the throwaway probe from earlier in the session
printed. `probe.py` emits `sensor_ids` next to `sensors` for that reason: the
raw values are the evidence and the names are a lookup, so a stale table cannot
launder itself into the record. Do not retype the table from memory, and do not
cite `IR_LEFT` from any older output.

`connection: USB2.0` also matches what every manifest in the corpus records.

`hardware: 1.0.0` is transcript-only and has not been re-read.

**Result.** 📋 Orbbec Ego, SN `AZER764…HV`, fw 0.0.13, hw 1.0.0, USB2.0, sensor
ids `[4, 5, 11, 12, 13]` = ACCEL, GYRO, COLOR_LEFT, COLOR_RIGHT, AUDIO.
Not re-run; no device attached.

### 13. TF card removal and read

**Purpose.** The only path the recordings take. Rule 6 of the brief: **no code
path deletes TF-card source media and no TF card is ever cleared.** The card is
read, copied, and returned.

**【HANDS】** Power the unit off. Eject the TF card. Put it in a card reader on
the operator PC.

**Command.**

```bash
python packages/hardware-checkout/corpus_check.py /path/to/card/sessions
```

**Expected.** The card mounts read-write but is treated read-only. Every
session folder on it is listed. Nothing is deleted, moved, or formatted at any
point in this protocol.

**Result.** ______________________________________________

### 14. Bluetooth control library

**Purpose.** The kit ships `EgoLowBle-windows-x64-1.1.5.zip` and an Android
build. Confirm the unit advertises and pairs, so the collector app has a
control channel that does not need a cable.

**【HANDS】** Power the unit on, unplugged. Open Windows Bluetooth settings.

**Command.** None scripted — the library's own sample, per
`SDK&OrbbecViewer/windows/EgoLowBle 蓝牙库使用说明.md`.

**Expected.** The unit advertises. Record the advertised name and whether
pairing needs a PIN. **Not yet run.**

**Result.** ______________________________________________

---

## D. Firmware and identity

### 15. Firmware version baseline

**Purpose.** Record the firmware version and compare it to the pilot floor.

**⚠️ The floor itself is unsourced.** "≥ 0.0.9" was carried into this checkout
from a task brief and is **not** in the engineering brief, the PaXini PRDs, or
the kit's own documents as far as this checkout could find. Ask PaXini for the
minimum supported firmware and a capability list per version before treating any
number as a gate. Until then this test records a value and gates nothing.

**Command.**

```bash
python packages/hardware-checkout/probe.py | python -c "import json,sys; print(json.load(sys.stdin)['devices'][0]['firmware'])"
```

**Expected.** Record the value. Transcript record: **0.0.13** on the bench unit,
which is ≥ 0.0.9 if that floor turns out to be real.

The corpus manifests carry `device.firmware_version: "1.0.3"` for the recording
unit, against the SDK's `0.0.13` for the bench unit. **This is an inference, not
a measurement:** the two fields come from different producers (the manifest is
written by the recorder application, the other is read from the device by the
SDK) and use visibly different numbering, so comparing them is unsafe. Nobody
has read both fields off the *same* unit at the same time, which is the one
observation that would settle it. Do that on the next bench session.

**Result.** 📋 0.0.13 on the bench unit, not re-run. Floor unsourced. Manifest
`1.0.3` vs SDK `0.0.13` unresolved.

### 16. Firmware upgrade — **do not flash from this kit**

**Purpose.** Establish the upgrade path exists and is understood, without
running it.

**Command.** None. Read the appendix below.

**Expected / measured 2026-08-25.** The kit's `固件/ego_v0.0.12_update.bin` is
version **0.0.12** by its filename, against the **0.0.13** test 12 recorded for
the bench unit. On those two values flashing it is a downgrade. Both halves are
weak evidence — the version is read off a filename, and 0.0.13 is a transcript
value — so confirm the device version with `probe.py` before acting either way. **Do not run the upgrade tool with this
bin.** Ask PaXini for a bin ≥ 0.0.13 before any fleet flash, and re-run tests
12 and 15 after.

Two further mismatches in the kit worth raising with PaXini:

- The upgrade document names the firmware file `SstarUsbImage_202607041320.bin`;
  the file actually shipped is `ego_v0.0.12_update.bin`.
- The document says the tool's default `auto` mode "has a problem, being
  fixed", and instructs `Manual` mode. Treat `auto` as unavailable.

**Result.** ⚠️ Path understood, flash blocked: kit bin 0.0.12 is below the
0.0.13 recorded for the bench unit in test 12 (itself a transcript value).
Confirm the fielded version with a live `probe.py` run before deciding.

### 17. Serial-number scheme — **transcript record, sample of two**

**Purpose.** Serial is the device identity the platform keys equipment on. The
scheme has to be stable across units.

**Command.**

```bash
python packages/hardware-checkout/probe.py | python -c "import json,sys; print(json.load(sys.stdin)['devices'][0]['serial'])"
ls /path/to/sessions          # session folder names carry the recording unit's serial
```

**Expected / measured 2026-08-25.** Two units observed, same scheme:

| serial | seen as |
| --- | --- |
| `AZER764…FE` | the unit that recorded all five corpus sessions |
| `AZER764…HV` | the bench unit |

Eleven characters, shared `AZER764` prefix, then a fixed block and a
two-character suffix. Two units is a very small sample for a scheme claim; treat
"consistent" as "not contradicted yet".

The session directory name embeds the serial, which is why the episode id
derives from the basename: the folder name carries device, date and time, and no
content.

**On serials in this file.** The corpus unit's full serial is already written
throughout the repository — it is inside every sample session directory name, in
`CLAUDE.md`, and in test fixtures — so masking it only here would be theatre;
whether the repository as a whole should carry it is a question for Daniel, not
one this document can settle. The bench unit's serial is new with this checkout
and is masked. Full values stay in local `probe.py --json` output.

**Result.** ⚠️ Two units, scheme not contradicted. Sample of two.

---

## E. Data integrity

### 18. PTS sidecar vs media vs manifest

**Purpose.** Tell a real index truncation apart from a manifest that lies. They
look identical if you only compare the sidecar to the manifest, and they mean
opposite things: one is lost data, the other is a field nobody should have
trusted.

**Command.**

```bash
python packages/hardware-checkout/corpus_check.py /path/to/sessions --packets
```

Read the `== truncation` table. `--packets` adds the `ffprobe` packet count,
which is the only reference the sidecar can actually be measured against.

**Expected.** On a cleanly closed session, **PTS rows == MP4 packets exactly**,
and the manifest may still disagree. Verdicts use the engine's own codes from
`packages/contracts/src/episode.ts`:

- `OK` — sidecar matches the media and the manifest.
- `FRAMECOUNT-MISMATCH` — sidecar matches the media, manifest does not. The
  manifest is wrong. Not a data loss.
- `PTS-TRUNCATED` — sidecar is short of the media, or stops mid-digit. Real
  index loss.
- `TAIL-OK` — audio only. A WAV gives no packet count, so only the tail is
  evidence. It is not a clean bill of health.
- `UNMEASURED` — a camera stream with no packet count taken. Re-run with
  `--packets`. A camera is never given a verdict it did not earn.
- `MEDIA-MISSING` / `MEDIA-UNREADABLE` — a camera part has no usable MP4, so
  its sidecar cannot be checked for truncation at all. This is a **failure in
  its own right**: with no packet reference, a half-length sidecar would
  otherwise read as healthy, which is exactly backwards. Every camera part must
  produce its own packet count; a multi-part stream missing one file fails.

Reference corpus, measured 2026-08-25:

| session | stream | pts rows | cut tail | mp4 packets | manifest | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 072310 | camera_left | 256 | no | 256 | 260 | FRAMECOUNT-MISMATCH |
| 072310 | camera_right | 256 | no | 256 | 263 | FRAMECOUNT-MISMATCH |
| 072415 | camera_left | 282 | no | 282 | 286 | FRAMECOUNT-MISMATCH |
| 072415 | camera_right | 281 | no | 281 | 288 | FRAMECOUNT-MISMATCH |
| 072516 | camera_left | 313 | no | 313 | 316 | FRAMECOUNT-MISMATCH |
| 072516 | camera_right | 313 | no | 313 | 318 | FRAMECOUNT-MISMATCH |
| 072538 | camera_left | 0 | — | 630 | 316 | PTS-TRUNCATED |
| 072538 | camera_right | 0 | — | 630 | 318 | PTS-TRUNCATED |
| 072538 | audio | 481 | yes | — | 0 | PTS-TRUNCATED |
| 073055 | camera_left | 3854 | yes | 3990 | 0 | PTS-TRUNCATED |
| 073055 | camera_right | 3854 | yes | 3990 | 0 | PTS-TRUNCATED |
| 073055 | audio | 2890 | yes | — | 0 | PTS-TRUNCATED |

**No closed session in the corpus has lost a single PTS row.** The earlier
reading of 072310 as "256 rows against 260 frames, therefore truncated" was
wrong: the media has 256 packets too. Only the manifest says 260, and 072310's
sidecar ends with a clean newline. `--check` pins both halves of that.

Row counting drops a final line with no newline, exactly as
`packages/ingest/src/csv.ts` does. Counting the stub inflates 073055 from 3854
to 3855 and hides the fact that the file was cut mid-value.

Two further manifest defects visible in the same table: 072538 claims 316/318
frames while both its camera sidecars are 0 bytes (stale statistics copied from
the previous session), and 073055's statistics read all zeros for a 195 MB
recording.

**Result (reference corpus, re-run 2026-08-25).** ✅ closed sessions: PTS rows
== MP4 packets on 6/6 camera streams, manifest wrong on 6/6. Interrupted
sessions: PTS-TRUNCATED on 6/6 streams. Per unit: ____________

### 19. MP4 layout and container integrity — **re-run 2026-08-25**

**Purpose.** A review UI must seek in a 195 MB clip without downloading it
whole. That needs `moov` before `mdat`. The same walk also proves whether the
file is a whole MP4 at all.

**Command.**

```bash
node packages/api/scripts/moov.ts /path/to/sessions/*/*.mp4
```

Exit 0 only if every file is `FRONT`; exit 1 on `BACK`, `NO MOOV`, `NO MDAT`,
`DAMAGED` or unreadable. Before this checkout the script printed those warnings
and still exited 0, so it certified files it had just declared unreadable;
`packages/api/test/moov.test.ts` now pins each case with a synthetic fixture.

**Expected / measured 2026-08-25.**

`moov` is the **second box, immediately after `ftyp`, on all 10 corpus MP4s.**
They are fragmented MP4 — `moof` + `mdat` — so the index is at the front and no
remux (`-movflags +faststart`) is needed at ingest.

Box order, cleanly closed sessions:
`ftyp, moov, sidx, free, moof, free, mdat, …` and the boxes tile the file
exactly.

Box order, the two interrupted sessions (072538, 073055):
`ftyp, moov, free, moof, free, mdat, …` — no `sidx`. The segment index is
written at close, so an interrupted recording has none.

**3 of the 10 files are `DAMAGED`**: `072538_camera_right`,
`073055_camera_left` and `073055_camera_right` have a final box declaring more
bytes than the file has left, so the top-level boxes do not tile. That is what
an interrupted capture looks like from the container side, and it is the reason
the gate had to stop exiting 0. `072538_camera_left` tiles and reads `FRONT`.

**Scope of the seek claim.** Front `moov` is a necessary condition for cheap
seeking, not a proof of it. Nobody has yet issued a byte-range request against
one of these files through the review lane and measured how many round trips a
seek costs — the fragmented layout means a player without `sidx` walks
fragments. The gate prints `FRONT — index ahead of the media; seek cost
unverified` for exactly this reason. Treat "one small range request" as the
expected case, unverified,
and measure it when the review lane serves real footage.

**Result.** ✅ moov front on 10/10, fragmented, no remux needed.
⚠️ 3/10 containers damaged (both interrupted sessions). Seek cost unverified.

---

## Appendix — firmware upgrade SOP

English translation of `开发工具包/固件/升级文档.docx` ("Upgrade Document"),
which ships inside the PaXini kit zip. The Chinese original is authoritative;
this is a working translation. Screenshots in the original are not reproduced.

> **Read test 16 first.** The bin shipped in this kit is a downgrade for a
> fielded unit. This appendix records the procedure; it is not an instruction
> to run it.

### 1. Upgrade manifest

1. **Upgrade tool:** `usb_factory_tool.zip`
   - 1.1 `exe` — the tool
   - 1.2 `doc` — the upgrade document
2. **Firmware:** `SstarUsbImage_202607041320.bin`
   *(the kit actually ships `ego_v0.0.12_update.bin`; see test 16)*

### 2. Upgrade procedure

**Step 1 — hardware connection.** 【HANDS】 Press and **hold volume-plus** as
shown in the figure, and connect the Ego to the PC with a USB cable while
holding it.

A **solid blue-white indicator** appears on the front panel, meaning the PC has
recognised the device correctly and the upgrade can proceed. Volume-plus may be
released at that point.

Open the upgrade tool `USB_Factory_Tool_64_xxx.exe`. With the Ego attached, the
interface displays normally.

**Step 2 — run the upgrade.**

1. Select mode **`Manual`**. *(Note in the original: the default `auto` mode has
   a problem and is being fixed.)*
2. Select the `.bin` firmware to flash.
3. Select the Ego device, listed as **"XXX: USB Mass Storage Device"**.
4. Click start.
5. The upgrade runs.
6. It completes in roughly **one minute**. Click the confirmation dialog and
   exit the upgrade tool.
7. 【HANDS】 **Unplug and re-plug the Ego** — it will not work normally until
   you do.

### 3. Verify streaming

After re-plugging, wait for the front indicator to go **solid green**. A
**blinking green** light means it is still connecting. Run `EgoViewer_xxx` and
confirm the image streams.

Follow with tests 12 and 15 of this protocol to confirm the reported firmware
version actually changed.
