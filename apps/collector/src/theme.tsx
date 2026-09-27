import { MotionProvider } from './ui/motion.ts';
import { createContext, useContext, type ReactNode } from 'react';
import { nativeTheme, type NativeTheme } from '@playerone/design/native';

const base = nativeTheme('light');
const c = base.collector;
/** Collector-only polish tokens; the shared console palette is unchanged. */
export const polish = {
  paper: c.paper, ink: c.ink, badge: `${c.paper}F2`,
  card: c.surface, hairline: c.line, cardRadius: 20,
  sheen: ['#FFFFFF00', '#FFFFFF00'] as const,
  glass: 'rgba(255,255,255,0.76)', glassEdge: 'rgba(255,255,255,0.9)',
  glassFallback: '#F4F0FC', selection: '#E9E0FA', shadow: '#211B32',
  darkGlass: 'rgba(255,255,255,0.10)', darkEdge: 'rgba(255,255,255,0.18)',
  darkMuted: '#DDD7E8', darkBackdrop: 'rgba(22,18,30,0.88)',
  claimGlass: 'rgba(58,57,70,0.96)', claimFallback: '#3A3946', claimScrim: 'rgba(33,27,50,0.26)',
  brandOrange: '#ED6900', notificationYellow: '#FFD43B',
  galleryWash: ['#F7D8DC', '#FAE7CE', '#D7EFEB'] as const,
  galleryFade: ['#F6F2EA00', c.paper] as const,
  galleryFrame: '#FFFFFFE6', galleryArrow: ['#EAA2B8', '#F6BF80'] as const,
  homeBorder: c.plum,
  homeSurface: '#E8E4FA',
  headerWash: ['#E8E4FA', '#F6EDF4', c.paper] as const,
  art: { ice: '#DBF4F0', lilac: '#C7B4F6', rose: '#F2C1D7', cream: '#FFE4AE',
    violet: '#7952CE', deep: '#322449', white: '#FFFFFF', orange: '#F5A16D' },
  feature: { mint: '#C8EBDD', peach: '#FFDAC0', lilac: '#DFD1FF', blue: '#D2E6FF' },
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
    action: c.night, actionInk: c.surface,
  },
};
const ThemeContext = createContext<NativeTheme>(theme);
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={theme}><MotionProvider>{children}</MotionProvider></ThemeContext.Provider>;
}
export const useTheme = (): NativeTheme => useContext(ThemeContext);
