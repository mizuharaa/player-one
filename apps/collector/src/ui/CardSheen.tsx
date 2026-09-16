import { polish } from '../theme.tsx';
import { createContext, useContext } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useReducedMotion } from './motion.ts';

export const paperCard = { backgroundColor: polish.card, borderColor: polish.hairline, borderWidth: 1, borderRadius: polish.cardRadius };
export const CardScrollContext = createContext<Animated.Value | null>(null);

/** The native scroll value moves one faint gradient; there is no idle animation. */
export function CardSheen({ pressed = false }: { pressed?: boolean }) {
  const scroll = useContext(CardScrollContext), reduced = useReducedMotion();
  const translateX = reduced || !scroll ? 0 : scroll.interpolate({ inputRange: [0, 800], outputRange: [-24, 24], extrapolate: 'clamp' });
  return <Animated.View testID="card-sheen" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, { left: -32, right: -32, transform: [{ translateX }] }]}>
    <LinearGradient colors={polish.sheen} start={{ x: pressed ? .2 : 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
  </Animated.View>;
}
