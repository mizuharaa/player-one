import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BrandSlot } from '../shell/BrandSlot.tsx';
import { useT } from '../locale.tsx';
import { polish, useTheme } from '../theme.tsx';
import { face, useInsets, useReducedMotion } from '../ui.tsx';
import washing from '../../assets/discover/work-wide.webp';
import folding from '../../assets/discover/work-portrait.webp';
import packing from '../../assets/discover/work-detail.webp';
import kitchen from '../../assets/discover/setting-kitchen.jpg';
import { TaskPhotoLabel } from '../ui/TaskPhotoLabel.tsx';

const photos = [
  { source: folding, x: -.10, y: .03, size: .34, tilt: '-9deg' },
  { source: packing, x: .78, y: .10, size: .34, tilt: '8deg' },
  { source: washing, x: .28, y: .23, size: .36, tilt: '-3deg' },
  { source: kitchen, x: -.04, y: .52, size: .36, tilt: '7deg' },
  { source: folding, x: .62, y: .62, size: .40, tilt: '-8deg' },
  { source: packing, x: .20, y: .83, size: .32, tilt: '5deg' },
] as const;

/** Bundled setting photos, never competitor artwork or invented task inventory. */
export function LandingGallery({ ready, onContinue }: { ready: boolean; onContinue: () => void }) {
  const theme = useTheme(), tt = useT(), insets = useInsets(), reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const zoom = useRef(new Animated.Value(1.16)).current;
  useEffect(() => {
    if (reduced) { zoom.setValue(1); return; }
    if (!ready) { zoom.setValue(1.16); return; }
    const animation = Animated.timing(zoom, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [ready, reduced, zoom]);
  const fieldHeight = Math.min(500, height * .50);
  return <View testID="landing-gallery" style={{ minHeight: height, overflow: 'hidden', backgroundColor: theme.collector.paper, paddingTop: insets.top, paddingBottom: insets.bottom + 24 }}>
    <LinearGradient pointerEvents="none" colors={polish.galleryWash} start={{ x: 0, y: 0 }} end={{ x: 1, y: .6 }} style={[StyleSheet.absoluteFill, { height: fieldHeight + insets.top + 100 }]} />
    <LinearGradient pointerEvents="none" colors={polish.galleryFade} style={[StyleSheet.absoluteFill, { top: fieldHeight * .4, height: fieldHeight * .6 + insets.top + 100 }]} />
    <Animated.View style={{ height: fieldHeight + 48, transform: [{ scale: zoom }] }}>
      {photos.map((photo, index) => <View key={index} style={{ position: 'absolute', left: width * photo.x, top: fieldHeight * photo.y, width: width * photo.size, aspectRatio: 1, padding: 7, borderRadius: 20, backgroundColor: polish.galleryFrame, borderWidth: 1, borderColor: theme.collector.surface, transform: [{ rotate: photo.tilt }], shadowColor: theme.collector.ink, shadowOpacity: .14, shadowRadius: 16, shadowOffset: { width: 0, height: 12 }, elevation: 5 }}>
        <View style={{ flex: 1, borderRadius: 13, overflow: 'hidden' }}>
          <Image source={photo.source} accessible={false} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
          <TaskPhotoLabel />
        </View>
      </View>)}
    </Animated.View>
    <View style={{ alignItems: 'center', paddingHorizontal: 24, gap: 20, paddingTop: 32 }}>
      <View><BrandSlot /></View>
      <Text accessibilityRole="header" style={{ fontFamily: face(theme), fontSize: 38, lineHeight: 48, fontWeight: '700', letterSpacing: -1.2, textAlign: 'center', color: theme.collector.ink }}>{tt('landing.slogan1')}{'\n'}{tt('landing.slogan2')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={tt('common.next')} onPress={onContinue} style={{ width: 64, height: 64, borderRadius: 32, overflow: 'hidden' }}>
        <LinearGradient colors={polish.galleryArrow} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text accessible={false} style={{ color: theme.collector.ink, fontSize: 36, lineHeight: 44 }}>{'\u2193'}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  </View>;
}
