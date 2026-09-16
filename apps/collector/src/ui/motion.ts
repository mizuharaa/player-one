import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
const MotionContext = createContext(true);
export const useReducedMotion = () => useContext(MotionContext);

/** One platform subscription for every motion consumer beneath the app theme. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (live) setReduced(v);
    }).catch(() => { if (live) setReduced(false); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      // Not every platform's implementation returns a subscription here.
      sub?.remove();
    };
  }, []);
  return createElement(MotionContext.Provider, { value: reduced }, children);
}
