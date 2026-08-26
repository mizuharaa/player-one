# Media analysers — what is real, what is a reference, what production needs

These modules feed the CONT.* and PROV.* signals of the risk engine
(`packages/api/src/risk`). Two of them wrap analysers the hardware checkout
already trusts; the rest are reference implementations proven on synthetic
input. Every signal states which it is here, so nobody mistakes a reference
implementation for a detector that has been measured against real footage.

Rule for all of them: a missing or failing tool is recorded in the
`META.EVALUATED` row's `tools` field and produces **no flag**. A broken
analyser is never a verdict on the footage (the same rule `corpus_check.py`
applies to a missing `ffprobe`).

## Wrapped, not rewritten

| module | wraps | signals |
| --- | --- | --- |
| `corpus-check.ts` | `packages/hardware-checkout/corpus_check.py --json --packets` | CONT.TIMING_TRUNCATED (verdict `PTS-TRUNCATED`), CONT.TIMING_PACKET_DELTA (verdict `MEDIA-TRUNCATED`), CONT.IMU_CLOCK_DRIFT (`imu.clock_outlier_rows`) |
| `moov.ts` | `packages/api/scripts/moov.ts` | CONT.MOOV_DAMAGED (any verdict but `FRONT`), and the box order for PROV.ENCODER_MISMATCH |

Both run the script as the CLI it is and read its output back. The session
folder is linked into a scratch directory so a per-episode evaluation does
not re-probe every session under the media root.

## Reference implementations (synthetic input only)

All of these work on **64×64 grey frames sampled at 1 fps** by one `ffmpeg`
pass (`frames.ts`). That is enough to prove the signal fires on the abuse it
targets and stays quiet on a clean synthetic clip, and it is deliberately
cheap: a two-hour episode is 7,200 frames of 4 KiB. It is **not** a
measurement against real Ego footage — nobody has run these over the corpus
in `docs/sample_data/` yet, and the thresholds in the catalogue (`params` on
each `risk_signals` row) are set from the synthetic clips, not from the fleet.

### CONT.STATIC_SCENE — `frames.ts` `motion`
Mean absolute difference between consecutive 3×3-blurred frames.
*Production:* real optical flow (ffmpeg `mestimate`, or OpenCV Farneback)
at native resolution, and a threshold calibrated on the corpus: a collector
sitting at a desk is low-motion and legitimate, so the edge must be set from
the distribution of real days, not from a synthetic clip.

### CONT.LOW_LUMA_VARIANCE — `frames.ts` `meanLuma`, `std`
Share of frames below a brightness edge or below a flatness edge.
*Production:* the same measures at native resolution; add per-region
statistics so a half-covered lens is caught.

### CONT.NEAR_DUPLICATE — `frames.ts` `aHash`, `content.ts` `frameMatch`
Average hash per sampled frame (8×8 block means), stored on every evaluated
episode as a zero-point CONT.FINGERPRINT row, compared at ±10 s offsets
against episodes of similar length. Exact `content_fingerprint` and shared
media-file digests are checked first and need no media.
*Production:* a perceptual hash robust to crop and re-encode (pHash/DCT or
a learned embedding), an index rather than a scan, and a comparison across
the whole store rather than the ±20% length window used here.

### PROV.PRNU_MISMATCH — `prnu.ts`
Sensor pattern noise: mean of `frame − blur3(frame)` over the clip,
zero-mean, unit-norm, correlated against an enrolled fingerprint.
**Enrolment is stubbed** (`noEnrolment`); the signal is evaluated only when
`PrnuEnrolmentSource.fingerprintFor(serial)` returns one, so in production
today it never fires.
*Production:* PRNU is a native-resolution, per-pixel property. Extract with a
wavelet denoiser (Mihcak) at full frame size, estimate K = Σ(W·I)/Σ(I²)
over ≥ 50 flat, evenly lit frames, correlate with peak-to-correlation
energy (PCE) rather than plain NCC, and account for the device's lens
distortion and any in-camera scaling. **Enrolment belongs in hardware
checkout** (`docs/hardware-checkout.md`, a new test after 19): record a
fingerprint per unit at intake and again on return, store it keyed by
serial, and hand it to the engine through `PrnuEnrolmentSource`. That is a
change to a package this engine may not edit — escalated in the handoff.

### PROV.IMU_VIDEO_DECORR — `imu.ts`
Pearson correlation between the per-second frame-motion series and the
per-second mean gyro magnitude, aligned on the camera's first frame.
*Production:* align on device PTS rather than on frame index (the warm-up
gap between IMU and camera is ~0.5 s and varies), use flow magnitude rather
than frame difference, and add a lag search of ±1 s.

### PROV.ENCODER_MISMATCH — `encoder.ts`
`ffprobe` codec/profile/encoder tag/GOP plus the moov gate's box order,
compared against a per-firmware profile in the signal's `params`. The v1
profile for firmware `1.0.3` is what `docs/hardware-checkout.md` test 19
measured: fragmented MP4, `ftyp moov …`. Encoder tag and GOP are `null`
(unchecked) because nobody has recorded them.
*Production:* record the tag, GOP and quantiser signature per firmware
during checkout (a `ffprobe -show_frames` over one known-good file per
firmware), and add a profile row per firmware as they ship.

### PROV.SCREEN_RECAPTURE — `recapture.ts`
Three cues: a persistent dark flat border, Nyquist-frequency energy relative
to the frame's residual (the moiré proxy), and frame-to-frame brightness
flicker. The border anchors; a hold needs the border plus one more cue.
*Production:* moiré is a native-resolution phenomenon that area-downscaling
removes, so measure the 2-D spectrum at full size; detect refresh banding
at the sensor's frame rate rather than at 1 fps; and treat the border as a
geometric fit (a quadrilateral that persists) rather than a ring statistic.

### PROV.SYNTHETIC_HEURISTIC — `frames.ts` `noiseFloor`
Median |frame − blur3(frame)| over the interior, per frame, clip median.
Generated footage tends to have no sensor noise; a camera always does.
Capped at `notice` by two CHECKs and the band function; never the sole
cause of a hold. *Production:* keep it weak. If a stronger synthetic
detector is ever wanted, it should be a provenance check (PRNU, C2PA
manifests when the device gains them), not a better appearance heuristic.

### CONT.AUDIO_ABSENT — `audio.ts`
`ffmpeg -af volumedetect` mean volume; below −60 dB is silence. The
no-stream and empty-stream cases come from the store and need no media.

## Test clips — `synth.ts`

Deterministic from a seed: a smooth scrolling texture, Gaussian sensor
noise, an optional per-unit fixed pattern (the PRNU stand-in), and a
device-shaped session folder (`ego_<serial>_<date>_<time>/…`) with manifest,
camera MP4 (fragmented, `moov` at the front, like the device), PTS sidecar,
WAV and IMU CSV. Every abuse in the brief's verify list is a knob:
`content: 'static' | 'dark' | 'recapture'`, `pts: 'short' | 'long' |
'partial'`, `imu: 'decorrelated' | 'clock_fault'`, `audio: 'silent' |
'none'`, `noise: 0`, `fragmented: false`, a different `pattern`.
