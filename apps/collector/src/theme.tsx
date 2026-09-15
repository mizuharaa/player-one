import { createContext, useContext, type ReactNode } from 'react';
import { nativeTheme, type NativeTheme } from '@playerone/design/native';

const base = nativeTheme('light');
const c = base.collector;
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
