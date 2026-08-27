import { deriveEpisodeId, type EpisodeRecord } from '@playerone/contracts';

/**
 * One measured episode, as the ingest engine would have written it.
 *
 * Shared by the review-lane tests and the reviewer-role tests because it is the
 * money path's input: a second copy of it would let one file's idea of "a
 * hundred seconds of footage" drift from the other's, and the number a
 * collector is paid on is derived from exactly these fields.
 */
export const FIXTURE_T = Date.parse('2026-08-21T09:00:00.000Z');

export function episodeRecord(opts: {
  basename?: string;
  measured?: number;
  declared?: number | null;
  serial?: string;
}): EpisodeRecord {
  const measured = opts.measured ?? 100;
  const serial = opts.serial ?? 'AZER76400FE';
  const T = FIXTURE_T;
  const path = opts.basename ?? `ego_${serial}_20260813_${String(Math.random()).slice(2, 8)}`;
  return {
    schema_version: '1.1.0',
    // The submit route re-derives this from the basename and refuses anything else.
    episode_id: deriveEpisodeId(path),
    content_fingerprint: 'a'.repeat(64),
    state: 'ok',
    source: {
      path,
      ingest_tool_version: '0.3.1',
      ingested_at: new Date().toISOString(),
      ingest_host: 'test',
    },
    device: { serial, firmware_declared: '1.0.3', calibration_serial: null },
    declared:
      opts.declared === undefined
        ? null
        : {
            session_id: null,
            status: 'completed',
            duration_sec: opts.declared,
            start_time: null,
            end_time: null,
            video_left_frame_count: null,
            video_right_frame_count: null,
            imu_accel_count: null,
            imu_gyro_count: null,
            audio_frame_count: null,
          },
    streams: [
      {
        role: 'camera_left',
        parts: [{ file: 'left_part0001.mp4', bytes: 64, sha256: 'b'.repeat(64) }],
        pts_source: 'sidecar',
        first_pts_us: String(T * 1000),
        last_pts_us: String((T + measured * 1000) * 1000),
        sample_count: 300,
        span_s: measured,
        nominal_rate_hz: 30,
      },
    ],
    timing: {
      method: 'pts_sidecar',
      confidence: 'exact',
      usable_start_us: String(T * 1000),
      usable_end_us: String((T + measured * 1000) * 1000),
      raw_duration_s: measured,
      max_stream_skew_ms: 0,
    },
    calibration: { present: true, files: [] },
    source_files: [],
    discrepancies: [],
    unclassified_files: [],
  };
}
