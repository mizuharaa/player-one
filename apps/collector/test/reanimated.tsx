import { useRef, useState } from 'react';
import { View, Text, Easing } from 'react-native';
export { Easing };
export function useSharedValue(initial: number) {
  const [, render] = useState(0);
  const ref = useRef<{ value: number } | null>(null);
  if (!ref.current) { let value = initial; ref.current = { get value() { return value; }, set value(next: number) { if (next !== value) { value = next; render(n => n + 1); } } }; }
  return ref.current;
}
export const useAnimatedStyle = (fn: () => unknown) => fn();
export const useAnimatedProps = (fn: () => unknown) => fn();
export const withTiming = (value: number) => value;
export const withSpring = (value: number) => value;
export const withDelay = (_delay: number, value: number) => value;
export default { View, Text, createAnimatedComponent: (component: unknown) => component };
