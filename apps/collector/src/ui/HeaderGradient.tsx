import { polish } from '../theme.tsx';
import type { ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme.tsx';
import grain from '../../assets/grain.png';

/** Soft lavender wash for the Home header only. */
export function HeaderGradient({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View testID="home-header-wash" style={{ borderRadius: polish.cardRadius, borderWidth: 2, borderColor: polish.homeBorder, overflow: 'hidden' }}>
    <LinearGradient colors={polish.homeGradient} locations={[0, 0.65, 1]}
      style={{ padding: theme.space[6], gap: theme.space[4] }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image source={grain} resizeMode="repeat" accessible={false}
          style={[StyleSheet.absoluteFill, { opacity: 0.03 }]} />
      </View>
      {children}
    </LinearGradient>
  </View>;
}
