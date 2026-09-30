import { polish, useTheme } from '../theme.tsx';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Shared flat header surface. Keep the existing export for its screen callers. */
export function HeaderGradient({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View testID="home-header-wash" style={{ marginHorizontal: -theme.collector.gutter,
    paddingHorizontal: theme.collector.gutter, paddingBottom: 20, gap: 16, backgroundColor: polish.homeSurface }}>
    {children}
  </View>;
}
