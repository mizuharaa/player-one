import { createContext, useContext, type ReactNode } from 'react';
import { nativeTheme, type NativeTheme } from '@playerone/design/native';

const base = nativeTheme('light');
const c = base.collector;
/** Collector-only polish tokens; the shared console palette is unchanged. */
export const polish = {
  paper: c.paper, ink: c.ink, badge: `${c.paper}F2`,
  card: 'rgba(255,253,249,.94)', hairline: `${c.ink}0F`, cardRadius: 20,
  sheen: [`${c.plum}0F`, `${c.sun}0F`] as const,
  homeGradient: ['#E9E1FB', '#F2ECF8', c.paper] as const,
  openingCover: '#05070A', openingMark: '#F7F5F1', skeletonBand: 'rgba(5,7,10,.08)',
};
const theme: NativeTheme = {
  ...base,
  font: { ...base.font, sans: 'Be Vietnam Pro' },
  color: {
    ...base.color,
    background: c.paper, surface: c.surface, card: c.surface, muted: c.paper,
    foreground: c.ink, mutedForeground: c.muted, faintForeground: c.muted,
    border: c.line, borderStrong: c.muted, fieldBorder: c.muted,
    action: c.sun, actionInk: c.night,
  },
};
const ThemeContext = createContext<NativeTheme>(theme);
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
export const useTheme = (): NativeTheme => useContext(ThemeContext);
