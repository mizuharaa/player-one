import { useState } from 'react';
import { Platform, Pressable, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, withSpring } from 'react-native-reanimated';
import { useReducedMotion } from './motion.ts';
const Target = Animated.createAnimatedComponent(Pressable);
/** Keep the native press semantics and caller styles; only the feedback is shared. */
export function PhantomPressable({ style, onPressIn, onPressOut, onPress, pressedScale = .97, ...props }: PressableProps & { pressedScale?: number }) {
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);
  const motion = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }), [scale]);
  return <Target {...props} style={[typeof style === 'function' ? style({ pressed }) : style, motion]}
    onPressIn={event => { setPressed(true); scale.value = reduced ? 1 : withTiming(pressedScale, { duration: 90 }); onPressIn?.(event); }}
    onPressOut={event => { setPressed(false); scale.value = reduced ? 1 : withSpring(1, { damping: 14, stiffness: 280, mass: 0.65 }); onPressOut?.(event); }}
    onPress={event => { if (Platform.OS !== 'web') void import('expo-haptics').then(({ impactAsync, ImpactFeedbackStyle }) => impactAsync(ImpactFeedbackStyle.Light)).catch(() => {}); onPress?.(event); }} />;
}
