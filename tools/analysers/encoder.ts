import { runTool } from './frames.ts';
import { moovGate } from './moov.ts';

/**
 * How the file was written: container layout, codec, encoder tag, GOP.
 *
 * A device writes files one way, every time, because the firmware is one
 * program. A file that arrived by any other route — re-encoded, trimmed,
 * exported from an editor, generated — was written by something else, and
 * that something else leaves its own signature in the same places. Comparing
 * against a per-firmware profile (params of PROV.ENCODER_MISMATCH) is a
 * provenance check that costs one ffprobe and one box walk.
 *
 * The box order comes from the existing moov gate, so the two never disagree
 * about what is at the front of the file.
 */

export type EncoderProbe = {
  codec: string | null;
  profile: string | null;
  encoderTag: string | null;
  width: number | null;
  height: number | null;
  frameRate: string | null;
  /** Distance between the first two key frames in the first `sampleFrames` frames, or null. */
  gop: number | null;
  /** Top-level box types in file order. */
  boxOrder: string[];
  /** Fragmented MP4: a `moof` box is present. */
  fragmented: boolean;
  /** The moov gate's own verdict, verbatim. */
  moovVerdict: string;
};

type ProbeJson = {
  format?: { format_name?: string; tags?: Record<string, string> };
  streams?: { codec_name?: string; profile?: string; width?: number; height?: number; r_frame_rate?: string; tags?: Record<string, string> }[];
  frames?: { pict_type?: string }[];
};

export async function probeEncoder(
  file: string,
  o: { ffprobe?: string; node?: string; sampleFrames?: number } = {},
): Promise<EncoderProbe> {
  const sample = o.sampleFrames ?? 120;
  const { stdout, code, stderr } = await runTool(o.ffprobe ?? 'ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-select_streams', 'v:0',
    '-show_entries', 'format=format_name:format_tags=encoder:stream=codec_name,profile,width,height,r_frame_rate:stream_tags=encoder:frame=pict_type',
    '-read_intervals', `%+#${sample}`,
    file,
  ]);
  const [gate] = await moovGate([file], { node: o.node });
  const boxOrder = gate?.boxes ?? [];
  const base = {
    boxOrder,
    fragmented: boxOrder.includes('moof'),
    moovVerdict: gate?.verdict ?? 'unreadable',
  };
  if (code !== 0 && stdout.length === 0) {
    // ffprobe could not read the file at all. The box walk above still stands.
    void stderr;
    return { ...base, codec: null, profile: null, encoderTag: null, width: null, height: null, frameRate: null, gop: null };
  }
  let json: ProbeJson = {};
  try {
    json = JSON.parse(stdout.toString('utf8')) as ProbeJson;
  } catch {
    json = {};
  }
  const stream = json.streams?.[0];
  const types = (json.frames ?? []).map((f) => f.pict_type ?? '?');
  const keys = types.map((t, i) => (t === 'I' ? i : -1)).filter((i) => i >= 0);
  const gop = keys.length >= 2 ? keys[1]! - keys[0]! : null;
  const encoderTag = json.format?.tags?.['encoder'] ?? stream?.tags?.['encoder'] ?? null;
  return {
    ...base,
    codec: stream?.codec_name ?? null,
    profile: stream?.profile ?? null,
    encoderTag,
    width: stream?.width ?? null,
    height: stream?.height ?? null,
    frameRate: stream?.r_frame_rate ?? null,
    gop,
  };
}

export type EncoderProfile = {
  /** The first boxes of the file, in order. `['ftyp', 'moov']` on the pilot firmware. */
  box_order?: string[] | null;
  fragmented?: boolean | null;
  codec?: string | null;
  encoder_tag?: string | null;
  gop?: number | null;
};

/** Every way the observed file differs from the profile. Empty means it matches on everything the profile states. */
export function encoderMismatches(observed: EncoderProbe, profile: EncoderProfile): string[] {
  const out: string[] = [];
  if (Array.isArray(profile.box_order) && profile.box_order.length > 0) {
    const head = observed.boxOrder.slice(0, profile.box_order.length);
    if (head.join(' ') !== profile.box_order.join(' ')) {
      out.push(`box order ${observed.boxOrder.join(' ') || '(none)'} instead of ${profile.box_order.join(' ')}…`);
    }
  }
  if (typeof profile.fragmented === 'boolean' && observed.fragmented !== profile.fragmented) {
    out.push(profile.fragmented ? 'not a fragmented MP4' : 'a fragmented MP4');
  }
  if (typeof profile.codec === 'string' && observed.codec !== null && observed.codec !== profile.codec) {
    out.push(`codec ${observed.codec} instead of ${profile.codec}`);
  }
  if (typeof profile.encoder_tag === 'string' && (observed.encoderTag ?? '') !== profile.encoder_tag) {
    out.push(`encoder tag ${observed.encoderTag ?? '(none)'} instead of ${profile.encoder_tag}`);
  }
  if (typeof profile.gop === 'number' && observed.gop !== null && observed.gop !== profile.gop) {
    out.push(`key frame every ${observed.gop} frames instead of ${profile.gop}`);
  }
  return out;
}
