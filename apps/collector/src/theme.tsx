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
 * `nativeTheme().discover` already exports it, and it is the ground the
 * photography in this app was lit for.
 *
 * This is a **role remap, not a new palette**. Every value below already
 * existed in `tokens.ts` and is already measured in
 * `packages/design/test/contrast.test.ts`; no hex is introduced here, and
 * nothing is written down in a screen. Because the roles keep their names,
 * every component in `ui.tsx` and every screen moved to warm paper without a
 * line changing in either.
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
 */
function collectorTheme(): NativeTheme {
  const base = nativeTheme('light');
  const d = base.discover;
  return {
    ...base,
    color: {
      ...base.color,
      background: d.paper,
      surface: d.surface,
      card: d.surface,
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
