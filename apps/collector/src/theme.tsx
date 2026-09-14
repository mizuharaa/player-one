import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { nativeTheme, type NativeTheme } from '@playerone/design/native';

/**
 * The one place the design tokens enter the app. Every colour, radius and
 * spacing in a screen comes from `useTheme()` — a literal in a .tsx file is a
 * rejected diff, same rule as the console.
 *
 * ## v2: the ground is warm paper, and it does not answer to the phone
 *
 * `SPEC.md` §0.1. The app stood on lavender because DESIGN.md wanted a tinted
 * page for glass to bend — a *web* argument, and React Native has no blur, so
 * `Frost` composites straight over the wash and the tint was buying nothing a
 * warmer one could not. Warm paper is the ground `/discover` already uses,
 * `nativeTheme()`'s `color.discover` already exports it, and it is the ground
 * the photography in this app was lit for.
 *
 * This is a **role remap, not a new palette**. Every value below already
 * existed in `tokens.ts` and is already measured in
 * `packages/design/test/contrast.test.ts`; no hex is introduced here, and
 * nothing is written down in a screen. Because the roles keep their names,
 * every component in `ui.tsx` and every screen moved to warm paper without a
 * line changing in either — which is the point: `ui.tsx` is 1,500 lines that
 * paint `background`, `surface`, `card`, `foreground`, `mutedForeground`,
 * `border` and `muted`, and re-grounding them one call site at a time would be
 * the "second look for a solved problem" §0.7 exists to prevent.
 *
 * `theme.color.discover.*` keeps its own names for the places the spec names
 * the role rather than the neutral — the plum greeting block, the price chip,
 * the lime track's ground — and those are the same values, so the two
 * spellings can never drift.
 *
 * The two boundary roles do not take `discover.line`, and that is deliberate.
 * `contrast.test.ts` measures the warm rule at 1.48:1 on paper and asserts it
 * is *under* the 3:1 control floor precisely so nobody outlines a control with
 * it — it is a separator. So `border` (a card's edge, a divider: nothing to
 * identify) takes the rule, and `borderStrong` and `fieldBorder` (the edge
 * that says "this is a control you type into", WCAG 1.4.11) take
 * `discover.muted`, which the same file measures at AA on all three warm
 * grounds.
 *
 * `action` / `actionInk` are untouched: §0.1's table keeps the ink pill as it
 * is, and it is the one primary per screen.
 *
 * **The scheme is fixed at light.** `discover` deliberately does not answer to
 * `useColorScheme()` — a page whose photographs were lit for paper does not
 * get repainted at night — and a ground that is warm paper in one scheme and
 * lavender-dark in the other is two apps. The operator console keeps both
 * schemes; the collector app is a light-ground app. That is §0.1 and it is an
 * owner sign-off item in §22.3.
 *
 * What it costs, stated plainly: DESIGN.md's "the native collector theme stays
 * separate" is now stale, and so is the old claim that sign-in stands on the
 * app's own lavender on purpose. Both are owner sign-off items in SPEC §22.
 */
function collectorTheme(): NativeTheme {
  const base = nativeTheme('light');
  const d = base.color.discover;
  return {
    ...base,
    color: {
      ...base.color,
      /** The page. */
      background: d.paper,
      /** The raised step above it: cards, sheets, fields. */
      surface: d.surface,
      /*
       * `card` is what `Frost` composites at `glass.card.fill`, so it has to
       * be the surface rather than white — a white film over warm paper is a
       * pale, slightly pink card, which is the one thing that read as a bug
       * when the ground moved and the frost did not.
       */
      card: d.surface,
      /** The inset fill: skeletons, tracks, a pressed row. */
      muted: d.soft,
      border: d.line,
      borderStrong: d.muted,
      fieldBorder: d.muted,
      foreground: d.ink,
      mutedForeground: d.muted,
      faintForeground: d.muted,
    },
  };
}

const ThemeContext = createContext<NativeTheme>(collectorTheme());

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useMemo(() => collectorTheme(), []);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): NativeTheme => useContext(ThemeContext);
