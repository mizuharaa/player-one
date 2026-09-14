/**
 * The React Native form of the same tokens.
 *
 * React Native has no cascade, no custom properties and no media queries, so
 * a theme there is a resolved object chosen once and passed down a context.
 * This module does that resolution and nothing else — every value it returns
 * came from `tokens.ts`, so the app and the console cannot drift.
 *
 * Two things deliberately do not cross over:
 *
 * - **Shadows.** RN's elevation model is not CSS box-shadow, and translating
 *   one into the other produces a shadow that matches on neither platform.
 *   The app declares elevation levels and this file gives it the numbers.
 * - **The stage.** The collector never reviews footage, so the theatre has no
 *   meaning in the app. It is exported anyway, because APP-24's upload-record
 *   screens show video thumbnails and want the same surround.
 * - **The typeface.** `font.sans` on the web names Be Vietnam Pro, which
 *   reaches the browser as a bundled woff2. React Native resolves a family
 *   name against fonts linked into the native build, so naming it here on a
 *   project with no native build yet would render nothing and silently fall
 *   back. See `font` below.
 */
import {
  ambient,
  bamboo,
  dark,
  darkBrandTints,
  discover,
  duration,
  fontSize,
  glass,
  lavender,
  lime,
  fontWeight,
  light,
  radius,
  space,
  stage,
  sun,
  truc,
  warn,
  tech,
  verdict,
} from './tokens.ts';

export type ColorScheme = 'light' | 'dark';

/** Numbers, not rem strings: RN sizes are density-independent pixels. */
const REM = 16;
const px = (rem: string): number => Math.round(Number.parseFloat(rem) * REM);

export type NativeTheme = ReturnType<typeof nativeTheme>;

