/**
 * Throwaway measurement harness for the cloud upload leg at pilot scale.
 * Not part of the product; not committed. Run with `node`.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { PART_SIZE, planParts, S3ObjectStore, verifyReadBack } from '../src/upload-worker.ts';

const store = new S3ObjectStore({
  endpoint: 'http://127.0.0.1:9000',
  bucket: 'playerone-scale',
  key: 'playerone',
  secret: 'playerone123',
});

/** rx/tx on the MinIO container's eth0: bytes actually on the wire. */
function wire(): { rx: number; tx: number } {
  const out = execFileSync('docker', ['exec', 'playerone-minio', 'cat', '/proc/net/dev'], {
    encoding: 'utf8',
  });
  const line = out.split('\n').find((l) => l.trim().startsWith('eth0:'))!;
  const f = line.replace(/^\s*eth0:\s*/, '').trim().split(/\s+/);
  return { rx: Number(f[0]), tx: Number(f[8]) };
}

const MB = (n: number) => (n / 1e6).toFixed(2);

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const w0 = wire();
  const t0 = Date.now();
  let peak = process.memoryUsage().rss;
  const poll = setInterval(() => {
    const r = process.memoryUsage().rss;
    if (r > peak) peak = r;
  }, 250);
  try {
    return await fn();
  } finally {
    clearInterval(poll);
    const s = (Date.now() - t0) / 1000;
    const w1 = wire();
    console.log(
      `${label}: wall=${s.toFixed(1)}s up=${MB(w1.rx - w0.rx)}MB down=${MB(w1.tx - w0.tx)}MB peakRSS=${MB(peak)}MB`,
    );
  }
}

async function sha256OfFile(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path, { highWaterMark: 4 * 1024 * 1024 }), h);
  return h.digest('hex');
}

/** Concatenate `src` `times` over into `dst` — real MP4 bytes, no compressible padding. */
async function grow(src: string, dst: string, times: number): Promise<void> {
  const out = createWriteStream(dst);
  for (let i = 0; i < times; i += 1) {
    await pipeline(createReadStream(src, { highWaterMark: 8 * 1024 * 1024 }), out, { end: false });
  }
  await new Promise<void>((r) => out.end(r));
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

if (cmd === 'grow') {
  const [src, dst, times] = args;
  const t0 = Date.now();
  await grow(src!, dst!, Number(times));
  console.log(`grew ${dst} to ${statSync(dst!).size} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} else if (cmd === 'hash') {
  const [path] = args;
  const t0 = Date.now();
  const d = await sha256OfFile(path!);
  const s = (Date.now() - t0) / 1000;
  const size = statSync(path!).size;
  console.log(`${d} ${size} bytes in ${s.toFixed(1)}s = ${(size / 1e6 / s).toFixed(1)} MB/s`);
} else if (cmd === 'put') {
  const [key, path, sha, force] = args;
  const size = statSync(path!).size;
  const parts = planParts(size);
  console.log(`put ${key}: ${size} bytes, PART_SIZE=${PART_SIZE}, parts=${parts.length}`);
  const r = await timed('put', () => store.put(key!, path!, sha!, force === 'force'));
  console.log(`result=${r}`);
} else if (cmd === 'verify') {
  const [key, path, sha] = args;
  const size = statSync(path!).size;
  const m = await timed('verify', () => verifyReadBack(store, [{ relative_path: 'x', sha256: sha! }], () => key!));
  console.log(`mismatches=${JSON.stringify(m)} bytes=${size}`);
} else if (cmd === 'wire') {
  console.log(JSON.stringify(wire()));
} else if (cmd === 'held') {
  const [key] = args;
  const uploadId = await store.openMultipart(key!);
  if (uploadId === null) { console.log('no open multipart'); }
  else {
    const parts = await store.heldParts(key!, uploadId);
    const bytes = parts.reduce((a, p) => a + p.size, 0);
    console.log(`uploadId=${uploadId} heldParts=${parts.length} heldBytes=${bytes}`);
  }
} else {
  console.log('usage: grow|hash|put|verify|wire|held');
}
