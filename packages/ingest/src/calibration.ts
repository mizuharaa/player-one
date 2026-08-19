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
  /** Both files present. Either one missing quarantines the episode (ING-23). */
  present: boolean;
  camera: FileEntry | null;
  imu: FileEntry | null;
  /** e.g. CH5LB5400J5 — not the device serial (ING-24). */
  serial: string | null;
  /** e.g. ['IR_L', 'IR_R'] where the manifest says ['color_left', 'color_right']. */
  cameraNames: string[];
};

export async function readCalibration(entries: FileEntry[]): Promise<CalibrationInfo> {
  const camera = entries.find((e) => e.kind === 'calibration' && e.role === 'camera') ?? null;
  const imu = entries.find((e) => e.kind === 'calibration' && e.role === 'imu') ?? null;

  let serial: string | null = null;
  let cameraNames: string[] = [];
  if (camera) {
    try {
      const y = parse(await readFile(camera.path, 'utf8')) ?? {};
      serial = y?.calibration_info?.serial_number ?? null;
      cameraNames = Array.isArray(y?.cameras)
        ? y.cameras.map((c: { name?: unknown }) => String(c?.name ?? '')).filter(Boolean)
        : [];
    } catch {
      // An unreadable calibration is an absent calibration: it quarantines either way.
    }
  }

  return { present: camera !== null && imu !== null, camera, imu, serial, cameraNames };
}