export function nativeTheme(scheme: ColorScheme) {
  /**
   * The scheme's neutrals, widened to `string`.
   *
   * `light` and `dark` in `tokens.ts` are `as const`, so without this every
   * neutral role reaches the app as a two-member literal union of the two
   * hexes it happens to hold today. Nothing switches on a neutral's value —
   * they are roles — and the narrow type only ever bit one caller: the
   * collector app remaps its ground roles onto the warm `discover` paper
   * (SPEC.md §0.1, `apps/collector/src/theme.tsx`) and could not, because
   * `#F4EFE6` is not one of the two lavenders this union allows.
   */
  const n: Record<keyof typeof light, string> = scheme === 'dark' ? dark : light;
  const isDark = scheme === 'dark';

  return {
    scheme,
    color: {
      ...n,
      sun: { ...sun, ...(isDark ? { 50: darkBrandTints.sun50, 100: darkBrandTints.sun100 } : {}) },
      tech: {
        ...tech,
        ...(isDark ? { 50: darkBrandTints.tech50, 100: darkBrandTints.tech100 } : {}),
      },
      /**
       * The ink for anything sitting on `tech[50]` or `tech[100]`: the `Note`
       * that carries every gate message and every rejection reason, and the
       * upload-state pills.
       *
       * It has to be resolved here, not chosen at each call site, because the
       * two fills invert in dark mode and `tech[700]` does not. Measured with
       * one ink for both schemes: 1.80:1 for the note and 1.35:1 for the pills
       * — the sentence saying why a collector cannot work was invisible on a
       * dark phone. `tech[200]` measures 10.08:1 and 7.53:1 on the same fills.
       */
      techInk: isDark ? tech[200] : tech[700],
      /** Ink and fill both come from the scheme; see `verdict` in tokens.ts. */
      verdict: {
        pass: {
          fg: isDark ? verdict.pass.fgDark : verdict.pass.fg,
          bg: isDark ? verdict.pass.bgDark : verdict.pass.bg,
        },
        partial: {
          fg: isDark ? verdict.partial.fgDark : verdict.partial.fg,
          bg: isDark ? verdict.partial.bgDark : verdict.partial.bg,
        },
        reject: {
          fg: isDark ? verdict.reject.fgDark : verdict.reject.fg,
          bg: isDark ? verdict.reject.bgDark : verdict.reject.bg,
        },
      },
      /**
       * Bamboo: the mascot and progress. Never a verdict, never a payment
       * status, never a money figure — see the header of `tokens.ts`. The two
       * lowest steps invert in dark mode like sun and tech, because a pale
       * lime tint on a dark phone is a glare rather than a fill.
       */
      bamboo: {
        ...bamboo,
        ...(isDark ? { 50: darkBrandTints.bamboo50, 100: darkBrandTints.bamboo100 } : {}),
      },
      /**
       * The ink for anything sitting on `bamboo[50]` or `bamboo[100]` — the
       * app's earning ring caption and its progress labels — resolved here for
       * the same reason `techInk` is. Measured: `bamboo[700]` reads 5.76:1 on
       * the light tint and 5.39:1 on `bamboo[100]`; `bamboo[200]` reads 13.00:1
       * and 9.51:1 on the two dark tints.
       */
      bambooInk: isDark ? bamboo[200] : bamboo[700],
      /**
       * The wash the whole app stands on, and the one accent over it.
       *
       * `lavender` is the page rather than an accent ramp; on the dark scheme
       * its two lightest steps invert to the dark surfaces, the same way sun's
       * and tech's do, so a card drawn on `lavender[100]` is a lighter card in
       * light and a lighter-than-page card in dark without a second branch at
       * the call site.
       */
      lavender: {
        ...lavender,
        ...(isDark ? { 50: dark.surface, 100: dark.muted } : {}),
      },
      lime,
      /** The ink for anything sitting on a lime tint. 4.94:1 light, 16.12:1 dark. */
      limeInk: isDark ? lime[200] : lime[700],
      /**
       * The primary action, as a role. It is an ink pill in this world, not a
       * coloured one, so it inverts with the scheme and the label always takes
       * `actionInk`.
       */
      /**
       * Attention that is not a verdict. The collector app needs it for the
       * same reason the console did — an upload waiting on a gateway, a device
       * that reported a fault — and it was missing here, so a screen that
       * wanted it had to say it in words alone.
       */
      warn: isDark ? warn.fgDark : warn.fg,
      warnBg: isDark ? warn.bgDark : warn.bg,
      /**
       * SPEC §0.1: the warm paper ground the collector app v2 stands on, and
       * the one part of this theme that does not answer to the colour scheme.
       *
       * `discover` in `tokens.ts` is daylight paper: it is what the console
       * paints `/discover` with, and it is deliberately independent of the
       * operator theme because a public page is not somebody's workspace. The
       * collector app's landing IS that page — same film, same sections, same
       * copy — so it stands on the same ground rather than on a second one.
       *
       * Only the flat colours cross over. `scrim`, `wash` and `shadow` in the
       * web table are CSS gradient and box-shadow strings, `font` names a web
       * family, and the two radii it carries are already `radius.lg` and
       * `radius.xl` on this scale — so none of them is repeated here.
       *
       * Measured in `test/contrast.test.ts`, not asserted here.
       *
       * Every value is `discover` from `tokens.ts` under the role names the
       * spec's table uses, so no new hex enters the system — `/discover` and
       * the phone stand on one ground rather than two. It deliberately does
       * NOT answer to the colour scheme: a page whose photographs were lit for
       * paper is not repainted for a dark phone, which is the argument the
       * `discover` block was written with and which v2 extends past the
       * landing.
       */
      discover: {
        paper: discover.warmPaper,
        surface: discover.warmSurface,
        ink: discover.warmInk,
        muted: discover.warmMuted,
        line: discover.warmLine,
        soft: discover.warmSoft,
        /** The plum tint. A field, not an accent — §0.2. */
        light: discover.light,
        lightInk: discover.lightInk,
      },
      action: isDark ? dark.foreground : light.foreground,
      actionInk: isDark ? dark.background : light.background,
      stage,
    },
    /**
     * The faces, by name.
     *
     * ponytail: `sans` is the platform's own UI face, not Be Vietnam Pro. No
     * font asset is linked into a native build here because there is no native
     * build here yet, and a `fontFamily` naming a family Android cannot find
     * renders in Roboto with no warning — the same silent fallback the web
     * stack exists to avoid. At the first native build, link the upstream
     * full-coverage TTFs — `BeVietnamPro-Regular.ttf`, `-Medium`, `-SemiBold`,
     * `-Bold` from the Google Fonts release (OFL) — through
     * `react-native.config.js` assets, then replace `'System'` with
     * `'Be Vietnam Pro'` here: one line, one place. NOT the Fontsource files:
     * those are per-script `.woff2` subsets (`latin`, `vietnamese`, …), and
     * linking one of them into a native build drops every other script.
     * `mono` is the same bargain: `JetBrainsMono-Regular.ttf` links alongside
     * it and replaces `'monospace'`.
     */
    font: { sans: 'System', mono: 'monospace' },
    /**
     * sp-equivalent sizes. RN scales these by the system font setting on its
     * own, which is why they are plain numbers and not a clamped scale.
     */
    fontSize: Object.fromEntries(
      Object.entries(fontSize).map(([k, v]) => [k, px(v)]),
    ) as Record<keyof typeof fontSize, number>,
    fontWeight,
    space: Object.fromEntries(
      Object.entries(space).map(([k, v]) => [k, Number.parseInt(v, 10)]),
    ) as Record<keyof typeof space, number>,
    radius: Object.fromEntries(
      Object.entries(radius).map(([k, v]) => [k, Number.parseInt(v, 10)]),
    ) as Record<keyof typeof radius, number>,
    /**
     * The alphas the sign-in screen's ambient ground is drawn at. Straight
     * from `tokens.ts`: RN has no CSS blur, so that wash is concentric discs
     * of one brand tint and these are its falloff.
     */
    ambient,
    /**
     * Glass, as the two numbers it is rather than a look. React Native has no
     * backdrop blur without a native module, so `fill` composites straight over
     * the wash and the varying ground does the work the blur would have done.
     */
    glass,
    /**
     * Trúc's two light furs. Not under `color` with the scheme neutrals,
     * because that is exactly the mistake this fixes: they are the animal's
     * colours and they do not answer to the page.
     */
    truc,
    /** Material elevation levels, since Android is the app's first target. */
    elevation: { flat: 0, raised: 2, floating: 6, modal: 12 },
    duration: Object.fromEntries(
      Object.entries(duration).map(([k, v]) => [k, Number.parseInt(v, 10)]),
    ) as Record<keyof typeof duration, number>,
  } as const;
}
