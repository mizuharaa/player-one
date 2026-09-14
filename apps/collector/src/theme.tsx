import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { nativeTheme, type NativeTheme } from '@playerone/design/native';

/**
 * The one place the design tokens enter the app. Every colour, radius and
 * spacing in a screen comes from `useTheme()` — a literal in a .tsx file is a
 * rejected diff, same rule as the console.
 *
 * ---------------------------------------------------------------------------
 * SPEC §0.1: the ground moved to warm paper, and it moved HERE.
 *
 * v2 stands the whole collector app on `discover` — the ground `/discover`
 * already uses — rather than on the lavender wash the shipped build had.
 * DESIGN.md's argument for tinting the page at all ("a translucent card over a
 * white page is white — there is nothing behind it to show through and the
 * blur has nothing to bend") is a *web* argument: on the phone there is no
 * blur, so lavender was doing nothing a warmer tint could not do, and it
 * fought the photography this redesign is mostly made of.
 *
 * The swap is done by re-pointing the scheme's neutral roles at the warm
 * block, in one function, rather than by every screen reaching past
 * `theme.color.background` for a second palette. That matters for a reason
 * beyond tidiness: `ui.tsx` is 1,500 lines of components that paint
 * `background`, `surface`, `card`, `foreground`, `mutedForeground`, `border`
 * and `muted`, and re-grounding them one call site at a time would be the
 * "second look for a solved problem" §0.7 exists to prevent. Every `Card`,
 * `Button`, `Chip`, `Tag`, `Progress`, `Field`, `Note` and `Timeline` in the
 * app becomes correct the moment this mapping is in place, and no screen
 * carries a branch for it.
 *
 * `theme.color.discover.*` keeps its own names for the places the spec names
 * the role rather than the neutral — the plum greeting block, the price chip,
 * the lime track's ground — and those values are the same objects, so the two
 * spellings can never drift.
 *
 * **Dark mode stops applying here.** The `discover` block deliberately does
 * not answer to the colour scheme: a page whose photographs were lit for paper
 * does not get repainted for a dark phone. v2 inherits that, so this provider
 * no longer reads `useColorScheme()` and the collector app is a light-ground
 * app. The operator console keeps both schemes; nothing in `packages/design`
 * changed to make this true.
 *
 * What it costs, stated plainly: `native.ts`'s note that sign-in "stands on
 * the app's own lavender on purpose" is now wrong, and DESIGN.md's "the native
 * collector theme stays separate" is stale. Both are owner sign-off items in
 * SPEC §22.
 */
function warm(): NativeTheme {
  const base = nativeTheme('light');
  const d = base.color.discover;
  /*
   * `nativeTheme` is `as const` all the way down, so every neutral below is a
   * literal type rather than `string` and re-pointing one does not typecheck
   * without saying so. Nothing reads these as literals — they are painted, not
   * compared — so the assertion is on the whole object once, here, rather than
   * eight times inline.
   */
  return {
    ...base,
    color: {
      ...base.color,
      /** The page. */
      background: d.paper,
      /** The raised step above it: cards, sheets, fields. */
      surface: d.surface,
      /**
       * `card` is what `Frost` composites at `glass.card.fill`, so it has to
       * be the surface rather than white — a white film over warm paper is a
       * pale, slightly pink card, which is the one thing that read as a bug
       * when the ground moved and the frost did not.
       */
      card: d.surface,
      foreground: d.ink,
      mutedForeground: d.muted,
      /** The inset fill: skeletons, tracks, a pressed row. */
      muted: d.soft,
      border: d.line,
      borderStrong: d.line,
    },
    // Through `unknown` because the literal unions do not overlap at all — a
    // warm hex is not one of the two lavender/near-black values the type
    // enumerates, which is exactly the substitution being made. The shape is
    // unchanged and every value still came out of `tokens.ts`; nothing here
    // invents a colour. The narrower fix is for `nativeTheme` to take the
    // ground as an argument, and that belongs in `packages/design` with
    // Builder A's §0 pass rather than in a screen lane.
  } as unknown as NativeTheme;
}

const ThemeContext = createContext<NativeTheme>(warm());

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useMemo(() => warm(), []);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): NativeTheme => useContext(ThemeContext);
