import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useReducedMotion } from './motion.ts';
/** A paper block and one 8% ink band; native transforms keep the loop off layout. */
export function Skeleton({ ratio, lines = 1, radius = 16 }: { ratio?: number; lines?: number; radius?: number }) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(300);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { progress.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 1200, useNativeDriver: true }));
    loop.start(); return () => loop.stop();
  }, [reduced, progress]);
  return <View testID="skeleton" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    onLayout={event => setWidth(event.nativeEvent.layout.width)}
    style={{ width: '100%', aspectRatio: ratio, height: ratio ? undefined : lines * 16, backgroundColor: '#F6F2EA', borderRadius: radius, overflow: 'hidden' }}>
    {!reduced ? <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, width: '45%', backgroundColor: 'rgba(5,7,10,.08)', transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width * .45, width] }) }] }} /> : null}
  </View>;
}
