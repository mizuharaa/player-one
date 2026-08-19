/**
 * B21 constant memory and B22 throughput.
 *
 *   node packages/ingest/scripts/bench.ts [--gb 2] [--keep]
 *
 * Builds a synthetic session of the requested size in the OS temp directory,
 * ingests it, and reports peak RSS and sustained MB/s. Peak RSS is what proves
 * ING-N1: a 32 GB session must not cost materially more RAM than a 40 MB one,
 * so run it at two sizes and compare.
 */
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ingest } from '../src/ingest.ts';

const args = process.argv.slice(2);

/**
 * Child mode. Peak RSS only means something in a process that did nothing but
 * ingest: building a multi-gigabyte session leaves a heap behind that RSS never
 * gives back, and the first version of this script measured its own generator.
 */
const childAt = args.indexOf('--ingest-only');
if (childAt >= 0) {
  const target = args[childAt + 1]!;
  let peak = 0;
  const tick = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peak) peak = rss;
  }, 20);
  const t0 = performance.now();
  const rec = await ingest(target);
  clearInterval(tick);
  console.log(JSON.stringify({
    seconds: (performance.now() - t0) / 1000,
    peakRss: peak,
    state: rec.state,
    duration: rec.timing.raw_duration_s,
  }));
  process.exit(0);
}

const gbAt = args.indexOf('--gb');
const GB = gbAt >= 0 ? Number(args[gbAt + 1]) : 2;
const keep = args.includes('--keep');

const SERIAL = 'BENCH0000001';
const STEM = `ego_${SERIAL}_20260813_120000`;
const FPS_US = 33_334n;
const T0 = 1_786_611_600_000_000n;

/** Frames chosen so the sidecars stay honest about a session this long. */
const FRAMES = 30 * 60 * 30; // 30 minutes at 30 fps

const NL = String.fromCharCode(10);

/** Streamed, so the generator itself never holds the session in memory and the RSS reading means something. */
async function writeLines(path: string, count: number, line: (i: number) => string, header: string): Promise<void> {
  const out = createWriteStream(path);
  let buf = header + NL;
  for (let i = 0; i < count; i++) {
    buf += line(i) + NL;
    if (buf.length > 1 << 20) {
      if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
      buf = '';
    }
  }
  out.write(buf);
  await new Promise((r) => out.end(r));
}

async function writeBytes(path: string, bytes: number): Promise<void> {
  const chunk = Buffer.alloc(1 << 20, 0x5a); // 1 MiB, reused, so the writer is constant memory too
  const out = createWriteStream(path);
  let left = bytes;
  while (left > 0) {
    const size = Math.min(chunk.length, left);
    if (!out.write(size === chunk.length ? chunk : chunk.subarray(0, size))) {
      await new Promise((r) => out.once('drain', r));
    }
    left -= size;
  }
  await new Promise((r) => out.end(r));
}

const root = await mkdtemp(join(tmpdir(), 'px-bench-'));
const dir = join(root, STEM);
await mkdir(dir, { recursive: true });

const perCamera = Math.floor((GB * 1024 ** 3) / 2);
console.log(`building a ${GB} GB session in ${dir} ...`);

const pts = ['timestamp_us'];
for (let i = 0; i < FRAMES; i++) pts.push(String(T0 + BigInt(i) * FPS_US));
const ptsCsv = pts.join('\n') + '\n';

const imu = ['timestamp_us\t,x\t,y\t,z\t,type'];
for (let i = 0; i < FRAMES * 33; i++) {
  const t = T0 + BigInt(i) * 1_000n;
  imu.push(`${t},0.1,-9.8,0.2,accel`, `${t},0.001,0.002,0.003,gyro`);
}
await writeFile(join(dir, `${STEM}_imu_part0001.csv`), imu.join('\n') + '\n');

for (const role of ['camera_left', 'camera_right']) {
  await writeFile(join(dir, `${STEM}_${role}_part0001_pts.csv`), ptsCsv);
  await writeBytes(join(dir, `${STEM}_${role}_part0001.mp4`), perCamera);
}
await writeFile(join(dir, `${STEM}_audio.wav`), '');
await writeFile(join(dir, `${STEM}_audio_pts.csv`), ptsCsv);
await writeFile(
  join(dir, `${STEM}_calibration_camera.yaml`),
  'calibration_info:\n  serial_number: BENCHCAL001\ncameras:\n  - id: cam_0\n    name: IR_L\n',
);
await writeFile(join(dir, `${STEM}_calibration_imu.yaml`), 'imu0:\n  update_rate: 1000\n');

let bytes = 0;
for (const f of await (await import('node:fs/promises')).readdir(dir)) {
  bytes += (await stat(join(dir, f))).size;
}

// Fresh cache, or the second run reuses digests and measures nothing.
const cache = await mkdtemp(join(tmpdir(), 'px-bench-cache-'));
process.env['PLAYERONE_CACHE'] = cache;

const { stdout } = await promisify(execFile)(
  process.execPath,
  [fileURLToPath(import.meta.url), '--ingest-only', dir],
  { env: { ...process.env, PLAYERONE_CACHE: cache }, maxBuffer: 1 << 20 },
);
const child = JSON.parse(stdout.trim()) as {
  seconds: number;
  peakRss: number;
  state: string;
  duration: number;
};

const elapsed = child.seconds;
const peakRss = child.peakRss;
const record = { state: child.state, timing: { raw_duration_s: child.duration } };
const mb = bytes / 1024 ** 2;
console.log(`
  session bytes    ${mb.toFixed(1)} MB
  elapsed          ${elapsed.toFixed(2)} s
  throughput       ${(mb / elapsed).toFixed(1)} MB/s      (B22 target >= 150)
  peak RSS         ${(peakRss / 1024 ** 2).toFixed(1)} MB      (B21 target < 512)
  state            ${record.state}
  raw_duration_s   ${record.timing.raw_duration_s.toFixed(3)}
`);

await rm(cache, { recursive: true, force: true });
if (!keep) await rm(root, { recursive: true, force: true });
