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
 */
import {
  dark,
  darkBrandTints,
  duration,
  fontSize,
  fontWeight,
  light,
  radius,
  space,
  stage,
  sun,
  tech,
  verdict,
} from './tokens.ts';

export type ColorScheme = 'light' | 'dark';

/** Numbers, not rem strings: RN sizes are density-independent pixels. */
const REM = 16;
const px = (rem: string): number => Math.round(Number.parseFloat(rem) * REM);

export type NativeTheme = ReturnType<typeof nativeTheme>;

export function nativeTheme(scheme: ColorScheme) {
  const n = scheme === 'dark' ? dark : light;
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
      verdict: {
        pass: { fg: verdict.pass.fg, bg: isDark ? verdict.pass.bgDark : verdict.pass.bg },
        partial: {
          fg: verdict.partial.fg,
          bg: isDark ? verdict.partial.bgDark : verdict.partial.bg,
        },
        reject: { fg: verdict.reject.fg, bg: isDark ? verdict.reject.bgDark : verdict.reject.bg },
      },
      stage,
    },
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
    /** Material elevation levels, since Android is the app's first target. */
    elevation: { flat: 0, raised: 2, floating: 6, modal: 12 },
    duration: Object.fromEntries(
      Object.entries(duration).map(([k, v]) => [k, Number.parseInt(v, 10)]),
    ) as Record<keyof typeof duration, number>,
  } as const;
}
