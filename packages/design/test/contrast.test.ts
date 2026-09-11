import { describe, expect, it } from 'vitest';
import { ambient, bamboo, dark, darkBrandTints, glass, lavender, light, lime, ring, stage, sun, tech, toCss, truc, verdict } from '../src/tokens.ts';
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
    /*
     * Measured on the page as it was: `#FFFFFF`. The page is `lavender-100`
     * now, so this is pinned to the ground it was taken on rather than to a
     * token that has since moved — a historical record that drifts with the
     * palette is not a record.
     */
    expect(ratio(sun[500], '#FFFFFF')).toBe(2.61);
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
 * Sun and tech, now that they are only the partner mark.
 *
 * They were the product's two working colours — sun for action, tech for data
 * and links — and on 2026-09-07 the world moved to a lavender ground with an
 * ink action and one lime accent. VNG's orange and PaXini's blue survive in the
 * mark and nowhere else, which is the honest place for them: `PRODUCT.md`
 * records that neither is a binding corporate value, so they were the design
 * system's own choice and the system is allowed to change its mind.
 *
 * What is pinned here is the demotion. The ratios measured before the ink fix
 * are kept as a historical record with the ground written out, because a record
 * that drifts with the palette records nothing.
 */
describe('sun and tech are the partner mark now', () => {
  it('keeps the ratios measured before the ink fix, on the grounds they were measured on', () => {
    expect(ratio(tech[700], darkBrandTints.tech50)).toBe(1.8);
    expect(ratio(sun[700], darkBrandTints.sun50)).toBe(3.32);
    /* The dark card as it was, before the neutrals turned violet. */
    expect(ratio(tech[600], '#181B1F')).toBe(2.63);
  });

  it("the mark's two discs read against each other and against both pages", () => {
    /*
     * Not against each other: `sun-500` on `tech-500` is 1.76:1 and always was.
     * Two saturated hues in a lockup are told apart by hue and by the overlap
     * that draws them, not by luminance, and asserting a control ratio between
     * them was a wrong test — written here, caught here, removed here. What has
     * to be true is that each disc separates from the page it is drawn on.
     */
    atLeast(CONTROL_AA, tech[500], light.background, 'the mark on the light page');
    atLeast(CONTROL_AA, sun[500], dark.background, 'the mark on the dark page');
    atLeast(CONTROL_AA, tech[500], dark.background, 'the mark on the dark page');
  });

  it('and sun is not asked to carry text on the lavender page, which it cannot', () => {
    /*
     * Pinned as a refusal. `sun-700` reads 4.49:1 on the new page — under the
     * floor by a hundredth, which is the `faintForeground` trap this file
     * exists to catch. Sun has no text job left, so the ramp was not retuned
     * and this stops it drifting back into one.
     */
    expect(contrast(sun[700], light.background)).toBeLessThan(TEXT_AA);
  });

  it('is what `toCss` emits, per scheme, so the console reads these numbers', () => {
    const css = toCss();
    expect(css).toContain('--sun-ink:');
    expect(css).toContain('--tech-ink:');
    expect(css).toContain('--lime-ink:');
    expect(css).toContain('--action:');
  });
});

/**
 * The primary action, which is an ink pill and no longer a sun one.
 *
 * The world pinned on 2026-09-07 puts its primary in near-black on a tinted
 * ground; `--action` and `--action-ink` are that pill, and they invert with the
 * scheme so the label inverts with them. The case this replaces asserted ink on
 * `sun-500` at 7.19:1 — that button does not exist any more.
 */
describe('the primary action', () => {
  for (const [scheme, n] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`${scheme}: the label reads on the ink pill, and the pill reads on every shell ground`, () => {
      atLeast(TEXT_AA, n.background, n.foreground, `${scheme} action label on the pill`);
      for (const g of [n.background, n.surface, n.card, n.muted])
        atLeast(CONTROL_AA, n.foreground, g, `${scheme} action pill against the shell`);
    });
  }

  it('and the ramp that used to be the action is no longer emitted as one', () => {
    /*
     * `--action` exists and resolves to the neutral ink, not to a sun step. If
     * somebody wires the primary back to sun, this is what says so.
     */
    const css = toCss();
    expect(css).toContain(`--action: ${light.foreground}`);
    expect(css).toContain(`--action: ${dark.foreground}`);
  });
});

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
/**
 * `ink` laid over `under` at `alpha`, as the compositor does it: straight
 * source-over in sRGB, which is what a browser paints for an `opacity` on a
 * solid fill and for a flat scrim over a frame of video.
 */
