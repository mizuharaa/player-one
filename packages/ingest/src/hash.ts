import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ING-29, ING-33. One streaming pass per file, constant memory. A 32 GB session
 * must not cost more RAM than a 40 MB one.
 */

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

/**
 * Resume across an interrupted run (ING-33). The cache never lives beside the
 * source: the card is evidence and ingest does not write to it (ING-34).
 * A file is reused only when its path, size and mtime all still match.
 */
export type HashCache = {
  hash(path: string, bytes: number, mtimeMs: number): Promise<string>;
  reused: number;
  computed: number;
};

const cacheDir = (): string =>
  process.env['PLAYERONE_CACHE'] ?? join(tmpdir(), 'playerone-ingest');

export async function openHashCache(): Promise<HashCache> {
  const dir = cacheDir();
  const file = join(dir, 'hashes.json');

  let entries: Record<string, string> = {};
  try {
    entries = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // No cache yet, or a corrupt one. Either way, start clean and re-hash.
  }

  const cache: HashCache = {
    reused: 0,
    computed: 0,
    async hash(path, bytes, mtimeMs) {
      const key = `${path}|${bytes}|${Math.round(mtimeMs)}`;
      const hit = entries[key];
      if (hit !== undefined) {
        cache.reused++;
        return hit;
      }
      const digest = await sha256File(path);
      entries[key] = digest;
      cache.computed++;
      // Written per file, so a kill mid-run loses at most the file in flight.
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(entries));
      return digest;
    },
  };
  return cache;
}

/**
 * ING-30. Two deliveries of the same session by different paths must resolve to
 * one episode, so the fingerprint is built only from things the content itself
 * decides: the device, the session start, and the sorted media digests.
 */
export function contentFingerprint(
  deviceSerial: string,
  sessionStart: string,
  mediaHashes: string[],
): string {
  const h = createHash('sha256');
  h.update(deviceSerial);
  h.update('\0');
  h.update(sessionStart);
  // Distinct files only: the IMU log backs both the accel and the gyro stream,
  // so the same digest arrives twice and must count once.
  for (const digest of [...new Set(mediaHashes)].sort()) {
    h.update('\0');
    h.update(digest);
  }
  return h.digest('hex');
}

/**
 * ING-32. The spec asks for a UUID v7 assigned at first ingest, but a v7 is
 * time-ordered and random, which cannot satisfy ING-32 (same identity on a
 * re-run) or ING-N2 (byte-identical output) at the same time. The id is
 * therefore derived from the fingerprint, formatted as a v8 UUID, which RFC 9562
 * reserves for exactly this: an implementation-defined, deterministic id.
 */
export function episodeIdFrom(fingerprint: string): string {
  const h = fingerprint.slice(0, 32).split('');
  h[12] = '8'; // version 8
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16); // RFC 9562 variant
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
