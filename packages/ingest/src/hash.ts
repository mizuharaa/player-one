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

/**
 * 4 MiB reads rather than the 64 KiB default. SHA-256 is far faster than the
 * syscall churn of small reads, so the default turns a CPU-bound job into a
 * syscall-bound one. Still constant memory: one buffer, reused.
 */
const READ_CHUNK = 4 * 1024 * 1024;

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path, { highWaterMark: READ_CHUNK }), h);
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