const composite = (ink: string, alpha: number, under: string): string => {
  const [i, u] = [channels(ink), channels(under)];
  return `#${i
    .map((c, n) => Math.round((alpha * c + (1 - alpha) * u[n]!) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
};

describe('type over footage clears AA on the worst frame', () => {
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

/**
 * The sign-in wash, which `DESIGN.md` allows as a named exception to "nothing
 * decorative uses any of the three" — and allows only while this measures.
 *
 * Two blurred fields sit behind the form below `lg`: `bamboo-50` at 60% and
 * `sun-50` at 50%. The blur has no effect on the worst case, because the worst
 * case is the middle of a field where the blur has nothing to average with; and
 * the two overlap, so the ground under the worst pixel is both of them, sun
 * composited on top of bamboo composited on the page.
 *
 * Both floors are the text floor. Nothing on this ground is large type, and the
 * muted ink carries the field labels and the legal line, which are the two
 * things a person actually has to read to sign in.
 */
describe('the sign-in wash costs no contrast', () => {
  for (const [scheme, neutrals, tints] of [
    ['light', light, { bamboo: bamboo[50], sun: sun[50] }],
    ['dark', dark, { bamboo: darkBrandTints.bamboo50, sun: darkBrandTints.sun50 }],
  ] as const) {
    it(`${scheme}: body and muted ink clear AA on the worst point of the wash`, () => {
      const under = composite(tints.bamboo, 0.6, neutrals.background);
      const worst = composite(tints.sun, 0.5, under);

      atLeast(TEXT_AA, neutrals.foreground, worst, `${scheme} body ink on the wash`);
      atLeast(TEXT_AA, neutrals.mutedForeground, worst, `${scheme} muted ink on the wash`);
    });
  }

  /**
   * The collector app draws the same ground a different way, so it is measured
   * a different way.
   *
   * React Native has no CSS blur, so there the wash is `ambient.rings`
   * concentric discs of one tint at `ambient.step` alpha each; they composite
   * to `1 - (1 - step) ** rings` at the centre, which is the number to test
   * against. It uses the 100 step because 50 at that alpha is invisible on a
   * phone.
   *
   * This shipped for one afternoon on the **200** step, which is a fixed value
   * on both ramps and therefore a pale tan disc over a near-black page: the
   * composite measured `#83795a`, body text 3.73:1 and the muted ink 1.68:1.
   * Both under the floor, on the screen a collector signs in from. The 50 and
   * 100 steps are the two that invert with the scheme, which is why the rule
   * in `DESIGN.md` names them and why this case exists.
   */
  for (const [scheme, neutrals, tints] of [
    ['light', light, { bamboo: bamboo[100], sun: sun[100] }],
    ['dark', dark, { bamboo: darkBrandTints.bamboo100, sun: darkBrandTints.sun100 }],
  ] as const) {
    it(`${scheme}: the collector's discs clear AA at the alpha they composite to`, () => {
      const alpha = 1 - (1 - ambient.step) ** ambient.rings;
      const under = composite(tints.bamboo, alpha, neutrals.background);
      const worst = composite(tints.sun, alpha, under);

      atLeast(TEXT_AA, neutrals.foreground, worst, `${scheme} body ink on the collector wash`);
      atLeast(TEXT_AA, neutrals.mutedForeground, worst, `${scheme} muted ink on the collector wash`);
      expect(contrast(worst, neutrals.background)).toBeLessThan(1.2);
    });
  }

  /*
   * And the limit that keeps either of them a ground rather than a colour: the
   * wash must never move the page enough to matter. This is the one number
   * `DESIGN.md` states as the outcome, so both implementations answer to it.
   */
  it('neither wash moves the page it sits on', () => {
    const web = composite(sun[50], 0.5, composite(bamboo[50], 0.6, light.background));
    expect(contrast(web, light.background)).toBeLessThan(1.2);

    const alpha = 1 - (1 - ambient.step) ** ambient.rings;
    const native = composite(sun[100], alpha, composite(bamboo[100], alpha, light.background));
    expect(contrast(native, light.background)).toBeLessThan(1.2);
  });
});

/**
 * Trúc is black and white, and stays black and white.
 *
 * His furs used to come from `--muted` and `--background` in the collector app,
 * which are scheme neutrals — so on a dark page both went near-black and the
 * mascot was drawn black on black. He is the only figure on the sign-in screen
 * and he rendered as a grey ghost on the ground he was standing on.
 */
describe("Trúc's furs do not answer to the page", () => {
  it('his light furs read against his black in both schemes', () => {
    atLeast(TEXT_AA, truc.coat, stage.ground, 'coat on his ink');
    atLeast(TEXT_AA, truc.highlight, stage.ground, 'highlight on his ink');
  });

  it('and his coat is not pure white, so he does not vanish on the light page', () => {
    expect(contrast(truc.coat, light.background)).toBeGreaterThan(1);
    expect(contrast(truc.highlight, truc.coat)).toBeLessThan(1.2);
  });
});

