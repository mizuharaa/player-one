import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
export function useReducedMotion(): boolean {
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
  return reduced;
}
