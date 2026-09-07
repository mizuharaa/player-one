import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BackHandler } from 'react-native';

/**
 * A typed stack navigator in ~60 lines, with a tab concept on top of it.
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

/**
 * The four destinations the bottom bar switches between, in bar order.
 *
 * A tab root is a place, not a step: it renders the bar, it never shows a Back
 * control, and Android Back at one of them goes home rather than unwinding an
 * onboarding flow the collector already finished. Everything else — a task's
 * detail, device setup, session preparation — is pushed on top of a root and
 * pops back to it.
 *
 * The session button in the middle of the bar is deliberately NOT here. It
 * pushes `sessionCreate`, which is a task with an end (APP-16 binds a session),
 * not a place to sit. It is drawn as the centre button because preparing a
 * session is the thing a collector opens this app to do.
 */
export const TAB_ROOTS = ['home', 'taskHall', 'uploads', 'income'] as const;

export type TabName = (typeof TAB_ROOTS)[number];

export const isTabRootName = (name: RouteName): name is TabName =>
  (TAB_ROOTS as readonly string[]).includes(name);

interface Nav {
  route: Route;
  canGoBack: boolean;
  /** True when the current route is one of the four bar destinations. */
  isTabRoot: boolean;
  push: (route: Route) => void;
  /** True if a screen was popped; false at the root, where Android Back exits. */
  back: () => boolean;
  /** Clears history — used when onboarding hands over to the home screen. */
  reset: (route: Route) => void;
  /** Switches bar destination: replaces the stack, never grows it. */
  selectTab: (tab: TabName) => void;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const route = stack[stack.length - 1] ?? initial;
  const canGoBack = stack.length > 1;
  const back = (): boolean => {
    if (canGoBack) {
      setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
      return true;
    }
    // At a tab root that is not Home, Back goes to Home — Android's
    // convention, and the only way out of a one-screen stack that is not
    // closing the app. At Home it returns false and the system closes the
    // app normally.
    if (route.name !== 'home' && isTabRootName(route.name)) {
      setStack([{ name: 'home' }]);
      return true;
    }
    return false;
  };
  const nav: Nav = {
    route,
    canGoBack,
    isTabRoot: !canGoBack && isTabRootName(route.name),
    push: (r) => setStack((s) => [...s, r]),
    back,
    reset: (r) => setStack([r]),
    // A bar destination replaces the stack rather than pushing onto it, so
    // tapping four tabs does not leave four screens for Back to walk through.
    selectTab: (tab) => setStack([{ name: tab }]),
  };

  // Android's hardware/gesture Back. Without this a hand-rolled stack leaves
  // Back wired to "exit the app", so a collector two screens deep loses the
  // screen instead of stepping out of it. Returning false at Home is what
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
