import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { FileEntry } from './discover.ts';

/**
 * ING-22..25. Both YAMLs travel with the episode. The calibration's own serial
 * legitimately differs from the device serial. The camera naming conflict is
 * recorded from both sources and left unresolved — it is an open question with
 * PaXini (ING-Q1), not something ingest gets to decide.
 */

export type CalibrationInfo = {
  /**
   * Both files present and readable. An empty or malformed YAML is not a
   * calibration: the recording still cannot be reconstructed, which is the
   * whole reason ING-23 quarantines a missing one.
   */
  present: boolean;
  camera: FileEntry | null;
  imu: FileEntry | null;
  /** e.g. CH5LB5400J5 — not the device serial (ING-24). */
  serial: string | null;
  /** e.g. ['IR_L', 'IR_R'] where the manifest says ['color_left', 'color_right']. */
  cameraNames: string[];
  /** Files that are on disk but could not be read as YAML. */
  unreadable: string[];
};

export async function readCalibration(entries: FileEntry[]): Promise<CalibrationInfo> {
  const camera = entries.find((e) => e.kind === 'calibration' && e.role === 'camera') ?? null;
  const imu = entries.find((e) => e.kind === 'calibration' && e.role === 'imu') ?? null;

  let serial: string | null = null;
  let cameraNames: string[] = [];
  const unreadable: string[] = [];

  for (const f of [camera, imu]) {
    if (!f) continue;
    const y = await parseYaml(f.path);
    if (y === null) {
      unreadable.push(f.file);
      continue;
    }
    if (f !== camera) continue;
    serial = y['calibration_info']?.serial_number ?? null;
    cameraNames = Array.isArray(y['cameras'])
      ? y['cameras'].map((c: { name?: unknown }) => String(c?.name ?? '')).filter(Boolean)
      : [];
  }

  return {
    present: camera !== null && imu !== null && unreadable.length === 0,
    camera,
    imu,
    serial,
    cameraNames,
    unreadable,
  };
}

/** Null when the file is empty, malformed, or parses to something that is not an object. */
async function parseYaml(path: string): Promise<Record<string, any> | null> {
  try {
    const y = parse(await readFile(path, 'utf8'));
    // typeof [] is 'object', and a YAML list is not a calibration.
    return y !== null && typeof y === 'object' && !Array.isArray(y)
      ? (y as Record<string, any>)
      : null;
  } catch {
    return null;
  }
}
