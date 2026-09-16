import { useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { type Route } from '../nav.tsx';

const spring = { damping: 20, stiffness: 180, mass: .8 };
/** Mirror observed keys only to distinguish a pop; navigation still owns all history. */
export function RouteTransition({ route, isTabRoot, children }: { route: Route; isTabRoot: boolean; children: ReactNode }) {
  const key = JSON.stringify(route);
  const history = useRef<string[]>([]);
  const direction = useSharedValue(0);
  const previousRoot = useRef(isTabRoot);
  if (history.current.at(-1) !== key) {
    const previous = history.current.at(-1);
    const tab = isTabRoot && (!previous || previousRoot.current);
    const back = history.current.includes(key);
    direction.value = tab ? 0 : back ? -1 : 1;
    history.current = isTabRoot ? [key] : back ? history.current.slice(0, history.current.indexOf(key) + 1) : [...history.current, key];
  }
  previousRoot.current = isTabRoot;
  const entering = (values: { windowWidth: number }) => {
    'worklet';
    const tab = direction.value === 0;
    return { initialValues: { opacity: tab ? 0 : 1, transform: [{ translateX: tab ? 0 : direction.value > 0 ? values.windowWidth : -values.windowWidth * .25 }, { translateY: tab ? 8 : 0 }] },
      animations: { opacity: withTiming(1, { duration: 220 }), transform: [{ translateX: withSpring(0, spring) }, { translateY: withTiming(0, { duration: 220 }) }] } };
  };
  const exiting = (values: { windowWidth: number }) => {
    'worklet';
    return { initialValues: { opacity: 1, transform: [{ translateX: 0 }] }, animations: { opacity: withTiming(direction.value === 0 ? 0 : .96, { duration: 220 }), transform: [{ translateX: withSpring(direction.value === 0 ? 0 : direction.value < 0 ? values.windowWidth : -values.windowWidth * .25, spring) }] } };
  };
  return <View style={{ flex: 1, backgroundColor: '#05070A' }}><Animated.View key={key} testID="route-transition" entering={entering} exiting={exiting} style={{ flex: 1, backgroundColor: '#F6F2EA' }}>{children}</Animated.View></View>;
}
