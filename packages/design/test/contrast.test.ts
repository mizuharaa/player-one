import { describe, expect, it } from 'vitest';
import { bamboo, dark, darkBrandTints, light, ring, stage, sun, tech, toCss, verdict } from '../src/tokens.ts';
import { nativeTheme } from '../src/native.ts';

/**
 * The contrast the tokens are allowed to have, measured rather than commented.
 *
 * Every ratio in this file was measured before it was asserted, and the ones
 * that failed are named in the cases below with the number they failed at.
 * Until now the ratios lived only in prose in `tokens.ts`, which is why three
 * verdict pills, two collector-app surfaces and the focus ring were all under
 * the floor at once and nothing said so.
 *
 * Two floors, both from WCAG 2.1:
 *
 * - **4.5:1 for text** (1.4.3 AA). Everything here is small text: a pill label,
 *   a gate sentence, a rejection reason. None of it reaches the 18.66px-bold /
 *   24px "large text" exemption, so 3:1 does not apply to any of it.
 * - **3:1 for a control boundary** (1.4.11). That is the focus ring, and §6.6
 *   makes it load-bearing: a review has to be completable with no pointer.
 *
 * The formula is sRGB relative luminance, straight out of the specification.
 * No library, because the whole of it is the ten lines below and a dependency
 * here would be a dependency in the one package three surfaces import.
 */

const TEXT_AA = 4.5;
const CONTROL_AA = 3;

const channels = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  expect(h, `${hex} is not a six-digit hex colour`).toMatch(/^[0-9a-fA-F]{6}$/);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
};

/** WCAG 2.1 relative luminance. */
const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

export const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Rounded the way a reporting tool rounds, so a failure prints a comparable number. */
const ratio = (a: string, b: string): number => Math.round(contrast(a, b) * 100) / 100;

/**
 * The floor is compared against the UNROUNDED ratio. `#746F66` on the muted
 * fill measured 4.49999:1, which `ratio` prints as 4.5 and which is under the
 * floor; a check on the rounded figure passed it. The rounded figure is still
 * what a failure prints, because that is the number a reporting tool shows.
 */
const atLeast = (floor: number, ink: string, ground: string, what: string) =>
  expect(contrast(ink, ground), `${what}: ${ink} on ${ground} = ${ratio(ink, ground)}`).toBeGreaterThanOrEqual(floor);

describe('the formula itself', () => {
  /**
   * A contrast test that measures wrongly passes everything, so the two ends
   * of the scale are pinned before anything is judged with it.
   */
  it('reads 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(ratio('#000000', '#FFFFFF')).toBe(21);
    expect(ratio('#FFFFFF', '#000000')).toBe(21);
    expect(ratio('#12A150', '#12A150')).toBe(1);
  });

  /** And it reproduces the three numbers this file was written to fix. */
  it('reproduces the ratios that were measured before the fix', () => {
    // The verdict inks that shipped, on their own light fills.
    expect(ratio('#12A150', '#E8F8EE')).toBe(3.06);
    expect(ratio('#7C5CFC', '#F0EDFF')).toBe(3.81);
    expect(ratio('#E5484D', '#FDECEC')).toBe(3.43);
    // The collector app's Note, and its upload pills, in dark mode.
    expect(ratio('#0B3F99', darkBrandTints.tech50)).toBe(1.8);
    expect(ratio('#0B3F99', darkBrandTints.tech100)).toBe(1.35);
    // The focus ring on the light shell.
    expect(ratio(sun[500], light.background)).toBe(2.61);
  });
});

/**
 * §6.9's three outcomes. This is the axis `tokens.ts` itself says decides
 * whether a collector is paid, and a misread pill is a misread verdict.
 *
 * Each ink is checked against three grounds and not just its own fill: the
 * pill fill, the card the pill sits on, and the page behind the card — because
 * the same token is used as plain text on both (`text-[var(--reject)]` on the
 * review screen's error line, on the mark hint, on the reason list).
 */
