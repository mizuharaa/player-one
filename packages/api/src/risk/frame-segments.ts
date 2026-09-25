import { hamming } from '../../../../tools/analysers/frames.ts';

export const SEGMENT_MATCH_VERSION = 'segment-v1';
export const MIN_MATCHING_FRAMES = 20;
export const MIN_DISTINCT_FRAMES = 8;
export const MAX_FINGERPRINT_FRAMES = 14_400;
const MAX_HAMMING = 6;
const MAX_STEP = 8;
const MIN_SEGMENT_DENSITY = 0.5;
const HASH = /^[0-9a-f]{16}$/i;

/** Flat/near-flat hashes are shared by unrelated footage and cannot be anchors. */
export function informativeFrameHash(hash: string): boolean {
  if (!HASH.test(hash) || new Set(hash.toLowerCase().match(/../g)).size < 3) return false;
  const bits = hamming(hash, '0000000000000000');
  return bits > 4 && bits < 60;
}

export type FingerprintCheck = {
  complete: boolean;
  reason?: 'invalid_fingerprint' | 'insufficient_samples' | 'low_information' | 'budget_exceeded';
};
export type FrameSegment = {
  /** Half-open sample indices, not seconds. Candidate indices stay in original order. */
  qStart: number; qEnd: number; cStart: number; cEnd: number;
  scale: number; reversed: boolean; mirrored: boolean; score: number;
  matchingFrames: number; distinctFrames: number;
};
export type SegmentMatch = FingerprintCheck & { segments: FrameSegment[] };

/** An 8x8 aHash stores each spatial row in one byte. */
export function mirrorFrameHash(hash: string): string {
  if (!HASH.test(hash)) throw new Error('invalid frame fingerprint');
  return hash.match(/../g)!.map((byte) => {
    let n = parseInt(byte, 16);
    n = ((n & 0x55) << 1) | ((n >>> 1) & 0x55);
    n = ((n & 0x33) << 2) | ((n >>> 2) & 0x33);
    n = (n << 4) | (n >>> 4);
    return (n & 255).toString(16).padStart(2, '0');
  }).join('');
}

function tokens(hash: string): string[] {
  const out: string[] = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    // Fits integer[]; policy version belongs to the index row, not every posting.
    out.push(String((a * 8 + b) * 65536 + parseInt(hash.slice(a * 2, a * 2 + 2) + hash.slice(b * 2, b * 2 + 2), 16)));
  }
  return out;
}

/** <=6 changed bits leave at least two of eight bytes unchanged: one shared token. */
export function fingerprintIndexKeys(hashes: readonly string[], o: { mirrored?: boolean } = {}): string[] {
  if (hashes.length > MAX_FINGERPRINT_FRAMES || hashes.some((h) => !HASH.test(h))) throw new Error('invalid frame fingerprint');
  return [...new Set(hashes.filter(informativeFrameHash).flatMap((h) => tokens(o.mirrored ? mirrorFrameHash(h) : h.toLowerCase())))].sort();
}

function distinctCount(hashes: readonly string[]): number {
  const distinct: string[] = [];
  for (const hash of hashes) {
    if (distinct.every((h) => hamming(hash, h) > MAX_HAMMING)) distinct.push(hash);
    if (distinct.length >= MIN_DISTINCT_FRAMES) break;
  }
  return distinct.length;
}

export function validateFingerprint(hashes: readonly string[]): FingerprintCheck {
  if (hashes.length > MAX_FINGERPRINT_FRAMES) return { complete: false, reason: 'budget_exceeded' };
  if (hashes.some((h) => !HASH.test(h))) return { complete: false, reason: 'invalid_fingerprint' };
  if (hashes.length < MIN_MATCHING_FRAMES) return { complete: false, reason: 'insufficient_samples' };
  const eligible = hashes.filter(informativeFrameHash);
  if (eligible.length < MIN_MATCHING_FRAMES || distinctCount(eligible) < MIN_DISTINCT_FRAMES) return { complete: false, reason: 'low_information' };
  return { complete: true };
}

/**
 * Indexed near-frame lookup followed by bounded local monotonic chains. These
 * are suspected reuse segments, never a fraud verdict or proof of originality.
 * ponytail: 8-sample gaps/steps and bounded candidate work cover the pilot;
 * crops, overlays, shorter fragments and extreme edits need calibrated features.
 */
