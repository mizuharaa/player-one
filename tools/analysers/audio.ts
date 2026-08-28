import { runTool } from './frames.ts';

/**
 * Is there sound? ffmpeg's `volumedetect` prints the mean and peak level of
 * a file to stderr; a lens cap has no acoustic equivalent, but a muted
 * microphone, a synthetic clip and a screen recording without audio all read
 * as silence, and CONT.AUDIO_ABSENT says so where the task expects sound.
 */

export type AudioMeasure = { meanVolumeDb: number | null; maxVolumeDb: number | null };

export async function measureAudio(file: string, o: { ffmpeg?: string } = {}): Promise<AudioMeasure> {
  const { stderr } = await runTool(o.ffmpeg ?? 'ffmpeg', [
    '-v', 'info', '-nostdin', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const mean = /mean_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr);
  const num = (m: RegExpExecArray | null): number | null =>
    m === null ? null : m[1] === '-inf' ? -Infinity : Number(m[1]);
  return { meanVolumeDb: num(mean), maxVolumeDb: num(max) };
}