describe('verdict pills clear AA in both themes', () => {
  for (const [name, v] of Object.entries(verdict)) {
    it(`${name}, light`, () => {
      atLeast(TEXT_AA, v.fg, v.bg, `${name} on its own fill`);
      atLeast(TEXT_AA, v.fg, light.card, `${name} on the card`);
      atLeast(TEXT_AA, v.fg, light.background, `${name} on the page`);
      atLeast(TEXT_AA, v.fg, light.muted, `${name} on the muted fill`);
    });

    it(`${name}, dark`, () => {
      atLeast(TEXT_AA, v.fgDark, v.bgDark, `${name} on its own fill`);
      atLeast(TEXT_AA, v.fgDark, dark.card, `${name} on the card`);
      atLeast(TEXT_AA, v.fgDark, dark.background, `${name} on the page`);
      atLeast(TEXT_AA, v.fgDark, dark.muted, `${name} on the muted fill`);
    });
  }

  /**
   * The hue is the promise the two inks make to each other. A future edit that
   * fixes a ratio by turning the reject ink orange would pass every assertion
   * above and break the rule `tokens.ts` states first: the verdicts own their
   * hues and the sun ramp is never one of them.
   */
  it('keeps each verdict on one hue across the two schemes', () => {
    const hue = (hex: string): number => {
      const [r, g, b] = channels(hex);
      const max = Math.max(r!, g!, b!);
      const d = max - Math.min(r!, g!, b!);
      if (d === 0) return 0;
      const h =
        max === r! ? (g! - b!) / d + (g! < b! ? 6 : 0) : max === g! ? (b! - r!) / d + 2 : (r! - g!) / d + 4;
      return Math.round((h * 60 + 360) % 360);
    };
    for (const [name, v] of Object.entries(verdict)) {
      expect(Math.abs(hue(v.fg) - hue(v.fgDark)), `${name} changes hue between schemes`).toBeLessThanOrEqual(2);
    }
    expect(new Set(Object.values(verdict).map((v) => hue(v.fg))).size).toBe(3);
    // And none of them is the sun, whose ramp sits between 20° and 30°.
    for (const [name, v] of Object.entries(verdict)) {
      expect(hue(v.fg), `${name} is in the sun ramp's hue range`).not.toBeLessThan(40);
    }
  });
});

/**
 * The hue of a colour, 0–360. Lifted out of the verdict block below because
 * bamboo's whole risk is a hue and not a ratio: lime sits near enough to the
 * pass green that a ring drawn in it could be read as "passed", which is why
 * the gap between them is asserted rather than eyeballed.
 */
const hue = (hex: string): number => {
  const [r, g, b] = channels(hex);
  const max = Math.max(r!, g!, b!);
  const d = max - Math.min(r!, g!, b!);
  if (d === 0) return 0;
  const h =
    max === r! ? (g! - b!) / d + (g! < b! ? 6 : 0) : max === g! ? (b! - r!) / d + 2 : (r! - g!) / d + 4;
  return Math.round((h * 60 + 360) % 360);
};

/**
 * Bamboo — the mascot and progress — and the sun button it must never be
 * confused with.
 *
 * Every number in a test name below was measured by running this file, not
 * copied from a comment. Three steps of the ramp carry a job and the other
 * five are there so a fill has somewhere to go; the jobs are what is pinned:
 *
 * - 500 is a fill and only a fill.
 * - 600 is a stroke on the light page and text on the dark one.
 * - 700 is text on the light page.
 *
 * The exclusions — never a verdict pill, a verdict glyph, a payment-status
 * label or a money figure — are stated in `tokens.ts` and cannot be measured
 * here. What can be measured is the reason for them, and that is the last case.
 */