export function matchFrameSegments(
  query: readonly string[], candidate: readonly string[],
  o: { maxHamming?: number; maxComparisons?: number; maxPairs?: number } = {},
): SegmentMatch {
  const maxHamming = o.maxHamming ?? MAX_HAMMING;
  const maxComparisons = o.maxComparisons ?? 1_000_000;
  const maxPairs = o.maxPairs ?? 100_000;
  if (!Number.isInteger(maxHamming) || maxHamming < 0 || maxHamming > MAX_HAMMING ||
      !Number.isSafeInteger(maxComparisons) || maxComparisons < 1 || maxComparisons > 1_000_000 ||
      !Number.isSafeInteger(maxPairs) || maxPairs < 1 || maxPairs > 100_000) {
    return { complete: false, reason: 'invalid_fingerprint', segments: [] };
  }
  for (const fp of [query, candidate]) {
    const check = validateFingerprint(fp);
    if (!check.complete) return { ...check, segments: [] };
  }
  const index = new Map<string, number[]>();
  candidate.forEach((hash, j) => {
    if (!informativeFrameHash(hash)) return;
    for (const token of tokens(hash.toLowerCase())) {
      const bucket = index.get(token);
      if (bucket) bucket.push(j); else index.set(token, [j]);
    }
  });
  let comparisons = 0;
  let pairCount = 0;
  const segments: FrameSegment[] = [];
  for (const mirrored of [false, true]) {
    const q = mirrored ? query.map(mirrorFrameHash) : query;
    const pairs: number[][] = [];
    for (const hash of q) {
      if (!informativeFrameHash(hash)) { pairs.push([]); continue; }
      const seen = new Set<number>();
      const near: number[] = [];
      for (const token of tokens(hash.toLowerCase())) for (const j of index.get(token) ?? []) {
        // Count bucket visits too: repeated/flat hashes cannot create unbounded work.
        if (++comparisons > maxComparisons) return { complete: false, reason: 'budget_exceeded', segments };
        if (seen.has(j)) continue;
        seen.add(j);
        if (hamming(hash, candidate[j]!) <= maxHamming) {
          if (++pairCount > maxPairs) return { complete: false, reason: 'budget_exceeded', segments };
          near.push(j);
        }
      }
      pairs.push(near);
    }
    for (const reversed of [false, true]) {
      type Node = { i: number; j: number; count: number; prev: Node | null };
      const rows: Map<number, Node>[] = [];
      const ends: Node[] = [];
      for (let i = 0; i < pairs.length; i++) {
        const row = new Map<number, Node>();
        for (const originalJ of pairs[i]!) {
          const j = reversed ? candidate.length - 1 - originalJ : originalJ;
          let prev: Node | null = null;
          for (let di = 1; di <= MAX_STEP && di <= i; di++) {
            for (let dj = 1; dj <= MAX_STEP && dj <= j; dj++) {
              const p = rows[i - di]?.get(j - dj);
              if (p && (!prev || p.count > prev.count)) prev = p;
            }
          }
          const node: Node = { i, j, count: (prev?.count ?? 0) + 1, prev };
          row.set(j, node);
          if (node.count >= MIN_MATCHING_FRAMES) ends.push(node);
        }
        rows.push(row);
        if (i >= MAX_STEP) rows[i - MAX_STEP] = new Map();
      }
      ends.sort((a, b) => b.count - a.count || b.i - a.i);
      for (const end of ends) {
        // One maximal chain per overlapping query region is enough evidence.
        if (segments.some((s) => end.i >= s.qStart && end.i < s.qEnd)) continue;
        const chain: Node[] = [];
        for (let n: Node | null = end; n; n = n.prev) {
          if (++comparisons > maxComparisons) return { complete: false, reason: 'budget_exceeded', segments };
          chain.push(n);
        }
        const first = chain.at(-1)!;
        if (segments.some((s) => first.i < s.qEnd && end.i >= s.qStart)) continue;
        const qSpan = end.i - first.i + 1;
        const cSpan = end.j - first.j + 1;
        const score = end.count / Math.min(qSpan, cSpan);
        if (score < MIN_SEGMENT_DENSITY) continue;
        const distinctFrames = distinctCount(chain.map((n) => q[n.i]!));
        if (distinctFrames < MIN_DISTINCT_FRAMES) continue;
        segments.push({
          qStart: first.i, qEnd: end.i + 1,
          cStart: reversed ? candidate.length - 1 - end.j : first.j,
          cEnd: reversed ? candidate.length - first.j : end.j + 1,
          scale: cSpan / qSpan, reversed, mirrored, score,
          matchingFrames: end.count, distinctFrames,
        });
      }
    }
  }
  return { complete: true, segments };
}
