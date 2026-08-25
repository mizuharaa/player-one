import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BackHandler } from 'react-native';

/**
 * A typed stack navigator in ~60 lines.
 *
 * ponytail: hand-rolled stack, swap for @react-navigation when the app builds
 * on a device — its native-stack needs react-native-screens, a native module
 * this machine cannot compile or verify. The `Route` union and the
 * `Record<RouteName, …>` registry in App.tsx survive that swap unchanged, and
 * the registry is the completeness check: a screen missing from it is a type
 * error, not a dead link found at runtime.
 */
export type Route =
  | { name: 'register' }
  | { name: 'agreements' }
  | { name: 'training' }
  | { name: 'exam' }
  | { name: 'home' }
  | { name: 'taskHall' }
  | { name: 'taskDetail'; taskId: string }
  | { name: 'myTasks' }
  | { name: 'devices' }
  | { name: 'provisioning' }
  | { name: 'sessionCreate' }
  | { name: 'uploads' }
  | { name: 'income' };

export type RouteName = Route['name'];

interface Nav {
  route: Route;
  canGoBack: boolean;
  push: (route: Route) => void;
  /** True if a screen was popped; false at the root, where Android Back exits. */
  back: () => boolean;
  /** Clears history — used when onboarding hands over to the home screen. */
  reset: (route: Route) => void;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const route = stack[stack.length - 1] ?? initial;
  const canGoBack = stack.length > 1;
  const back = (): boolean => {
    if (!canGoBack) return false;
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    return true;
  };
  const nav: Nav = {
    route,
    canGoBack,
    push: (r) => setStack((s) => [...s, r]),
    back,
    reset: (r) => setStack([r]),
  };

  // Android's hardware/gesture Back. Without this a hand-rolled stack leaves
  // Back wired to "exit the app", so a collector two screens deep loses the
  // screen instead of stepping out of it. Returning false at the root is what
  // lets the system close the app normally. Re-subscribed every render on
  // purpose: `back` closes over the current stack, so a `[]` dependency list
  // would pin the handler to the first screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  });

  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (nav === null) throw new Error('useNav outside NavProvider');
  return nav;
}

/** Narrows the current route to one member, for screens that take params. */
export function useRoute<N extends RouteName>(name: N): Extract<Route, { name: N }> {
  const { route } = useNav();
  if (route.name !== name) throw new Error(`route is ${route.name}, expected ${name}`);
  return route as Extract<Route, { name: N }>;
}
