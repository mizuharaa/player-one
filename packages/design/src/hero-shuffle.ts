export const HERO_TEXT = 'PLAYER ONE';
export const HERO_DURATION = 2300;
export const HERO_LOCKS = [670, 805, 925, 1060, 1215, 1350, 1480, 1590, 1750] as const;
const letters = HERO_TEXT.replace(' ', '');
const offsets = [0, 19, 37, 11, 29, 43, 7, 23, 41];

/** One deterministic clock; character schedules are independent, not timers. */
export const heroCharacters = [...letters].map((correct, index) => {
  const lock = HERO_LOCKS[index]!;
  const updates: {at: number; glyph: string}[] = [];
  let at = 0;
  let tick = 0;
  while (at < lock) {
    let code = (index * 11 + tick * 7 + 3) % 26;
    if (String.fromCharCode(65 + code) === correct) code = (code + 1) % 26;
    updates.push({at, glyph: String.fromCharCode(65 + code)});
    const cadence = at >= lock - 230 ? 80 + (index * 7 + tick * 3) % 31 : 45 + (index * 3 + tick * 7) % 21;
    at += tick === 0 ? 45 + offsets[index]! % 21 : cadence;
    tick++;
  }
  return {correct, lock, updates};
});

export function sampleHeroCharacter(index: number, elapsed: number) {
  const character = heroCharacters[index]!;
  const locked = elapsed >= character.lock;
  let glyph = character.updates[0]!.glyph;
  for (const update of character.updates) {
    if (update.at > elapsed) break;
    glyph = update.glyph;
  }
  const progress = Math.min(1, Math.max(0, (elapsed - character.lock) / 120));
  return {glyph: locked ? character.correct : glyph, locked,
    y: locked ? 3 * (1 - progress) ** 4 : 0};
}
