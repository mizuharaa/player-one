import { polish } from '../theme.tsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { addLowPowerModeListener, isLowPowerModeEnabledAsync } from 'expo-battery';
import Svg, { Circle } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { brandFrame } from './BrandSlot.tsx';

const Ring = Animated.createAnimatedComponent(Circle);
const ease = Easing.bezier(.22, 1, .36, 1);
let seen = false;
/** Draw O, hold One for 400ms, add Player, then dock the same wordmark. */
export function BootIntro({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const done = useRef(onDone); done.current = onDone;
  const draw = useSharedValue(0), fill = useSharedValue(0), reveal = useSharedValue(0);
  const player = useSharedValue(0), wipe = useSharedValue(0), dock = useSharedValue(0);
  const [playerWidth, setPlayerWidth] = useState(390), [oneWidth, setOneWidth] = useState(270), [oWidth, setOWidth] = useState(120);
  const wordWidth = playerWidth + oneWidth;
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
      draw.value = withTiming(1, { duration: 850, easing: ease });
      fill.value = withDelay(850, withTiming(1, { duration: 200, easing: ease }));
      reveal.value = withDelay(1050, withTiming(1, { duration: 500, easing: ease }));
      player.value = withDelay(1950, withTiming(1, { duration: 350, easing: ease }));
      wipe.value = withDelay(2500, withTiming(1, { duration: 750, easing: ease }));
      dock.value = withDelay(2500, withTiming(1, { duration: 750, easing: ease }));
    }).catch(finish);
    const measure = setTimeout(() => {
      if (brandFrame) { targetX.value = brandFrame.x + brandFrame.width / 2; targetY.value = brandFrame.y + brandFrame.height / 2; }
    }, 1600);
    return () => { active = false; clearTimeout(timeout); clearTimeout(measure); state.remove(); reduce?.remove(); power?.remove(); };
  }, []);
  const ring = useAnimatedProps(() => ({ strokeDashoffset: 345.6 * (1 - draw.value), strokeOpacity: 1 - fill.value }), [draw, fill]);
  const cover = useAnimatedStyle(() => ({ height: height * (1 - wipe.value) }), [height, wipe]);
  const letters = useAnimatedStyle(() => ({ width: oWidth + (oneWidth - oWidth) * reveal.value, opacity: fill.value }), [oWidth, oneWidth, reveal, fill]);
  const prefix = useAnimatedStyle(() => ({ opacity: player.value }), [player]);
  const morph = useAnimatedStyle(() => {
    const startScale = Math.min(1, (width - 48) / oneWidth);
    const fullScale = Math.min(1, (width - 48) / wordWidth);
    const scale = startScale + (fullScale - startScale) * player.value;
    const oCentre = wordWidth / 2 - (wordWidth - oneWidth + oWidth / 2);
    const oneCentre = -(wordWidth - oneWidth) / 2;
    const centre = (oCentre + (oneCentre - oCentre) * reveal.value) * (1 - player.value);
    return { opacity: Math.min(1, (1 - dock.value) / .08), transform: [
      { translateX: centre * scale * (1 - dock.value) + (targetX.value - width / 2) * dock.value },
      { translateY: (targetY.value - height / 2) * dock.value },
      { scale: scale * (1 - dock.value) + targetScale.value * dock.value },
    ] };
  }, [width, height, wordWidth, oneWidth, oWidth, reveal, player, dock, targetX, targetY, targetScale]);
  const mark = { fontFamily: 'Be Vietnam Pro', fontSize: 120, lineHeight: 152, fontWeight: '600' as const, letterSpacing: -4.8, color: polish.openingMark };
  return <Animated.View testID="boot-intro" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: polish.openingCover, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }, cover]} />
    <Animated.View pointerEvents="none" style={{ position: 'absolute', opacity: 0, width: 1200, alignItems: 'flex-start' }}>
      <Animated.Text style={mark} onLayout={event => setPlayerWidth(event.nativeEvent.layout.width)}>Player</Animated.Text>
      <Animated.Text style={mark} onLayout={event => setOneWidth(event.nativeEvent.layout.width)}>One</Animated.Text>
      <Animated.Text style={mark} onLayout={event => setOWidth(event.nativeEvent.layout.width)}>O</Animated.Text>
    </Animated.View>
    <Animated.View style={[{ position: 'absolute', top: height / 2 - 76, left: width / 2 - wordWidth / 2, width: wordWidth, height: 152 }, morph]}>
      <Animated.View style={[{ position: 'absolute', left: 0, width: wordWidth - oneWidth, height: 152, overflow: 'hidden' }, prefix]}>
        <Animated.Text style={[mark, { width: playerWidth }]}>Player</Animated.Text>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: wordWidth - oneWidth, height: 152, overflow: 'hidden' }, letters]}>
        <Animated.Text style={[mark, { width: oneWidth }]}>One</Animated.Text>
      </Animated.View>
      <Svg style={{ position: 'absolute', left: wordWidth - oneWidth, top: 16 }} width={oWidth} height={120} viewBox="0 0 120 120">
        <Ring cx={60} cy={60} r={55} stroke={polish.openingMark} strokeWidth={2.5} fill="none" strokeDasharray="345.6" animatedProps={ring} />
      </Svg>
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
    const power = Platform.OS === 'web' ? null : addLowPowerModeListener(value => { if (value.lowPowerMode) finish(); });
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), isLowPowerModeEnabledAsync()]).then(([reduced, lowPower]) => {
      if (active) progress.value = reduced || lowPower || AppState.currentState !== 'active' ? 1 : withDelay(2500 + step * 50, withTiming(1, { duration: 250, easing: ease }));
    }).catch(() => { if (active) progress.value = 1; });
    return () => { active = false; clearTimeout(deadline); state.remove(); reducedChange?.remove(); power?.remove(); };
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: progress.value }), [progress]);
  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
}
