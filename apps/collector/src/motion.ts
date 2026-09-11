import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

/**
 * Does the collector have "remove animations" on? Every authored motion in
 * this app asks first and renders its end state when the answer is yes.
 *
 * `null` until the system has answered. The answer is a promise, and the first
 * frame arrives before it resolves — so a hook that guessed `false` would let
 * the film play for a frame and then stop it, for exactly the person who asked
 * for no motion. Callers treat `null` as "still" and only move on `false`.
 *
 * One hook rather than a check per component: the promise and the change
 * event both need handling, and getting either wrong in six places is how one
 * screen keeps moving after the setting is turned on.
 */
export function useReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (live) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * Is the app in the foreground? Loops that keep running behind another app
 * are battery spent on a screen nobody sees; the film and the mascot both
 * stop on `background`/`inactive` and resume on `active`.
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}
