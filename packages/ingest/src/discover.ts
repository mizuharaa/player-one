import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** ING-01..05. Media is located by directory scan and filename pattern, never by the manifest's `files` block. */

/**
 * PaXini ships two unrelated collection formats. This engine reads the ego
 * session directory. The Super EID Factory rooms produce one HDF5 per episode
 * (`episode_{INDEX}_{HHMMSS}_{ROOM-ID}_{PERSONNEL-ID}[_{STAGE}].hdf5`, DF-1/2/2R
 * per the PX OmniSharing toolkit). Naming that format is worth eight lines:
 * reporting "100 unknown files" or MEDIA-MISSING for a directory of perfectly
 * valid episodes sends an operator down the wrong road for an afternoon.
 */

export type Kind = 'manifest' | 'calibration' | 'media' | 'pts';

export type FileEntry = {
  file: string;
  path: string;
  bytes: number;
  mtimeMs: number;
  kind: Kind;
  /**
   * `camera_left`, `camera_right`, `camera_*`, `imu` or `audio` for streams;
   * `camera` or `imu` for calibration; null for the manifest. Left open because
   * the record's stream list is open: a device with a third camera should
   * produce a third stream, not an unclassified file the timing engine ignores.
   */
  role: string | null;
  partNumber: number | null;
};

/**
 * `session` — the directory layout this engine reads, from any device that
 * emits it. `paxini_episode` — a Super EID Factory HDF5 batch, a different
 * product this engine does not read. `nested` — subdirectories and no session
 * files, i.e. pointed at a batch root rather than at one session.
 */
export type Layout = 'session' | 'paxini_episode' | 'nested' | 'empty';

export type Discovery = {
  dir: string;
  layout: Layout;
  /** Device family from the filename prefix — 'ego' today, whatever PaXini ships next tomorrow. */
  deviceName: string | null;
  deviceSerial: string | null;
  sessionTimestamp: string | null;
  entries: FileEntry[];
  subdirs: string[];
  unclassified: string[];
};

// The device family is a captured field, not the literal 'ego': this layout is
// PaXini's, not one product's, and the pilot fleet is not the last hardware.
const MANIFEST =
  /^meta_(?<device>[A-Za-z0-9]+)_(?<serial>[^_]+)_(?<date>\d{8})_(?<time>\d{6})\.json$/;
const SESSION_FILE =
  /^(?<device>[A-Za-z0-9]+)_(?<serial>[^_]+)_(?<date>\d{8})_(?<time>\d{6})_(?<rest>.+)$/;
const REST =
  /^(?<role>calibration_camera|calibration_imu|camera_[a-z0-9_]+?|imu|audio)(?:_part(?<part>\d{4}))?(?<pts>_pts)?\.(?<ext>[A-Za-z0-9]+)$/;
const DIR_NAME = /^(?<device>[A-Za-z0-9]+)_(?<serial>[^_]+)_(?<date>\d{8})_(?<time>\d{6})$/;
const PAXINI_EPISODE = /^episode_\d+_\d{6}_\d+_\d+(_[a-z0-9]+)?\.hdf5$/;

function classify(name: string): Omit<FileEntry, 'path' | 'bytes' | 'mtimeMs'> | null {
  const meta = MANIFEST.exec(name);
  if (meta) return { file: name, kind: 'manifest', role: null, partNumber: null };

  const m = SESSION_FILE.exec(name);
  if (!m?.groups) return null;
  const r = REST.exec(m.groups['rest']!);
  if (!r?.groups) return null;

  const role = r.groups['role']!;
  const partNumber = r.groups['part'] ? Number(r.groups['part']) : null;

  if (role.startsWith('calibration_')) {
    return {
      file: name,
      kind: 'calibration',
      role: role === 'calibration_camera' ? 'camera' : 'imu',
      partNumber,
    };
  }
  return {
    file: name,
    kind: r.groups['pts'] ? 'pts' : 'media',
    role,
    partNumber,
  };
}

export async function discover(dir: string): Promise<Discovery> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const names = dirents.filter((d) => d.isFile()).map((d) => d.name).sort();
  const subdirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name).sort();

  const entries: FileEntry[] = [];
  const unclassified: string[] = [];

  for (const name of names) {
    const c = classify(name);
    if (!c) {
      unclassified.push(name); // ING-04: carried forward, never dropped
      continue;
    }
    const path = join(dir, name);
    const st = await stat(path);
    entries.push({ ...c, path, bytes: st.size, mtimeMs: st.mtimeMs });
  }

  // Identity from the directory name, falling back to any classified filename (ING-03).
  const fromDir = DIR_NAME.exec(basename(dir))?.groups;
  const fromFile = entries.length
    ? (MANIFEST.exec(entries[0]!.file)?.groups ?? SESSION_FILE.exec(entries[0]!.file)?.groups)
    : undefined;
  const id = fromDir ?? fromFile;

  return {
    dir,
    layout: layoutOf(entries, unclassified, subdirs),
    deviceName: id?.['device'] ?? null,
    deviceSerial: id?.['serial'] ?? null,
    sessionTimestamp: id ? `${id['date']}_${id['time']}` : null,
    entries,
    subdirs,
    unclassified,
  };
}

function layoutOf(entries: FileEntry[], unclassified: string[], subdirs: string[]): Layout {
  if (entries.length > 0) return 'session';
  if (unclassified.some((n) => PAXINI_EPISODE.test(n))) return 'paxini_episode';
  if (subdirs.length > 0) return 'nested';
  return 'empty';
}
