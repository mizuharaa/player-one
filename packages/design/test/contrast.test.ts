import { describe, expect, it } from 'vitest';
import { dark, darkBrandTints, light, ring, stage, sun, tech, verdict } from '../src/tokens.ts';
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

const atLeast = (floor: number, ink: string, ground: string, what: string) =>
  expect(ratio(ink, ground), `${what}: ${ink} on ${ground}`).toBeGreaterThanOrEqual(floor);

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
      }
      // Links are tech blue (globals.css). tech[600] on light, and the ramp
      // does not invert above step 100, so dark reads the same step upward.
      atLeast(TEXT_AA, scheme === 'dark' ? tech[300] : tech[600], n.background, 'link');
    });
  }

  it('the stage, which is dark in both themes', () => {
    atLeast(TEXT_AA, stage.fg, stage.ground, 'stage foreground');
    atLeast(TEXT_AA, stage.fg, stage.panel, 'stage foreground');
    atLeast(TEXT_AA, stage.mid, stage.ground, 'stage mid');
  });
});
