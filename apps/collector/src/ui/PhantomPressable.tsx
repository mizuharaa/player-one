import { useState } from 'react';
import { Platform, Pressable, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
const Target = Animated.createAnimatedComponent(Pressable);
/** Keep the native press semantics and caller styles; only the feedback is shared. */
export function PhantomPressable({ style, onPressIn, onPressOut, onPress, pressedScale = .97, ...props }: PressableProps & { pressedScale?: number }) {
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);
  const motion = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }), [scale]);
  return <Target {...props} style={[typeof style === 'function' ? style({ pressed }) : style, motion]}
    onPressIn={event => { setPressed(true); scale.value = withTiming(pressedScale, { duration: 120 }); onPressIn?.(event); }}
    onPressOut={event => { setPressed(false); scale.value = withTiming(1, { duration: 120 }); onPressOut?.(event); }}
    onPress={event => { if (Platform.OS !== 'web') void import('expo-haptics').then(({ impactAsync, ImpactFeedbackStyle }) => impactAsync(ImpactFeedbackStyle.Light)).catch(() => {}); onPress?.(event); }} />;
}
