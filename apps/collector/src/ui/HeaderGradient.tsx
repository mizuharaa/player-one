import { polish, useTheme } from '../theme.tsx';
import type { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/** A quiet color field behind solid, high-contrast content; never an interactive layer. */
export function HeaderGradient({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View testID="home-header-wash" style={{ marginHorizontal: -theme.collector.gutter,
    paddingHorizontal: theme.collector.gutter, paddingBottom: 24, gap: 18, backgroundColor: polish.homeSurface }}>
    <LinearGradient pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
      colors={polish.headerWash} locations={[0, .5, .9]} start={{ x: .5, y: 0 }} end={{ x: .5, y: 1 }} style={StyleSheet.absoluteFill} />
    {children}
  </View>;
}
