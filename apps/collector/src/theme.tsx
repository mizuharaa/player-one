import { brand, sun, tech } from '@playerone/design/tokens';
import { MotionProvider } from './ui/motion.ts';
import { createContext, useContext, type ReactNode } from 'react';
import { nativeTheme, type NativeTheme } from '@playerone/design/native';

const base = nativeTheme('light');
const c = base.collector;
/** Collector materials extend the same oat, plum and tangerine system as the console. */
export const polish = {
  paper: c.paper, ink: c.ink, badge: `${c.paper}F2`,
  card: c.surface, hairline: c.line, cardRadius: 20,
  sheen: ['#FFFFFF00', '#FFFFFF00'] as const,
  glass: 'rgba(255,253,250,0.94)', glassEdge: 'rgba(255,255,255,0.9)',
  glassFallback: c.surface, selection: '#F0E6E8', shadow: c.ink,
  darkGlass: 'rgba(255,255,255,0.10)', darkEdge: 'rgba(255,255,255,0.18)',
  darkMuted: '#E5D8DF', darkBackdrop: 'rgba(24,19,28,0.88)',
  claimGlass: 'rgba(64,48,70,0.96)', claimFallback: c.nightSurface, claimScrim: 'rgba(43,33,48,0.26)',
  brandOrange: brand.tangerine, notificationYellow: '#FFD43B',
  galleryFrame: c.surface,
  homeBorder: c.plum,
  homeSurface: c.paper,
  art: { ice: '#F8F5EF', lilac: '#D7BDD7', rose: '#D9ADBD', cream: brand.oat,
    violet: tech[500], deep: brand.plum, white: '#FFFFFF', orange: brand.tangerine },
  feature: { mint: '#E9E2D2', peach: sun[100], lilac: tech[100], blue: '#E7D2A9' },
  openingCover: '#05070A', openingMark: '#F7F5F1', skeletonBand: 'rgba(5,7,10,.08)',
};
const theme: NativeTheme = {
  ...base,
  collector: c,
  font: { ...base.font, sans: 'Be Vietnam Pro' },
  color: {
    ...base.color,
    background: c.paper, surface: c.surface, card: c.surface, muted: c.paper,
    foreground: c.ink, mutedForeground: c.muted, faintForeground: c.muted,
    border: c.line, borderStrong: c.muted, fieldBorder: c.muted,
    action: c.plum, actionInk: c.surface,
  },
};
const ThemeContext = createContext<NativeTheme>(theme);
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={theme}><MotionProvider>{children}</MotionProvider></ThemeContext.Provider>;
}
export const useTheme = (): NativeTheme => useContext(ThemeContext);