describe('bamboo', () => {
  it('500 is a fill under ink text, at 10.02:1, and is never text itself (1.82:1 on white)', () => {
    atLeast(TEXT_AA, light.foreground, bamboo[500], 'ink on the bamboo fill');
    expect(ratio(light.foreground, bamboo[500])).toBe(10.02);
    // The other direction is the mistake this case exists to keep out.
    expect(ratio(bamboo[500], light.background)).toBe(1.82);
    expect(ratio(bamboo[500], light.background)).toBeLessThan(CONTROL_AA);
  });

  it('600 is the ring stroke: 3.34:1 on the page, 3.20:1 on the surface, 3.01:1 on the muted track', () => {
    for (const ground of [light.background, light.surface, light.card, light.muted])
      atLeast(CONTROL_AA, bamboo[600], ground, 'gauge ring');
    expect(ratio(bamboo[600], light.background)).toBe(3.34);
    expect(ratio(bamboo[600], light.surface)).toBe(3.2);
    // ★★ pinned: the gauge's track is `--muted` flat, with no opacity or blend
    // under the arc. A track that is anything else invalidates this number.
    expect(ratio(bamboo[600], light.muted)).toBe(3.01);
  });

  it('600 is text ink on the dark page, at 5.71:1', () => {
    for (const ground of [dark.background, dark.surface, dark.card, dark.muted])
      atLeast(TEXT_AA, bamboo[600], ground, 'bamboo text, dark');
    expect(ratio(bamboo[600], dark.background)).toBe(5.71);
  });

  it('700 is text ink on the light page, at 6.08:1, and on its own tints at 5.76 / 5.39:1', () => {
    for (const ground of [light.background, light.surface, light.card, light.muted])
      atLeast(TEXT_AA, bamboo[700], ground, 'bamboo text, light');
    expect(ratio(bamboo[700], light.background)).toBe(6.08);
    atLeast(TEXT_AA, bamboo[700], bamboo[50], 'bamboo text on its lightest tint');
    expect(ratio(bamboo[700], bamboo[50])).toBe(5.76);
    expect(ratio(bamboo[700], bamboo[100])).toBe(5.39);
  });

  it('the dark tints invert like sun and tech, and bamboo[200] reads on them at 13.00 / 9.51:1', () => {
    atLeast(TEXT_AA, bamboo[200], darkBrandTints.bamboo50, 'dark-scheme bamboo tint');
    atLeast(TEXT_AA, bamboo[200], darkBrandTints.bamboo100, 'dark-scheme bamboo tint');
    expect(ratio(bamboo[200], darkBrandTints.bamboo50)).toBe(13);
    expect(ratio(bamboo[200], darkBrandTints.bamboo100)).toBe(9.51);
  });

  it('the native theme resolves bamboo and bambooInk in both schemes', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = nativeTheme(scheme);
      atLeast(TEXT_AA, theme.color.bambooInk, theme.color.bamboo[50], 'bamboo caption');
      atLeast(TEXT_AA, theme.color.bambooInk, theme.color.bamboo[100], 'bamboo progress label');
    }
  });

  /**
   * The one that matters most. A progress arc in bamboo sits on the same
   * screens as a pass pill, and if the two hues converge the arc starts
   * meaning "paid". 67° is the measured gap; the floor is 40° because that is
   * roughly where two fills stop being tellable apart at pill size.
   */
  it('sits 67° from the pass verdict, and every step of the ramp is at least 40° away', () => {
    expect(hue(verdict.pass.fg)).toBe(146);
    expect(hue(bamboo[600])).toBe(79);
    expect(146 - hue(bamboo[600])).toBe(67);
    for (const [step, hex] of Object.entries(bamboo)) {
      const gap = Math.abs(hue(verdict.pass.fg) - hue(hex));
      expect(gap, `bamboo[${step}] is ${gap}° from the pass verdict`).toBeGreaterThanOrEqual(40);
      const gapDark = Math.abs(hue(verdict.pass.fgDark) - hue(hex));
      expect(gapDark, `bamboo[${step}] is ${gapDark}° from the dark pass verdict`).toBeGreaterThanOrEqual(40);
    }
  });
});

/**
 * `--sun-ink` and `--tech-ink`: the other two per-scheme brand inks.
 *
 * The bug they close is `bambooInk`'s and `techInk`'s, one ramp later. The two
 * lowest steps of sun and tech invert in dark mode (`darkBrandTints`) and the
 * 700 steps do not, so a label written as `tech-700` on `tech-50` is a fixed
 * dark ink on a fill that went dark under it. Measured before the fix, in the
 * DARK scheme:
 *
 * - the risk band and the payout attempt pills — `tech-700` on `tech-50` — 1.80:1
 * - Home's needs-a-human strip — `sun-700` on `sun-50` — 3.32:1, and 2.87:1
 *   on the `sun-100` the strip took on hover
 * - every link and every `data`-toned figure — `tech-600` on the card — 2.63:1
 *
 * The last one is the same bug on the neutral ground rather than the tint, so
 * one token carries both: the ink is checked here against the tint it labels
 * AND against the four shell surfaces, in both schemes.
 */
