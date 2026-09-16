import { polish } from '../theme.tsx';
import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { addLowPowerModeListener, isLowPowerModeEnabledAsync } from 'expo-battery';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { brandFrame } from './BrandSlot.tsx';

const Ring = Animated.createAnimatedComponent(Circle);
const FilledRing = Animated.createAnimatedComponent(Path);
const ease = Easing.bezier(.22, 1, .36, 1);
let seen = false;
/** Hold the fully revealed One for 300ms before the plate rises. */
export function BootIntro({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const done = useRef(onDone); done.current = onDone;
  const draw = useSharedValue(0), fill = useSharedValue(0), reveal = useSharedValue(0);
  const plate = useSharedValue(0), wipe = useSharedValue(0), dock = useSharedValue(0), centre = useSharedValue(0);
  const targetX = useSharedValue(width / 2), targetY = useSharedValue(70), targetScale = useSharedValue(.25);
  useEffect(() => {
    let active = true;
    const finish = () => { if (active) { active = false; seen = true; done.current(); } };
    if (seen) { finish(); return; }
    const timeout = setTimeout(finish, 3300);
    const state = AppState.addEventListener('change', value => { if (value !== 'active') finish(); });
    const reduce = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { if (value) finish(); });
    const power = Platform.OS === 'web' ? null : addLowPowerModeListener(value => { if (value.lowPowerMode) finish(); });
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), isLowPowerModeEnabledAsync()]).then(([reduced, lowPower]) => {
      if (!active) return;
      if (reduced || lowPower || AppState.currentState !== 'active') { finish(); return; }
      draw.value = withTiming(1, { duration: 850, easing: Easing.inOut(Easing.cubic) });
      fill.value = withDelay(850, withTiming(1, { duration: 350 }));
      reveal.value = withDelay(900, withTiming(1, { duration: 500, easing: ease }));
      centre.value = withDelay(900, withSpring(-62, { damping: 18 }));
      plate.value = withDelay(1700, withTiming(1, { duration: 350, easing: ease }));
      wipe.value = withDelay(2450, withTiming(1, { duration: 800, easing: Easing.inOut(Easing.exp) }));
      dock.value = withDelay(2450, withTiming(1, { duration: 800, easing: Easing.inOut(Easing.exp) }));
    }).catch(finish);
    const measure = setTimeout(() => {
      if (brandFrame) { targetX.value = brandFrame.x + brandFrame.width / 2; targetY.value = brandFrame.y + brandFrame.height / 2; }
    }, 1600);
    return () => { active = false; clearTimeout(timeout); clearTimeout(measure); state.remove(); reduce?.remove(); power?.remove(); };
  }, []);
  const ring = useAnimatedProps(() => ({ strokeDashoffset: 345.6 * (1 - draw.value), fillOpacity: fill.value, strokeOpacity: 1 - fill.value }), [draw, fill]);
  const filledRing = useAnimatedProps(() => ({ fillOpacity: fill.value }), [fill]);
  const cover = useAnimatedStyle(() => ({ height: height * (1 - wipe.value) }), [height, wipe]);
  const group = useAnimatedStyle(() => ({ opacity: (1 - plate.value * .88) * (1 - dock.value), transform: [{ translateX: centre.value }, { scale: 1 - plate.value * .08 }] }), [plate, dock, centre]);
  const letters = useAnimatedStyle(() => ({ width: 150 * reveal.value }), [reveal]);
  const word = useAnimatedStyle(() => ({ opacity: plate.value, transform: [{ translateY: 132 * (1 - plate.value) }] }), [plate]);
  const morph = useAnimatedStyle(() => ({ transform: [{ translateX: (targetX.value - width / 2) * dock.value }, { translateY: (targetY.value - height / 2) * dock.value }, { scale: Math.min(1, (width - 48) / 660) * (1 - dock.value) + targetScale.value * dock.value }] }), [width, height, targetX, targetY, targetScale, dock]);
  return <Animated.View testID="boot-intro" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: polish.openingCover, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }, cover]} />
    <Animated.View style={[{ position: 'absolute', top: height / 2 - 60, left: width / 2 - 60, width: 120, height: 120, flexDirection: 'row' }, group]}>
      <Svg width={120} height={120} viewBox="0 0 120 120"><Ring cx={60} cy={60} r={55} stroke={polish.openingMark} strokeWidth={2.5} fill="none" strokeDasharray="345.6" animatedProps={ring} /><FilledRing d="M60 5a55 55 0 1 0 0 110a55 55 0 1 0 0-110M60 21a39 39 0 1 1 0 78a39 39 0 1 1 0-78" fillRule="evenodd" fill={polish.openingMark} animatedProps={filledRing} /></Svg>
      <Animated.View style={[{ position: 'absolute', left: 118, height: 140, top: -16, overflow: 'hidden' }, letters]}><Animated.Text style={{ width: 150, fontSize: 120, fontWeight: '600', letterSpacing: -4.8, color: polish.openingMark }}>ne</Animated.Text></Animated.View>
    </Animated.View>
    <Animated.View style={[{ position: 'absolute', top: height / 2 - 75, left: width / 2 - 330, width: 660, height: 150, overflow: 'hidden', alignItems: 'center' }, morph]}>
      <Animated.Text style={[{ fontFamily: 'Be Vietnam Pro', fontSize: 120, lineHeight: 150, fontWeight: '600', letterSpacing: -4.8, color: polish.openingMark }, word]}>PlayerOne</Animated.Text>
    </Animated.View>
  </Animated.View>;
}

/** First-paint chrome follows the cover; later navigation does not replay it. */
export function BootChrome({ children, step = 0 }: { children: ReactNode; step?: number }) {
  const progress = useSharedValue(seen ? 1 : 0);
  useEffect(() => {
    if (seen) { progress.value = 1; return; }
    let active = true;
    const finish = () => { active = false; progress.value = 1; };
    const deadline = setTimeout(finish, 3300);
    const state = AppState.addEventListener('change', value => { if (value !== 'active') finish(); });
    const reducedChange = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { if (value) finish(); });
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), isLowPowerModeEnabledAsync()]).then(([reduced, lowPower]) => {
      if (active) progress.value = reduced || lowPower || AppState.currentState !== 'active' ? 1 : withDelay(2500 + step * 50, withTiming(1, { duration: 250, easing: ease }));
    }).catch(() => { if (active) progress.value = 1; });
    return () => { active = false; clearTimeout(deadline); state.remove(); reducedChange?.remove(); };
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: -8 * (1 - progress.value) }] }), [progress]);
  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
}
