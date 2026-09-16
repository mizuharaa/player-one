import { polish } from '../theme.tsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { brandFrame } from './BrandSlot.tsx';

const Ring = Animated.createAnimatedComponent(Circle);
const ease = Easing.bezier(.22, 1, .36, 1);
let seen = false;
/** Draw O, hold One for 400ms, add Player, then dock the same wordmark. */
export function BootIntro({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const [staticMark, setStaticMark] = useState(false);
  const done = useRef(onDone); done.current = onDone;
  const draw = useSharedValue(0), fill = useSharedValue(0), reveal = useSharedValue(0);
  const player = useSharedValue(0), wipe = useSharedValue(0), dock = useSharedValue(0);
  const [playerWidth, setPlayerWidth] = useState(390), [oneWidth, setOneWidth] = useState(270), [oWidth, setOWidth] = useState(120);
  const wordWidth = playerWidth + oneWidth;
  const targetX = useSharedValue(width / 2), targetY = useSharedValue(70), targetScale = useSharedValue(.25);
  useEffect(() => {
    let active = true, started = false, foreground = AppState.currentState === 'active';
    let reduced: boolean | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined, measure: ReturnType<typeof setTimeout> | undefined;
    const finish = () => { if (active) { active = false; seen = true; done.current(); } };
    if (seen) { finish(); return; }
    const showStatic = () => {
      setStaticMark(true);
      clearTimeout(deadline);
      deadline = setTimeout(finish, 1000);
    };
    const start = () => {
      if (!active || started || !foreground || reduced === undefined) return;
      started = true;
      if (reduced) { showStatic(); return; }
      // iOS can mount while inactive: only spend the intro's deadline once visible.
      deadline = setTimeout(finish, 3300);
      draw.value = withTiming(1, { duration: 850, easing: ease });
      fill.value = withDelay(850, withTiming(1, { duration: 200, easing: ease }));
      reveal.value = withDelay(1050, withTiming(1, { duration: 500, easing: ease }));
      player.value = withDelay(1950, withTiming(1, { duration: 350, easing: ease }));
      wipe.value = withDelay(2500, withTiming(1, { duration: 750, easing: ease }));
      dock.value = withDelay(2500, withTiming(1, { duration: 750, easing: ease }));
      measure = setTimeout(() => {
        if (brandFrame) { targetX.value = brandFrame.x + brandFrame.width / 2; targetY.value = brandFrame.y + brandFrame.height / 2; }
      }, 1600);
    };
    const state = AppState.addEventListener('change', value => {
      foreground = value === 'active';
      if (foreground) start();
      else if (started && value === 'background') finish();
    });
    const reduce = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      if (!active) return;
      reduced = value;
      if (started && value) showStatic(); else start();
    });
    // An unavailable accessibility bridge gets a visible, motion-free intro.
    const gate = setTimeout(() => { if (active && reduced === undefined) { reduced = true; start(); } }, 250);
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!active || reduced !== undefined) return;
      reduced = value; start();
    }).catch(() => { if (active && reduced === undefined) { reduced = true; start(); } });
    return () => { active = false; clearTimeout(gate); clearTimeout(deadline); clearTimeout(measure); state.remove(); reduce?.remove(); };
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
  if (staticMark) return <Animated.View testID="boot-intro" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, { zIndex: 1000, backgroundColor: polish.openingCover, alignItems: 'center', justifyContent: 'center' }]}>
    <Animated.Text testID="boot-static-wordmark" style={[mark, { fontSize: 42, lineHeight: 54, letterSpacing: -1.68 }]}>PlayerOne</Animated.Text>
  </Animated.View>;
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

/** The opaque intro owns reveal; chrome must not have a second startup gate. */
export function BootChrome({ children }: { children: ReactNode; step?: number }) {
  return <Animated.View style={{ flex: 1 }}>{children}</Animated.View>;
}