describe('the sun and tech inks read in both schemes', () => {
  /** What each scheme's `--sun-ink` / `--tech-ink` resolves to, from `toCss`. */
  const INK = {
    light: { sun: sun[700], tech: tech[700] },
    dark: { sun: sun[200], tech: tech[200] },
  } as const;

  it('reproduces the four ratios that were measured before the fix', () => {
    expect(ratio(tech[700], darkBrandTints.tech50)).toBe(1.8);
    expect(ratio(sun[700], darkBrandTints.sun50)).toBe(3.32);
    expect(ratio(sun[700], darkBrandTints.sun100)).toBe(2.87);
    expect(ratio(tech[600], dark.card)).toBe(2.63);
    for (const bad of [
      ratio(tech[700], darkBrandTints.tech50),
      ratio(sun[700], darkBrandTints.sun50),
      ratio(sun[700], darkBrandTints.sun100),
      ratio(tech[600], dark.card),
    ])
      expect(bad).toBeLessThan(TEXT_AA);
  });

  it('light: on their own tints at 8.55 / 7.51 and 4.80, and on all four shell grounds', () => {
    atLeast(TEXT_AA, INK.light.tech, tech[50], 'risk band, notice');
    atLeast(TEXT_AA, INK.light.tech, tech[100], 'tech pill');
    expect(ratio(INK.light.tech, tech[50])).toBe(8.55);
    expect(ratio(INK.light.tech, tech[100])).toBe(7.51);

    atLeast(TEXT_AA, INK.light.sun, sun[50], 'needs-a-human strip');
    expect(ratio(INK.light.sun, sun[50])).toBe(4.8);

    for (const ground of [light.background, light.surface, light.card, light.muted]) {
      atLeast(TEXT_AA, INK.light.tech, ground, 'link');
      atLeast(TEXT_AA, INK.light.sun, ground, 'warn figure');
    }
    expect(ratio(INK.light.tech, light.background)).toBe(9.61);
    expect(ratio(INK.light.tech, light.muted)).toBe(8.67);
    expect(ratio(INK.light.sun, light.background)).toBe(5.19);
    expect(ratio(INK.light.sun, light.muted)).toBe(4.68);
  });

  it('dark: on the inverted tints at 10.08 / 7.53 and 11.63 / 10.04, and on all four shell grounds', () => {
    atLeast(TEXT_AA, INK.dark.tech, darkBrandTints.tech50, 'risk band, notice');
    atLeast(TEXT_AA, INK.dark.tech, darkBrandTints.tech100, 'tech pill');
    expect(ratio(INK.dark.tech, darkBrandTints.tech50)).toBe(10.08);
    expect(ratio(INK.dark.tech, darkBrandTints.tech100)).toBe(7.53);

    atLeast(TEXT_AA, INK.dark.sun, darkBrandTints.sun50, 'needs-a-human strip');
    atLeast(TEXT_AA, INK.dark.sun, darkBrandTints.sun100, 'sun pill');
    expect(ratio(INK.dark.sun, darkBrandTints.sun50)).toBe(11.63);
    expect(ratio(INK.dark.sun, darkBrandTints.sun100)).toBe(10.04);

    for (const ground of [dark.background, dark.surface, dark.card, dark.muted]) {
      atLeast(TEXT_AA, INK.dark.tech, ground, 'link');
      atLeast(TEXT_AA, INK.dark.sun, ground, 'warn figure');
    }
    expect(ratio(INK.dark.tech, dark.background)).toBe(11.08);
    expect(ratio(INK.dark.tech, dark.muted)).toBe(9.18);
    expect(ratio(INK.dark.sun, dark.background)).toBe(12.84);
    expect(ratio(INK.dark.sun, dark.muted)).toBe(10.64);
  });

  /**
   * The one pair on these two ramps that the ink does NOT clear, pinned so it
   * stays out of the markup. Home's needs-a-human strip took `sun-100` on
   * hover; the hover now moves the border and leaves the fill alone.
   */
  it('bars sun ink on sun-100 in the light scheme, at 4.27:1', () => {
    expect(ratio(INK.light.sun, sun[100])).toBe(4.27);
    expect(ratio(INK.light.sun, sun[100])).toBeLessThan(TEXT_AA);
  });

  it('is what `toCss` emits, per scheme, so the console reads these numbers', () => {
    const css = toCss();
    // The light block, once; the dark block twice — the media query and the
    // explicit `[data-theme='dark']`, which is why a hand-written
    // `:root[data-theme='dark']` override missed the operator on system dark.
    expect(css.match(new RegExp(`--sun-ink: ${INK.light.sun};`, 'g'))).toHaveLength(1);
    expect(css.match(new RegExp(`--tech-ink: ${INK.light.tech};`, 'g'))).toHaveLength(1);
    expect(css.match(new RegExp(`--sun-ink: ${INK.dark.sun};`, 'g'))).toHaveLength(2);
    expect(css.match(new RegExp(`--tech-ink: ${INK.dark.tech};`, 'g'))).toHaveLength(2);
  });
});

