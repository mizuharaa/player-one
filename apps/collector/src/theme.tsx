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
  glassFallback: '#F1F4EF', selection: '#DFEAE2', shadow: '#24362D',
  galleryWash: ['#F7D8DC', '#FAE7CE', '#D7EFEB'] as const,
  galleryFade: ['#F6F2EA00', c.paper] as const,
  galleryFrame: '#FFFFFFE6', galleryArrow: ['#EAA2B8', '#F6BF80'] as const,
  homeBorder: c.plum,
  homeGradient: ['#E1EBE1', '#EEF2EB', c.paper] as const,
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
