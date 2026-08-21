import { hostname } from 'node:os';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Discrepancy, EpisodeRecord } from '@playerone/contracts';
import {
  contentFingerprint,
  deriveEpisodeId,
  EpisodeRecord as EpisodeRecordSchema,
  parseSessionBasename,
} from '@playerone/contracts';
import { classify, stateFrom } from './classify.ts';
import { readCalibration } from './calibration.ts';
import { discover } from './discover.ts';
import { openHashCache } from './hash.ts';

import { readManifest } from './manifest.ts';
import { computeTiming, readStreams } from './timing.ts';

export const INGEST_TOOL_VERSION = '0.3.1';

export class UnsupportedLayoutError extends Error {}

/**
 * The full source inventory: every file the fingerprint is computed over, with
 * its size and digest. Not part of the EpisodeRecord — the record describes the
 * episode, this describes the delivery — but the store needs it to name which
 * file changed between two deliveries (CHECKSUM-MISMATCH).
 *
 * Invariant worth keeping: contentFingerprint(files) === record.content_fingerprint.
 */
export type SourceInventory = { relative_path: string; bytes: number; sha256: string };

/**
 * One session directory in, one validated EpisodeRecord out. Nothing is written
 * to the source (ING-34) and nothing is ever discarded (ING-17): a session that
 * cannot be trusted comes back quarantined, with reasons.
 */
export async function ingest(dir: string): Promise<EpisodeRecord> {
  return (await ingestSession(dir)).record;
}

/** As `ingest`, plus the source inventory the store writes to `episode_files`. */
export async function ingestSession(
  dir: string,
): Promise<{ record: EpisodeRecord; files: SourceInventory[] }> {
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
  const { discrepancies } = classify({
    discovery,
    manifest,
    calibration,
    streams,
    timing,
  });

  const cache = await openHashCache();
  const hashOf = (e: { path: string; bytes: number; mtimeMs: number }) =>
    cache.hash(e.path, e.bytes, e.mtimeMs);

  /**
   * Every source file except the manifest, each hashed once. The cache keys on
   * path+size+mtime, so the media and calibration digests below are reads, not
   * a second pass over the bytes.
   *
   * The manifest is left out deliberately. ING-02: it is a hint and decides
   * nothing — not duration, not frame counts, not which streams exist, and not
   * identity. A device rewriting its own metadata is not a corrupted delivery,
   * so it must not read as CHECKSUM-MISMATCH. This is also what keeps the B5
   * guarantee true (corrupting the `files` block changes nothing in the output).
   * See docs/episode-identity.md.
   */
  const files: SourceInventory[] = [];
  for (const e of discovery.entries) {
    if (e.kind === 'manifest') continue;
    files.push({ relative_path: e.file, bytes: e.bytes, sha256: await hashOf(e) });
  }
  for (const name of discovery.unclassified) {
    // ING-04: a file this engine does not understand is still a file that was
    // delivered, so it counts towards the fingerprint like any other.
    const path = join(dir, name);
    const st = await stat(path);
    files.push({
      relative_path: name,
      bytes: st.size,
      sha256: await cache.hash(path, st.size, st.mtimeMs),
    });
  }
  files.sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1));

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

  /**
   * ING-30, ING-32. Identity is the directory basename and nothing else, so the
   * same session delivered by two routes is one episode. The fingerprint is a
   * column beside it, never the key: an id that moved when the bytes moved
   * would hide the very corruption CHECKSUM-MISMATCH exists to surface.
   */
  const name = basename(dir);
  const parsed = parseSessionBasename(name);
  discrepancies.push(...identityDiscrepancies(name, parsed, discovery, manifest.deviceSerial));

  const serial = discovery.deviceSerial ?? manifest.deviceSerial ?? 'unknown';

  return {
    files,
    record: EpisodeRecordSchema.parse({
      schema_version: '1.1.0',
      episode_id: deriveEpisodeId(name),
      content_fingerprint: contentFingerprint(files),
      state: stateFrom(discrepancies),
      source: {
        path: name,
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
      // Already sorted by path in byte order above, which is the order the
      // fingerprint is computed in. Emitted verbatim so the two cannot drift.
      source_files: files,
      discrepancies,
      unclassified_files: discovery.unclassified,
    }),
  };
}

/**
 * Cross-checks on the name the id is derived from. Neither can change the id:
 * the basename wins, always, because everything else is a hint.
 *
 * The calibration YAML's own `serial_number` is deliberately not compared.
 * ING-24: it is the calibration rig's serial and legitimately differs from the
 * device serial — 072310 reads CH5LB5400J5 against a device AZER76400FE. What
 * *is* compared is the serial spelled in the calibration files' names, which is
 * the device serial and should agree.
 */
function identityDiscrepancies(
  name: string,
  parsed: ReturnType<typeof parseSessionBasename>,
  discovery: { entries: { file: string; serial: string | null }[] },
  manifestSerial: string | null,
): Discrepancy[] {
  const out: Discrepancy[] = [];

  if (parsed === null) {
    out.push({
      code: 'EPISODE-ID-FALLBACK',
      severity: 'flag',
      detail: `"${name}" is not {device}_{serial}_{YYYYMMDD}_{HHMMSS}; the id is derived from the raw name`,
    });
    return out; // Nothing to cross-check against.
  }

  const others = new Map<string, string>(); // serial -> where it was seen
  if (manifestSerial && manifestSerial.toUpperCase() !== parsed.serial) {
    others.set(manifestSerial, 'manifest');
  }
  for (const e of discovery.entries) {
    if (e.serial && e.serial.toUpperCase() !== parsed.serial && !others.has(e.serial)) {
      others.set(e.serial, e.file);
    }
  }

  if (others.size > 0) {
    out.push({
      code: 'SERIAL-CONFLICT',
      severity: 'flag',
      detail:
        `directory says ${parsed.serial}, but ` +
        [...others].map(([s, where]) => `${where} says ${s}`).join(', ') +
        '; the directory decides identity',
    });
  }
  return out;
}