/**
 * The primary button.
 *
 * White on sun-500 is 2.61:1 and shipped that way; the label on the one action
 * a screen is asking for was under the floor. The ink is `light.foreground` in
 * both schemes, because the fill does not change with the scheme.
 */
describe('the primary action', () => {
  it('carries ink at 7.19:1 on sun-500, and never white at 2.61:1', () => {
    // `stage.ground` is the ink the button actually sets (`text-[var(--stage)]`
    // in button.tsx): it is the one near-black and it does not move with the
    // scheme, which `--foreground` does. On the same fill `light.foreground`
    // would read 7.00:1 — either clears AA; the component uses the stage one.
    atLeast(TEXT_AA, stage.ground, sun[500], 'primary label');
    expect(ratio(stage.ground, sun[500])).toBe(7.19);
    expect(ratio(light.foreground, sun[500])).toBe(7);
    expect(ratio('#FFFFFF', sun[500])).toBe(2.61);
    expect(ratio('#FFFFFF', sun[500])).toBeLessThan(TEXT_AA);
  });

  it('keeps its ink above AA through hover (8.58:1) and active (5.52:1)', () => {
    atLeast(TEXT_AA, stage.ground, sun[400], 'primary label, hover');
    expect(ratio(stage.ground, sun[400])).toBe(8.58);
    atLeast(TEXT_AA, stage.ground, sun[600], 'primary label, active');
    expect(ratio(stage.ground, sun[600])).toBe(5.52);
    // And why sun-700 is not one of the states: 3.61:1, under the text floor.
    expect(ratio(stage.ground, sun[700])).toBe(3.61);
  });
});

/**
 * The ink top bar: white type and a sun pill on `stage.ground`, in both
 * schemes. The bar is the same near-black as the theatre — one dark, reused.
 */
describe('the ink top bar', () => {
  it('white type at 100% and at 72% both clear AA on the ink ground', () => {
    atLeast(TEXT_AA, '#FFFFFF', stage.ground, 'active nav label');
    // 72% white over `stage.ground` composites to #BCBDBD.
    atLeast(TEXT_AA, '#BCBDBD', stage.ground, 'inactive nav label');
    expect(ratio('#BCBDBD', stage.ground)).toBe(9.96);
  });

  it('the active pill is sun-500 with ink on it, at 7.19:1', () => {
    atLeast(TEXT_AA, stage.ground, sun[500], 'active pill label');
    expect(ratio(stage.ground, sun[500])).toBe(7.19);
    // And the pill itself is tellable from the bar it sits on.
    atLeast(CONTROL_AA, sun[500], stage.ground, 'active pill boundary');
  });
});

/**
 * The collector app's two blue surfaces.
 *
 * `Note` carries the exam gate, the device gate, the agreements gate and a
 * rejected upload's reason — the one sentence that says why a collector cannot
 * work. The pill is the upload state. Both take their fill from `tech[50]` /
 * `tech[100]`, which invert in dark mode, so the ink has to invert with them.
 */
describe('the collector app reads in both schemes', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`Note and the upload pills, ${scheme}`, () => {
      // `techInk` is the value both components read, so reverting either of
      // them to `tech[700]` fails here rather than shipping.
      const theme = nativeTheme(scheme);
      atLeast(TEXT_AA, theme.color.techInk, theme.color.tech[50], 'Note');
      atLeast(TEXT_AA, theme.color.techInk, theme.color.tech[100], 'upload pill');
    });

    it(`verdict tags on an episode row, ${scheme}`, () => {
      const theme = nativeTheme(scheme);
      for (const [name, v] of Object.entries(theme.color.verdict)) {
        atLeast(TEXT_AA, v.fg, v.bg, `${name} tag`);
      }
      atLeast(TEXT_AA, theme.color.mutedForeground, theme.color.muted, 'pending_upload tag');
    });
  }
});

/**
 * The focus ring, at 1.4.11's 3:1 rather than 4.5:1 — it is a control boundary
 * and not text. Checked against every ground a focusable control sits on,
 * including the near-black stage, which keeps its own override in globals.css.
 */
describe('the keyboard focus ring is visible on every ground', () => {
  it('light', () => {
    for (const ground of [light.background, light.surface, light.card, light.muted])
      atLeast(CONTROL_AA, ring.light, ground, 'ring');
  });

  it('dark', () => {
    for (const ground of [dark.background, dark.surface, dark.card, dark.muted])
      atLeast(CONTROL_AA, ring.dark, ground, 'ring');
  });

  it('on the stage, in both themes', () => {
    // `.on-stage :focus-visible` in globals.css. The theatre is dark in both.
    atLeast(CONTROL_AA, sun[400], stage.ground, 'stage ring');
    atLeast(CONTROL_AA, sun[400], stage.panel, 'stage ring');
  });
});

