import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { nativeTheme, type NativeTheme } from '@playerone/design/native';

/**
 * The one place the design tokens enter the app. Every colour, radius and
 * spacing in a screen comes from `useTheme()` — a literal in a .tsx file is a
 * rejected diff, same rule as the console.
 */
const ThemeContext = createContext<NativeTheme>(nativeTheme('light'));

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const theme = useMemo(() => nativeTheme(scheme === 'dark' ? 'dark' : 'light'), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): NativeTheme => useContext(ThemeContext);
