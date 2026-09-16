import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { polish } from '../theme.tsx';

/** Native material for floating chrome. Android uses the contrast-safe opaque fallback. */
export function GlassSurface({ children, style, intensity = 48 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; intensity?: number }) {
  const [opaque, setOpaque] = useState(true);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceTransparencyEnabled?.().then(value => { if (live) setOpaque(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOpaque);
    if (Platform.OS === 'web') setOpaque(false);
    return () => { live = false; subscription?.remove(); };
  }, []);
  const blur = !opaque && Platform.OS !== 'android';
  return <View style={[{ overflow: 'hidden', borderRadius: 20, backgroundColor: blur ? polish.glass : polish.glassFallback, borderWidth: 1, borderColor: polish.glassEdge }, style]}>
    {blur ? <><BlurView pointerEvents="none" tint="light" intensity={intensity} style={StyleSheet.absoluteFill} /><View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: polish.glass }]} /></> : null}
    {children}
  </View>;
}