/**
 * The neutrals and the link colour, so the next token edit cannot quietly take
 * one of them under the floor either.
 */
describe('shell text clears AA', () => {
  for (const [scheme, n] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(scheme, () => {
      for (const ground of [n.background, n.surface, n.card, n.muted]) {
        atLeast(TEXT_AA, n.foreground, ground, 'foreground');
        atLeast(TEXT_AA, n.mutedForeground, ground, 'muted foreground');
        /**
         * The third one is the hairline — a border, a divider, a hover edge —
         * and it is held to the TEXT floor anyway. It shipped at `#9C978E` /
         * `#6C737C` and measured 2.90:1 on the light page, 2.62:1 on the light
         * muted fill and 3.30:1 on the dark one, while ten text declarations
         * across seven console files were written in it; nothing said so
         * because this loop did not include it. Those declarations read
         * `mutedForeground` now, and this case stays because an edge nobody
         * can see is the same failure with a different name.
         */
        atLeast(TEXT_AA, n.faintForeground, ground, 'faint foreground');
      }
      /*
       * Links are tech blue (globals.css), and they are `--tech-ink` — the
       * per-scheme step — rather than a fixed `tech-600` with a hand-written
       * dark override beside it. Measured before that: `tech-600` on the dark
       * card, 2.63:1.
       */
      atLeast(TEXT_AA, scheme === 'dark' ? tech[200] : tech[700], n.background, 'link');
    });

    it(`${scheme}: the faint ink stays a step lighter than the muted ink`, () => {
      // Light: 5.14 / 4.93 / 5.14 / 4.63 against 5.38 / 5.16 / 5.38 / 4.85.
      // Dark:  5.54 / 5.28 / 5.02 / 4.59 against 7.39 / 7.05 / 6.71 / 6.13.
      // Raising a ratio by making the three inks the same colour would pass
      // every case above and delete the hierarchy they exist to draw.
      expect(contrast(n.faintForeground, n.background)).toBeLessThan(
        contrast(n.mutedForeground, n.background),
      );
      // The tightest pair, unrounded: the previous light ink sat at 4.49999.
      expect(contrast(n.faintForeground, n.muted)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('the stage, which is dark in both themes', () => {
    atLeast(TEXT_AA, stage.fg, stage.ground, 'stage foreground');
    atLeast(TEXT_AA, stage.fg, stage.panel, 'stage foreground');
    atLeast(TEXT_AA, stage.mid, stage.ground, 'stage mid');
  });
});

/**
 * Type over footage, which is the one ground this file cannot look up.
 *
 * A surface has a colour; a film has whatever the collector pointed the camera
 * at. So the worst case is assumed rather than sampled — a pure white pixel —
 * and the scrim the two landings actually use is composited over it here. The
 * console's sign-in film sits at 60% and the collector's at 62%; both were
 * measured off the built pages, and both are asserted so a lighter scrim
 * cannot be chosen later without this failing.
 */
describe('type over footage clears AA on the worst frame', () => {
  const composite = (ink: string, alpha: number, under: string): string => {
    const [i, u] = [channels(ink), channels(under)];
    return `#${i
      .map((c, n) => Math.round((alpha * c + (1 - alpha) * u[n]!) * 255).toString(16).padStart(2, '0'))
      .join('')}`;
  };

  for (const [surface, alpha] of [
    ['the console sign-in', 0.6],
    ['the collector landing', 0.62],
  ] as const) {
    it(`${surface}, at ${Math.round(alpha * 100)}%`, () => {
      const worst = composite(stage.ground, alpha, '#FFFFFF');
      atLeast(TEXT_AA, stage.over, worst, `${surface}: type over the film`);
      /*
       * And the reason the token exists: `fg` measures 4.52:1 on the collector's
       * scrim and 4.20:1 on the console's — one of them under the floor, the
       * other 0.02 above it. Neither is a margin worth shipping over a film.
       */
      expect(contrast(stage.over, worst)).toBeGreaterThan(contrast(stage.fg, worst));
    });
  }

  it('and `over` stays off the surfaces, where `fg` is the considered ink', () => {
    expect(contrast(stage.over, stage.ground)).toBeGreaterThan(contrast(stage.fg, stage.ground));
  });
});
