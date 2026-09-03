import { describe, expect, it } from 'vitest';
import {
  dark,
  darkBrandTints,
  light,
  onSun,
  onTech,
  rejectInk,
  stage,
  sun,
  tech,
  verdict,
} from '../src/tokens.ts';

/**
 * The accessibility floor, computed rather than asserted by eye.
 *
 * `DESIGN.md` holds this project to WCAG 2.2 AA contrast in both themes, and a
 * colour pair is the one design decision a typecheck, a screenshot and a human
 * reviewer all fail to catch — the screenshot looks fine to whoever took it.
 * Three of these pairs were shipping below the floor before this file existed:
 * white on `sun[500]` at 2.61:1, and both `faintForeground` steps between 2.62
 * and 3.79 while carrying 12–13px labels.
 *
 * Only ratios that hold for **normal-size text** are asserted here (4.5:1),
 * because everything in this list renders at 11–15px. AA's 3:1 allowance is for
 * text at 18.66px bold or 24px plain and nothing here is either.
 *
 * Runs with no database and no browser: it is arithmetic over `tokens.ts`.
 */

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance of an opaque `#rrggbb`. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * linear((n >> 16) & 255) + 0.7152 * linear((n >> 8) & 255) + 0.0722 * linear(n & 255)
  );
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const AA = 4.5;

describe('the pairs that carry text meet WCAG 2.2 AA', () => {
  /**
   * `sun` and `tech` do not invert between schemes, so their ink cannot either
   * — and they do not agree on what that ink is. White on `sun[500]` is 2.61:1
   * and fails; white on `tech[500]` is 4.59:1 and passes. One token for both
   * would have to fail one of them.
   */
  it.each([
    ['ink on the sun ramp', onSun, sun[500]],
    ['ink on the tech ramp', onTech, tech[500]],
  ])('%s', (_name, ink, fill) => {
    expect(contrast(ink, fill)).toBeGreaterThanOrEqual(AA);
  });

  /**
   * `faintForeground` is the smallest type on the product — Home's figure
   * notes, the pipeline stage numbers, the declaration heading — so it is
   * checked against every ground it can land on rather than just the card.
   */
  const grounds = {
    light: [light.background, light.surface, light.card, light.muted],
    dark: [dark.background, dark.surface, dark.card, dark.muted],
  };

  it.each([
    ...grounds.light.map((g) => ['light faint', light.faintForeground, g] as const),
    ...grounds.light.map((g) => ['light muted', light.mutedForeground, g] as const),
    ...grounds.light.map((g) => ['light body', light.foreground, g] as const),
    ...grounds.dark.map((g) => ['dark faint', dark.faintForeground, g] as const),
    ...grounds.dark.map((g) => ['dark muted', dark.mutedForeground, g] as const),
    ...grounds.dark.map((g) => ['dark body', dark.foreground, g] as const),
  ])('%s on %s', (_name, ink, ground) => {
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(AA);
  });

  /**
   * The theatre is judged as strictly as the shell. A reviewer reads the
   * playhead clock and the transport labels against near-black while deciding
   * `VQ-DARK`, so those two are text like any other.
   */
  it.each([
    ['stage body on the ground', stage.fg, stage.ground],
    ['stage body on a panel', stage.fg, stage.panel],
    ['stage secondary on the ground', stage.mid, stage.ground],
    ['stage secondary on a panel', stage.mid, stage.panel],
  ])('%s', (_name, ink, ground) => {
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(AA);
  });

  /**
   * The verdict tints carry ordinary ink, not their own hue.
   *
   * This is the measurement behind that decision, kept as a test so the pills
   * cannot quietly go back: `--pass` on `--pass-bg` is 3.06:1, `--reject` 3.43
   * and `--partial` 3.81, at 11–13px. The three hues are fixed by DESIGN.md and
   * no lighter tint rescues them — `#12A150` cannot reach 4.5:1 against white
   * itself — so the hue stays on the glyph and the border, where contrast is a
   * 3:1 non-text requirement it does meet, and the word is `foreground`.
   */
  it.each(['pass', 'partial', 'reject'] as const)('%s reads as neutral ink on its tint', (name) => {
    expect(contrast(light.foreground, verdict[name].bg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(dark.foreground, verdict[name].bgDark)).toBeGreaterThanOrEqual(AA);

    /** The hue against the same tint is a non-text contrast: the glyph's shape. */
    expect(contrast(verdict[name].fg, verdict[name].bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(verdict[name].fg, verdict[name].bgDark)).toBeGreaterThanOrEqual(3);
  });

  /**
   * The two tinted chips in the top bar, in both schemes.
   *
   * `sun-50` and `tech-50` are the only brand steps that invert, and their ink
   * cannot follow them: `sun-700` on the *dark* `sun-50` measures 3.32:1 and
   * `tech-700` on the dark `tech-50` measures 1.80:1 — the operator reading
   * their own initials off their own chip, and the label of the screen they
   * are on. Both are 12–13px. So the dark scheme steps up the ramp instead,
   * and this is the pair of assertions that keeps it doing that: the classes
   * are `dark:text-[var(--sun-300)]` in `PillNav` and `dark:text-[var(--tech-200)]`
   * in `AppShell`, and neither is visible to a typecheck.
   */
  it.each([
    ['active nav pill, light', sun[700], sun[50]],
    ['active nav pill, dark', sun[300], darkBrandTints.sun50],
    ['operator initials, light', tech[700], tech[50]],
    ['operator initials, dark', tech[200], darkBrandTints.tech50],
  ])('%s', (_name, ink, ground) => {
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(AA);
  });

  /**
   * Tech blue as *text*: every link on the shell, and the `data` tone on a
   * metadata row — the collector's name on the review rail is one.
   */
  it.each([
    ...[light.card, light.background, light.surface, light.muted].map(
      (g) => ['light data ink', tech[600], g] as const,
    ),
    ...[dark.card, dark.background, dark.surface, dark.muted].map(
      (g) => ['dark data ink', tech[300], g] as const,
    ),
  ])('%s on %s', (_name, ink, ground) => {
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(AA);
  });

  /**
   * Named so the next person does not rediscover it: these three still fail as
   * *text* and are deliberately not used as text anywhere. If a screen ever
   * prints a word in a verdict hue on a light card, this is the number it will
   * be doing it at.
   */
  it('records the pairs that are still below the floor as text', () => {
    expect(contrast(verdict.reject.fg, light.card)).toBeLessThan(AA);
    expect(contrast(verdict.pass.fg, light.card)).toBeLessThan(AA);
  });

  /**
   * And the token that exists because of the line above.
   *
   * Warnings on this product are sentences, not verdicts: "a rejection must
   * name at least one reason", the claimed-versus-measured discrepancy, a
   * failed write, a lease running out. Those wear `rejectInk` rather than
   * `verdict.reject.fg`, and this is the assertion that keeps the distinction
   * real — including on the reject tint itself, which is the ground the reason
   * warnings land on.
   */
  it.each([
    ['light', rejectInk.light, [light.card, light.background, light.surface, light.muted, verdict.reject.bg]],
    ['dark', rejectInk.dark, [dark.card, dark.background, dark.surface, dark.muted, verdict.reject.bgDark]],
  ] as const)('reject ink reads as a warning sentence in %s', (_scheme, ink, grounds) => {
    for (const ground of grounds) {
      expect(contrast(ink, ground)).toBeGreaterThanOrEqual(AA);
    }
  });
});
