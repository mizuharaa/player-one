import { logoPieces } from './logoPieces';

export const MOTION_FAMILIES = ['stems', 'curves', 'crossbars', 'connectors', 'anchors'] as const;
export type MotionFamily = typeof MOTION_FAMILIES[number];
export type PiecePose = { x: number; y: number; rotation: number; scale: number };
export type MotionWaypoint = PiecePose & { time: number };
export type PieceMotion = { id: string; family: MotionFamily; waypoints: MotionWaypoint[] };

export const LOGO_ASSEMBLED_AT = .9;
export const LOGO_DURATION = 1.5;
export const familyForPiece = (id: string): MotionFamily => {
  if (id.startsWith('lens')) return 'anchors';
  if (/stem|upper|lower|leg/.test(id)) return 'stems';
  if (/bar/.test(id)) return 'crossbars';
  if (/tail|shoulder|y-/.test(id)) return 'connectors';
  return 'curves';
};

/** A glyph register changes through three short spatial substitutions. All
 * fragments retain their native orientation: no flipping, swinging or orbit.
 * A permutation spreads changes across the entire word, never left to right. */
export function choreographyForPiece(id: string, _cx: number, _cy: number): PieceMotion {
  const index = logoPieces.findIndex(piece => piece.id === id);
  if (index < 0) throw new Error(`Unknown logo fragment: ${id}`);
  const family = familyForPiece(id);
  const slot = (index * 13 + 7) % 31;
  const phase = (slot % 5) * .011;
  const sign = slot % 2 ? -1 : 1;
  const anchor = family === 'anchors';
  const pose = (time: number, x: number, y: number, scale = 1): MotionWaypoint =>
    ({ time, x, y, rotation: 0, scale });
  const width = anchor ? 4 : family === 'stems' ? 12 : 18;
  const row = anchor ? 0 : (slot % 3 - 1) * 16;
  const initialScale = anchor ? 1 : family === 'stems' ? .9 : .64;
  // Each piece traverses its registers toward alignment without reversing.
  // Different curve/stem sizes change the partial glyph silhouette as they pass.
  return { id, family, waypoints: [
    pose(0, sign * width, row, initialScale),
    pose(.065 + phase, sign * width, row, initialScale),
    pose(.24 + phase, sign * width * .7, row * .65, anchor ? 1 : Math.max(initialScale, .78)),
    pose(.41 + phase, sign * width * .35, row * .3, anchor ? 1 : .92),
    pose(.57 + phase, sign * width * .12, row * .1, anchor ? 1 : .98),
    pose(.77 + phase, 0, 0),
    pose(LOGO_ASSEMBLED_AT, 0, 0),
  ] };
}

const channels = ['x', 'y', 'rotation', 'scale'] as const;

/** Monotone cubic Hermite interpolation: adjacent intervals share a tangent,
 * and a channel never overshoots its two authored register values. This keeps
 * the scramble crisp without a steps() discontinuity or swinging correction. */
export function sampleChoreography(waypoints: readonly MotionWaypoint[], time: number): PiecePose {
  if (waypoints.length < 2) throw new Error('A logo trajectory requires at least two waypoints');
  let index = 0;
  while (index < waypoints.length - 2 && time > waypoints[index + 1]!.time) index++;
  const a = waypoints[index]!;
  const b = waypoints[index + 1]!;
  const span = b.time - a.time;
  const u = Math.max(0, Math.min(1, (time - a.time) / span));
  const u2 = u * u;
  const u3 = u2 * u;
  const pose = {} as PiecePose;
  for (const channel of channels) {
    const tangent = (at: number) => {
      if (at === 0 || at === waypoints.length - 1) return 0;
      const before = waypoints[at - 1]!;
      const current = waypoints[at]!;
      const after = waypoints[at + 1]!;
      const leftSpan = current.time - before.time;
      const rightSpan = after.time - current.time;
      const left = (current[channel] - before[channel]) / leftSpan;
      const right = (after[channel] - current[channel]) / rightSpan;
      if (left * right <= 0) return 0;
      const w1 = 2 * rightSpan + leftSpan;
      const w2 = rightSpan + 2 * leftSpan;
      return (w1 + w2) / (w1 / left + w2 / right);
    };
    pose[channel] = (2 * u3 - 3 * u2 + 1) * a[channel]
      + (u3 - 2 * u2 + u) * tangent(index) * span
      + (-2 * u3 + 3 * u2) * b[channel]
      + (u3 - u2) * tangent(index + 1) * span;
  }
  return pose;
}
