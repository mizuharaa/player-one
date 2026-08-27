import { mkdtemp, rm, symlink, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolMissing, runTool } from './frames.ts';

/**
 * A wrapper around `packages/hardware-checkout/corpus_check.py`, the four
 * device-health analysers the checkout protocol runs: truncation (PTS rows vs
 * MP4 packets), the 4 KiB write-buffer boundary, warm-up, and the IMU clock
 * and gravity. It is run as the CLI it is, with `--json --packets`, and its
 * report is read back; none of its arithmetic is repeated here.
 *
 * The script analyses a directory OF session folders. One episode is one
 * folder, so the folder is linked into a temporary directory and the script
 * is pointed at that — a production media root holds hundreds of sessions
 * and a per-episode evaluation must not re-probe all of them.
 *
 * Exit 4 is "ffprobe is not installed" and is raised as `ToolMissing`: a
 * missing tool says nothing about the footage and must never become a flag.
 */

export type CorpusStream = {
  pts_files: string[];
  pts_rows: number;
  pts_partial_tail: boolean;
  pts_bytes: number;
  manifest_frames: number | null;
  media_packets: number | null;
  media: 'ok' | 'missing' | 'unreadable' | 'unmeasured' | 'n/a';
  verdict: string;
  buffer_suspect: { file: string; bytes: number; units: number }[];
  first_pts_us: number | null;
  warmup_sec: number | null;
};

export type CorpusImu = {
  first_pts_us: number | null;
  clock_outlier_rows: number;
  accel_rows: number;
  warmup_sec: number | null;
  mean_sample_magnitude?: number;
  mean_accel?: number[];
  mean_vector_magnitude?: number;
  signature?: string;
};

export type CorpusSession = {
  session: string;
  status: string | null;
  start_time: string | null;
  streams: Record<string, CorpusStream>;
  imu: CorpusImu;
};

const SCRIPT = fileURLToPath(new URL('../../packages/hardware-checkout/corpus_check.py', import.meta.url));

async function runPython(args: string[], python?: string) {
  const candidates = python ? [python] : process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
  let last: unknown = null;
  for (const cmd of candidates) {
    try {
      return await runTool(cmd, args);
    } catch (err) {
      if (err instanceof ToolMissing) { last = err; continue; }
      throw err;
    }
  }
  throw last instanceof Error ? last : new ToolMissing('python was not found on PATH');
}

/** Links one session folder into a scratch directory and runs the analyser over it. */
export async function corpusCheck(
  sessionDir: string,
  o: { python?: string; packets?: boolean; script?: string } = {},
): Promise<CorpusSession> {
  const target = resolve(sessionDir);
  const scratch = await mkdtemp(join(tmpdir(), 'risk-corpus-'));
  const link = join(scratch, basename(target));
  try {
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    const args = [o.script ?? SCRIPT, scratch, '--json'];
    if (o.packets ?? true) args.push('--packets');
    const { stdout, stderr, code } = await runPython(args, o.python);
    if (code === 4) throw new ToolMissing(stderr.trim() || 'ffprobe was not found on PATH');
    if (code !== 0) throw new Error(`corpus_check.py exited ${code}: ${stderr.trim()}`);
    const report = JSON.parse(stdout.toString('utf8')) as CorpusSession[];
    const session = report.find((s) => s.session === basename(target)) ?? report[0];
    if (session === undefined) throw new Error(`corpus_check.py reported nothing for ${basename(target)}`);
    return session;
  } finally {
    // The link, then the scratch directory. Never the target: a recursive
    // remove that followed the junction would delete a collector's footage.
    try { await unlink(link); } catch { try { await rmdir(link); } catch { /* already gone */ } }
    await rm(scratch, { recursive: true, force: true });
  }
}