/**
 * The one border in the system held to a ratio.
 *
 * WCAG 2.1 SC 1.4.11 asks 3:1 of the visual information that identifies a
 * component, and a text field's edge is the whole of what identifies it. This
 * project already holds the *focus ring* to exactly that rule and quotes the
 * number; the field's resting border was never put through the same check and
 * measured **1.52:1** in light and **1.65:1** in dark — the separator colour
 * doing an identification job because nothing else existed.
 */
describe('a field edge is a control boundary, not a separator', () => {
  for (const [scheme, n] of [['light', light], ['dark', dark]] as const) {
    it(`${scheme}: the field border clears the control floor on both grounds`, () => {
      atLeast(CONTROL_AA, n.fieldBorder, n.background, `${scheme} field border on the page`);
      atLeast(CONTROL_AA, n.fieldBorder, n.card, `${scheme} field border on a card`);
    });
  }

  it('and it is a step past the separator it replaced, which does not clear it', () => {
    expect(contrast(light.borderStrong, light.background)).toBeLessThan(CONTROL_AA);
    expect(contrast(dark.borderStrong, dark.card)).toBeLessThan(CONTROL_AA);
  });
});

/**
 * Lime, the one accent this world has, and the three jobs it took over.
 *
 * Sun's action and bamboo's progress both ended on 2026-09-07. Action became an
 * ink pill; progress, emphasis and the focus ring became lime. Each step below
 * was chosen against a measurement rather than picked and then checked, and the
 * mistake this guards is the one bamboo made on the old page: a step that works
 * as a fill quietly being used as type.
 */
describe('lime carries progress, emphasis and the ring', () => {
  it('500 is a fill under ink text, and is never text itself', () => {
    atLeast(TEXT_AA, light.foreground, lime[500], 'ink on the lime fill');
    expect(contrast(lime[500], light.background)).toBeLessThan(CONTROL_AA);
  });

  it('600 is the stroke: a ring, a graphic edge, on every light ground', () => {
    for (const g of [light.background, light.surface, light.card, light.muted])
      atLeast(CONTROL_AA, lime[600], g, 'the lime stroke');
  });

  it('700 is ink on the light page, and 200 is ink on the dark one', () => {
    for (const g of [light.background, light.surface, light.card, light.muted])
      atLeast(TEXT_AA, lime[700], g, 'lime text, light');
    for (const g of [dark.background, dark.surface, dark.card, dark.muted])
      atLeast(TEXT_AA, lime[200], g, 'lime text, dark');
  });

  it('the focus ring is lime and clears the control floor on both pages', () => {
    atLeast(CONTROL_AA, ring.light, light.background, 'the light focus ring');
    atLeast(CONTROL_AA, ring.dark, dark.background, 'the dark focus ring');
  });

  it('the native theme resolves lime and limeInk in both schemes', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const t = nativeTheme(scheme);
      const n = scheme === 'light' ? light : dark;
      atLeast(TEXT_AA, t.color.limeInk, n.background, `${scheme} limeInk on the page`);
    }
  });
});

/**
 * Lavender is the page, and that is what makes the glass legible.
 *
 * A translucent card over a white page is white: there is nothing behind it to
 * show through, so the material reads as a grey rectangle. The ground is tinted
 * for exactly this reason, and these cases pin the two halves of that — that
 * the wash stays a ground rather than becoming a colour, and that every ink
 * still clears AA over a card at the glass alpha the tokens specify.
 */
describe('the glass surfaces cost no contrast', () => {
  for (const [scheme, n] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const [what, fill] of [
      ['card', glass.card.fill],
      ['bar', glass.bar.fill],
    ] as const) {
      it(`${scheme}: body and muted ink clear AA on the ${what}`, () => {
        /*
         * The worst case is the *deepest* ground the glass can sit on, because
         * that is where the least white shows through and the surface is
         * darkest in light mode.
         */
        const under = scheme === 'light' ? lavender[200] : n.background;
        const over = scheme === 'light' ? '#FFFFFF' : n.card;
        const worst = composite(over, fill, under);
        atLeast(TEXT_AA, n.foreground, worst, `${scheme} body ink on ${what} glass`);
        atLeast(TEXT_AA, n.mutedForeground, worst, `${scheme} muted ink on ${what} glass`);
      });
    }
  }

  it('the wash is a ground, not a colour: it barely moves the page', () => {
    expect(contrast(lavender[100], lavender[50])).toBeLessThan(1.2);
    expect(contrast(lavender[200], lavender[100])).toBeLessThan(1.2);
  });

  it('and the page really is the wash, so there is something behind the glass', () => {
    expect(light.background).toBe(lavender[100]);
    expect(light.surface).toBe(lavender[50]);
  });
});
