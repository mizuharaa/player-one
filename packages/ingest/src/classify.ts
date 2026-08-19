import type { Discrepancy, EpisodeRecord } from '@playerone/contracts';
import type { Discovery } from './discover.ts';
import type { CalibrationInfo } from './calibration.ts';
import type { ManifestInfo } from './manifest.ts';
import { hasClockFault, type StreamTiming, type Timing } from './timing.ts';

/**
 * The discrepancy taxonomy, and the state that follows from it.
 * Nothing here discards anything (ING-17): the worst outcome is quarantine.
 */

/** ING-Q4 is still open: 504 ms is observed and apparently normal, so this is a knob, not a truth. */
export const SKEW_THRESHOLD_MS = 1000;
/** ING-Q3 is still open. Every sample session is 1.0.3. */
export const KNOWN_FIRMWARE = ['1.0.3'];
/** ING-28 tolerance on the declared IMU rate. */
const RATE_TOLERANCE = 0.05;

type State = EpisodeRecord['state'];

export type ClassifyInput = {
  discovery: Discovery;
  manifest: ManifestInfo;
  calibration: CalibrationInfo;
  streams: StreamTiming[];
  timing: Timing;
};

export function classify(input: ClassifyInput): {
  discrepancies: Discrepancy[];
  state: State;
} {
  const { discovery, manifest: m, calibration, streams, timing } = input;
  const d: Discrepancy[] = [];
  const add = (code: Discrepancy['code'], severity: Discrepancy['severity'], detail: string) =>
    d.push({ code, severity, detail });

  // -- info: expected on every session -------------------------------------
  const declared = m.declared.duration_sec;
  if (declared !== null && timing.rawDurationS > 0 && declared > timing.rawDurationS) {
    add(
      'DUR-MANIFEST-INFLATED',
      'info',
      `declared ${declared.toFixed(3)} s vs measured ${timing.rawDurationS.toFixed(3)} s ` +
        `(${(declared / timing.rawDurationS).toFixed(2)}x)`,
    );
  }

  for (const [role, want] of [
    ['camera_left', m.declared.video_left_frame_count],
    ['camera_right', m.declared.video_right_frame_count],
    ['imu_accel', m.declared.imu_accel_count],
    ['imu_gyro', m.declared.imu_gyro_count],
  ] as const) {
    const got = streams.find((s) => s.role === role);
    if (want === null || want === 0 || !got || got.sampleCount === 0) continue;
    if (got.sampleCount !== want) {
      add('FRAMECOUNT-MISMATCH', 'info', `${role}: declared ${want}, measured ${got.sampleCount}`);
    }
  }

  const audio = streams.find((s) => s.role === 'audio');
  if (m.declared.audio_frame_count === 0 && audio && (audio.spanUs ?? 0n) > 0n) {
    add('AUDIO-STATS-ZERO', 'info', 'audio_frame_count is 0 with audio present');
  }

  if (m.unresolvedFiles.length > 0) {
    add(
      'MANIFEST-FILES-UNRESOLVED',
      'info',
      `${m.unresolvedFiles.length} names in the files block are not on disk, e.g. ${m.unresolvedFiles[0]}`,
    );
  }

  // -- flag ----------------------------------------------------------------
  if (m.parsed && (m.declared.status !== 'completed' || m.declared.end_time === null)) {
    add(
      'SESSION-UNCLOSED',
      'flag',
      `status ${m.declared.status ?? 'absent'}, end_time ${m.declared.end_time ?? 'absent'}`,
    );
  }

  if (
    m.parsed &&
    [
      m.declared.video_left_frame_count,
      m.declared.video_right_frame_count,
      m.declared.imu_accel_count,
      m.declared.imu_gyro_count,
    ].every((n) => n === 0)
  ) {
    add('STATS-ZEROED', 'flag', 'the statistics block is all zero with media present');
  }

  /**
   * Statistics that are plausible but belong to a different recording. A closed
   * session should agree with its own files; an unclosed one was never updated,
   * so 072538 carries 072516's numbers verbatim and they read as credible.
   */
  if (m.parsed && m.declared.status !== 'completed') {
    for (const [role, want] of [
      ['imu_accel', m.declared.imu_accel_count],
      ['imu_gyro', m.declared.imu_gyro_count],
    ] as const) {
      const got = streams.find((s) => s.role === role);
      if (!want || !got || got.sampleCount === 0) continue;
      if (Math.abs(got.sampleCount - want) / want > 0.05) {
        add('STATS-STALE', 'flag', `${role}: declared ${want} against a measured ${got.sampleCount}`);
        break;
      }
    }
  }

  for (const s of streams) {
    // A zero-byte sidecar and a missing one are different defects: one says the
    // device tried and wrote nothing, the other says it never tried.
    const sidecarOnDisk = discovery.entries.some((e) => e.kind === 'pts' && e.role === s.role);
    if (s.source === 'container') {
      add(
        sidecarOnDisk ? 'PTS-EMPTY' : 'PTS-ABSENT',
        'flag',
        `${s.role}: ${sidecarOnDisk ? 'the sidecar is empty' : 'there is no sidecar'}, read the container instead`,
      );
    }
    if (s.source === 'absent') {
      add('PTS-ABSENT', 'flag', `${s.role}: no sidecar and no readable container`);
    }
    if (s.truncatedTail) {
      add('PTS-TRUNCATED', 'flag', `${s.role}: the sidecar stops mid-line and the partial row was dropped`);
    }
    if (hasClockFault(s)) {
      add(
        'STREAM-CLOCK-FAULT',
        'flag',
        `${s.role}: spans ${(Number(s.spanUs) / 1e6).toFixed(0)} s on ${s.sampleCount} samples, ` +
          'excluded from the usable window',
      );
    }
  }

  if (timing.confidence !== 'exact') {
    add('TIMING-ESTIMATED', 'flag', `timing came from ${timing.method}, confidence ${timing.confidence}`);
  }

  if (timing.maxStreamSkewMs > SKEW_THRESHOLD_MS) {
    add('STREAM-SKEW-HIGH', 'flag', `${timing.maxStreamSkewMs.toFixed(0)} ms between stream starts`);
  }

  if (m.parsed && m.firmwareVersion !== null && !KNOWN_FIRMWARE.includes(m.firmwareVersion)) {
    add('FIRMWARE-UNKNOWN', 'flag', `firmware ${m.firmwareVersion} is outside the tested set`);
  }

  if (
    calibration.cameraNames.length > 0 &&
    m.cameraNames.length > 0 &&
    calibration.cameraNames.join() !== m.cameraNames.join()
  ) {
    add(
      'CAMERA-NAMING-CONFLICT',
      'flag',
      `manifest says ${m.cameraNames.join('/')}, calibration says ${calibration.cameraNames.join('/')}`,
    );
  }

  const imu = streams.find((s) => s.role === 'imu_accel');
  if (m.imuRateHz && imu?.medianDeltaUs && !hasClockFault(imu)) {
    const measured = 1e6 / Number(imu.medianDeltaUs);
    if (Math.abs(measured - m.imuRateHz) / m.imuRateHz > RATE_TOLERANCE) {
      add('IMU-RATE-ANOMALY', 'flag', `declared ${m.imuRateHz} Hz, measured ${measured.toFixed(1)} Hz`);
    }
  }

  d.push(...partDiscrepancies(streams, m));

  // -- quarantine ----------------------------------------------------------
  if (!calibration.present) {
    add(
      'CALIB-MISSING',
      'quarantine',
      `camera ${calibration.camera ? 'present' : 'MISSING'}, imu ${calibration.imu ? 'present' : 'MISSING'}`,
    );
  }

  const cameras = streams.filter((s) => s.role.startsWith('camera_'));
  if (cameras.length === 0) {
    add('MEDIA-MISSING', 'quarantine', 'no camera media found by directory scan');
  } else if (cameras.some((s) => s.source === 'absent')) {
    // One unreadable eye is enough. A stereo rig with a dead camera cannot be
    // reconstructed, which is the same argument that makes calibration mandatory.
    const broken = cameras.filter((s) => s.source === 'absent').map((s) => s.role);
    add('MEDIA-UNREADABLE', 'quarantine', `unreadable: ${broken.join(', ')}`);
  }

  return { discrepancies: d, state: stateFrom(d) };
}

