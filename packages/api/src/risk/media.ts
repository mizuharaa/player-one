import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { EpisodeRecord } from '@playerone/contracts';
import { measureAudio } from '../../../../tools/analysers/audio.ts';
import { corpusCheck } from '../../../../tools/analysers/corpus-check.ts';
import { probeEncoder } from '../../../../tools/analysers/encoder.ts';
import { decodeParts, frameStats, ToolMissing } from '../../../../tools/analysers/frames.ts';
import { imuVideoCorrelation, readImuCsv } from '../../../../tools/analysers/imu.ts';
import { moovGate } from '../../../../tools/analysers/moov.ts';
import { noEnrolment, prnuCorrelation, type PrnuEnrolmentSource } from '../../../../tools/analysers/prnu.ts';
import { measureRecapture } from '../../../../tools/analysers/recapture.ts';
import { safeJoin } from '../media.ts';
import type { MediaFacts } from './detectors/content.ts';

/**
 * Runs every analyser over one episode's session folder and hands the
 * detectors one `MediaFacts`. Each tool is isolated: a tool that is missing
 * or that fails records itself in `tools` and leaves its facts null, because
 * a broken analyser must never read as a verdict on the footage — the same
 * rule corpus_check.py applies to a missing ffprobe.
 *
 * Files are located from the ingest record's own stream inventory, never
 * from the manifest's `files` list, which names files that do not exist.
 */

export type MediaTools = { ffmpeg?: string; ffprobe?: string; python?: string; node?: string };

export type MediaOptions = {
  mediaRoot: string;
  prnu?: PrnuEnrolmentSource;
  tools?: MediaTools;
  /** Sample rate for frame analysis, frames per second of footage. */
  fps?: number;
};

export function streamFiles(record: EpisodeRecord | null): { video: string[]; audio: string[]; imu: string[] } {
  const out = { video: [] as string[], audio: [] as string[], imu: [] as string[] };
  if (record === null) return out;
  const cameras = record.streams.filter((s) => s.role.startsWith('camera_'));
  const left = cameras.find((s) => s.role === 'camera_left') ?? cameras[0];
  if (left) out.video = left.parts.map((p) => p.file);
  const audio = record.streams.find((s) => s.role === 'audio');
  if (audio) out.audio = audio.parts.map((p) => p.file);
  const imu = new Set<string>();
  for (const s of record.streams) if (s.role.startsWith('imu')) for (const p of s.parts) imu.add(p.file);
  out.imu = [...imu];
  return out;
}

const exists = async (p: string): Promise<boolean> => access(p).then(() => true, () => false);

export async function measureEpisodeMedia(
  ep: { deviceSerial: string; sourceBasename: string; record: EpisodeRecord | null },
  o: MediaOptions,
): Promise<MediaFacts | null> {
  const dir = safeJoin(o.mediaRoot, ep.sourceBasename, '.');
  if (dir === null || !(await exists(dir))) return null;
  const files = streamFiles(ep.record);
  const paths = (names: string[]): string[] =>
    names.map((n) => safeJoin(o.mediaRoot, ep.sourceBasename, n)).filter((p): p is string => p !== null);
  const video = paths(files.video);
  const audio = paths(files.audio);
  const imu = paths(files.imu);
  const tools: Record<string, string> = {};
  const facts: MediaFacts = {
    moov: [],
    corpus: null,
    frames: null,
    audio: null,
    encoder: null,
    recapture: null,
    prnu: null,
    imuVideo: null,
    tools,
  };
  const attempt = async (name: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
      tools[name] = 'ok';
    } catch (err) {
      tools[name] = `${err instanceof ToolMissing ? 'missing' : 'failed'}: ${(err as Error).message.split('\n')[0]}`;
    }
  };

  const present = async (list: string[]): Promise<string[]> => {
    const out: string[] = [];
    for (const p of list) if (await exists(p)) out.push(p);
    return out;
  };
  const videoFiles = await present(video);
  const audioFiles = await present(audio);
  const imuFiles = await present(imu);

  if (videoFiles.length > 0) {
    await attempt('moov', async () => {
      facts.moov = await moovGate(videoFiles, { node: o.tools?.node });
    });
  }
  await attempt('corpus_check', async () => {
    facts.corpus = await corpusCheck(dir, { python: o.tools?.python, packets: true });
  });
  if (videoFiles.length > 0) {
    await attempt('frames', async () => {
      const set = await decodeParts(videoFiles, { fps: o.fps ?? 1, ffmpeg: o.tools?.ffmpeg });
      facts.frames = frameStats(set);
      facts.recapture = measureRecapture(set);
      const enrolled = await (o.prnu ?? noEnrolment).fingerprintFor(ep.deviceSerial);
      if (enrolled !== null) {
        const c = prnuCorrelation(set, enrolled);
        if (c !== null) facts.prnu = { deviceSerial: ep.deviceSerial, correlation: c, frames: set.frames.length, enrolledAt: enrolled.enrolledAt };
      }
    });
    await attempt('encoder', async () => {
      facts.encoder = await probeEncoder(videoFiles[0]!, { ffprobe: o.tools?.ffprobe, node: o.tools?.node });
    });
  }
  if (facts.frames !== null && imuFiles.length > 0) {
    await attempt('imu', async () => {
      const start = ep.record?.timing.usable_start_us;
      const series = await readImuCsv(imuFiles[0]!, { referenceUs: start ? BigInt(start) : null });
      facts.imuVideo = imuVideoCorrelation(facts.frames!, series);
    });
  }
  if (audioFiles.length > 0) {
    await attempt('audio', async () => {
      const m = await measureAudio(audioFiles[0]!, { ffmpeg: o.tools?.ffmpeg });
      facts.audio = { meanVolumeDb: m.meanVolumeDb };
    });
  }
  return facts;
}

/** Where an episode's session folder would be. Exported for the routes' "is the media here" answer. */
export const sessionDirOf = (mediaRoot: string, sourceBasename: string): string | null =>
  safeJoin(mediaRoot, sourceBasename, '.') ?? join(mediaRoot, sourceBasename);
