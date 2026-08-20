import { hostname } from 'node:os';
import { basename } from 'node:path';
import { EpisodeRecord } from '@playerone/contracts';
import { classify } from './classify.ts';
import { readCalibration } from './calibration.ts';
import { discover } from './discover.ts';
import { contentFingerprint, episodeIdFrom, openHashCache } from './hash.ts';
import { readManifest } from './manifest.ts';
import { computeTiming, readStreams } from './timing.ts';

export const INGEST_TOOL_VERSION = '0.3.1';

export class UnsupportedLayoutError extends Error {}

/**
 * One session directory in, one validated EpisodeRecord out. Nothing is written
 * to the source (ING-34) and nothing is ever discarded (ING-17): a session that
 * cannot be trusted comes back quarantined, with reasons.
 */
export async function ingest(dir: string): Promise<EpisodeRecord> {
  const discovery = await discover(dir);
  // A directory holding another product, or a batch of them, is the wrong tool
  // for the job and says so. An empty session directory is a different thing:
  // it is an episode with nothing in it, so it quarantines and is kept (ING-17).
  if (discovery.layout === 'paxini_episode' || discovery.layout === 'nested') {
    throw new UnsupportedLayoutError(
      `${basename(dir)} is not a session directory (layout: ${discovery.layout})`,
    );
  }

  const onDisk = new Set(discovery.entries.map((e) => e.file).concat(discovery.unclassified));
  const manifest = await readManifest(
    discovery.entries.find((e) => e.kind === 'manifest')?.path ?? null,
    onDisk,
  );
  const calibration = await readCalibration(discovery.entries);
  const streams = await readStreams(discovery.entries);
  const timing = computeTiming(streams, manifest.declared);
  const { discrepancies, state } = classify({
    discovery,
    manifest,
    calibration,
    streams,
    timing,
  });

  const cache = await openHashCache();
  const hashOf = (e: { path: string; bytes: number; mtimeMs: number }) =>
    cache.hash(e.path, e.bytes, e.mtimeMs);

  const recordedStreams = [];
  for (const s of streams) {
    const parts = [];
    for (const p of s.parts) {
      parts.push({ file: p.file, bytes: p.bytes, sha256: await hashOf(p) });
    }
    recordedStreams.push({
      role: s.role,
      parts,
      pts_source: s.source,
      first_pts_us: s.firstUs === null ? null : String(s.firstUs),
      last_pts_us: s.lastUs === null ? null : String(s.lastUs),
      sample_count: s.sampleCount,
      span_s: s.spanUs === null ? 0 : Number(s.spanUs) / 1e6,
      nominal_rate_hz:
        s.medianDeltaUs && s.medianDeltaUs > 0n ? 1e6 / Number(s.medianDeltaUs) : null,
    });
  }

  const calibrationFiles = [];
  for (const f of [calibration.camera, calibration.imu]) {
    if (f) calibrationFiles.push({ file: f.file, bytes: f.bytes, sha256: await hashOf(f) });
  }

  // ING-30: identity comes only from what the content decides, so the same
  // session delivered by two different paths resolves to one episode.
  const serial = discovery.deviceSerial ?? manifest.deviceSerial ?? 'unknown';
  const fingerprint = contentFingerprint(
    serial,
    discovery.sessionTimestamp ?? manifest.declared.start_time ?? '',
    recordedStreams.flatMap((s) => s.parts.map((p) => p.sha256)),
  );

  return EpisodeRecord.parse({
    schema_version: '1.0.0',
    episode_id: episodeIdFrom(fingerprint),
    content_fingerprint: fingerprint,
    state,
    source: {
      path: basename(dir),
      ingest_tool_version: INGEST_TOOL_VERSION,
      ingested_at: new Date().toISOString(),
      ingest_host: hostname(),
    },
    device: {
      serial,
      firmware_declared: manifest.firmwareVersion,
      calibration_serial: calibration.serial,
    },
    declared: manifest.parsed ? manifest.declared : null,
    streams: recordedStreams,
    timing: {
      method: timing.method,
      confidence: timing.confidence,
      usable_start_us: timing.usableStartUs === null ? null : String(timing.usableStartUs),
      usable_end_us: timing.usableEndUs === null ? null : String(timing.usableEndUs),
      raw_duration_s: timing.rawDurationS,
      max_stream_skew_ms: timing.maxStreamSkewMs,
    },
    calibration: {
      present: calibration.present,
      files: calibrationFiles,
    },
    discrepancies,
    unclassified_files: discovery.unclassified,
  });
}