/**
 * ING-18..21. Ordering is by PTS continuity with the part number as a tiebreak,
 * so a part numbered out of order is assembled correctly and flagged rather
 * than trusted. A gap is itemised; it never disappears into the duration.
 */
export function partDiscrepancies(streams: StreamTiming[], m: ManifestInfo): Discrepancy[] {
  const out: Discrepancy[] = [];

  for (const s of streams) {
    const numbers = s.parts.map((p) => p.partNumber).filter((n): n is number => n !== null);
    if (numbers.length > 1) {
      const sorted = [...numbers].sort((a, b) => a - b);
      const missing = [];
      for (let n = sorted[0]!; n < sorted[sorted.length - 1]!; n++) {
        if (!sorted.includes(n)) missing.push(n);
      }
      if (missing.length > 0) {
        out.push({
          code: 'PART-MISSING-INTERIOR',
          severity: 'quarantine',
          detail: `${s.role}: part ${missing.join(', ')} absent between ${sorted[0]} and ${sorted[sorted.length - 1]}`,
        });
      }
    }

    if (s.partTimings.length > 1) {
      const byPts = [...s.partTimings].sort((a, b) =>
        a.firstUs === b.firstUs ? (a.partNumber ?? 0) - (b.partNumber ?? 0) : a.firstUs < b.firstUs ? -1 : 1,
      );
      const byNumber = [...s.partTimings].sort((a, b) => (a.partNumber ?? 0) - (b.partNumber ?? 0));
      if (byPts.map((p) => p.partNumber).join() !== byNumber.map((p) => p.partNumber).join()) {
        out.push({
          code: 'PART-ORDER-CONFLICT',
          severity: 'flag',
          detail: `${s.role}: part numbers ${byNumber.map((p) => p.partNumber).join(',')} contradict PTS order ${byPts.map((p) => p.partNumber).join(',')}`,
        });
      }

      const step = s.medianDeltaUs ?? 0n;
      for (let i = 1; i < byPts.length; i++) {
        const gap = byPts[i]!.firstUs - byPts[i - 1]!.lastUs;
        if (step > 0n && gap > step) {
          out.push({
            code: 'PART-GAP',
            severity: 'flag',
            detail: `${s.role}: ${(Number(gap) / 1e6).toFixed(3)} s between part ${byPts[i - 1]!.partNumber} and part ${byPts[i]!.partNumber}`,
          });
        }
      }
    }

    // A part missing off the end flags rather than quarantines: the recording
    // simply stopped there, which is what an unclosed session looks like.
    const declaredSegments = Object.values(m.segmentCounts).find((n) => n > 0);
    const highest = Math.max(0, ...s.parts.map((p) => p.partNumber ?? 0));
    if (s.role.startsWith('camera_') && declaredSegments && highest > 0 && highest < declaredSegments) {
      out.push({
        code: 'PART-MISSING-TAIL',
        severity: 'flag',
        detail: `${s.role}: ${highest} parts on disk, manifest declares ${declaredSegments}`,
      });
    }
  }
  return out;
}

export function stateFrom(discrepancies: Discrepancy[]): State {
  if (discrepancies.some((x) => x.severity === 'quarantine')) return 'quarantined';
  if (discrepancies.some((x) => x.severity === 'flag')) return 'flagged';
  return 'ok';
}
