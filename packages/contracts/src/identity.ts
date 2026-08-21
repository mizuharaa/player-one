import { createHash } from 'node:crypto';

/**
 * Episode identity. Pure: no I/O, no filesystem, no path handling beyond the
 * basename the caller passes in. Everything here is auditable by reading it.
 *
 * Two rules decide the shape of this file, and both are expensive to reverse
 * once tables exist. See docs/episode-identity.md.
 *
 *  1. The id comes from *session identity*, never from content. An id derived
 *     from the content fingerprint would change when a file's bytes change,
 *     which produces a second episode row instead of an alert — and
 *     CHECKSUM-MISMATCH, the defect that exists to catch exactly that, would
 *     make itself invisible. (Milestone 0.3 §3.1. This supersedes the v0.3.1
 *     derivation, which did key the id off the fingerprint.)
 *  2. The id is derived, not assigned. A UUID v7 is time-ordered and partly
 *     random, so a re-run would mint a different id and break ING-32
 *     (same identity on a re-run) and ING-N2 (byte-identical output).
 *     RFC 9562 reserves v8 for exactly this: an implementation-defined,
 *     deterministic id.
 */

/**
 * The device family is captured, not required to be `ego`: this directory
 * layout is PaXini's, not one product's, and the pilot fleet is not the last
 * hardware. Same regex as discover.ts's DIR_NAME, for the same reason.
 */
const BASENAME = /^(?<device>[A-Za-z0-9]+)_(?<serial>[^_]+)_(?<date>\d{8})_(?<time>\d{6})$/;

export type SessionIdentity = {
  /** Uppercased. The basename wins over the manifest and the calibration, always. */
  serial: string;
  /** `YYYYMMDD` as given. */
  date: string;
  /** `HHMMSS` as given. */
  time: string;
};

/** Null when the basename does not match `{device}_{SERIAL}_{YYYYMMDD}_{HHMMSS}`. */
export function parseSessionBasename(basename: string): SessionIdentity | null {
  const g = BASENAME.exec(basename)?.groups;
  if (!g) return null;
  return { serial: g['serial']!.toUpperCase(), date: g['date']!, time: g['time']! };
}

/**
 * The string the id is a digest of. Versioned, because changing the derivation
 * later must be a visible decision and not a silent re-keying of every episode.
 */
export function identityString(basename: string): string {
  const id = parseSessionBasename(basename);
  return id === null
    ? `playerone:episode:v1:raw:${basename}`
    : `playerone:episode:v1:${id.serial}:${id.date}T${id.time}`;
}

/**
 * sha256 of the identity string, first 16 bytes, stamped as a UUID v8.
 *
 * Input is the basename only — never the absolute path, never a mount point.
 * `/media/tf/ego_X_20260813_072310` and `/tmp/dl/ego_X_20260813_072310` are one
 * episode, which is the whole point: a card handed in at the upload centre and
 * a cloud re-download of the same session must not be paid twice.
 */
export function deriveEpisodeId(basename: string): string {
  const b = createHash('sha256').update(identityString(basename), 'utf8').digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x80; // version 8
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export type SourceFile = { relative_path: string; sha256: string };

/**
 * sha256 over `{relative_path}\n{sha256}\n` per file, sorted by path in byte
 * order. A column, never a key.
 *
 * Source file bytes only: no engine version, no hostname, no run timestamp, no
 * measured output. If the engine version leaked in here, a version bump would
 * fork every episode and every re-ingest would report a spurious mismatch.
 *
 * The manifest is excluded by the caller, not here — see ingest.ts.
 *
 * An empty session (no files at all — 072415 is one) fingerprints as the sha256
 * of the empty string, e3b0c442...b855. That is a real value, not a sentinel:
 * identity still comes from the basename, so the session stores fine.
 */
export function contentFingerprint(files: readonly SourceFile[]): string {
  const h = createHash('sha256');
  // localeCompare would sort by locale; identity must not depend on where the
  // upload centre is. Byte order, case-sensitive.
  for (const f of [...files].sort((a, b) => (a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0))) {
    h.update(`${f.relative_path}\n${f.sha256}\n`, 'utf8');
  }
  return h.digest('hex');
}
