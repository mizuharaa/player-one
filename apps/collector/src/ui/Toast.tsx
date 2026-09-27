import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme.tsx';
import { useT } from '../locale.tsx';
import { face, useInsets } from '../ui.tsx';
import { GlassSurface } from './GlassSurface.tsx';
import { Icon } from './Icon.tsx';
import { useReducedMotion } from './motion.ts';

type Tone = 'success' | 'error' | 'neutral';
const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** One acknowledgment at a time. Refusals remain in the screen's persistent Note. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null);
  const show = useCallback((text: string, tone: Tone = 'success') => setNotice({ text, tone }), []);
  const dismiss = useCallback(() => setNotice(null), []);
  const theme = useTheme();
  const c = theme.collector;
  const insets = useInsets();
  const tt = useT();
  const reduced = useReducedMotion();
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!notice) return;
    entrance.setValue(reduced ? 1 : 0);
    const animation = Animated.spring(entrance, { toValue: 1, damping: 18, stiffness: 260, mass: .7, useNativeDriver: Platform.OS !== 'web' });
    // Allow the conditionally mounted animated view to attach before starting its spring.
    const frame = reduced ? undefined : requestAnimationFrame(() => animation.start());
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); animation.stop(); };
  }, [notice, reduced, entrance]);
  const gesture = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, state) => state.dy < -8,
    onPanResponderRelease: (_, state) => { if (state.dy < -8) dismiss(); },
  }), [dismiss]);
  useEffect(() => {
    if (!notice) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(notice.text);
    const timer = setTimeout(dismiss, 3000);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);
  const ink = notice?.tone === 'error' ? c.redInk : c.ink;
  return <ToastContext.Provider value={show}>
    <View style={{ flex: 1 }}>{children}
      {notice ? <Animated.View {...gesture.panHandlers} testID="collector-toast" accessibilityLiveRegion="polite"
        style={{ position: 'absolute', top: insets.top + theme.space[2], left: c.gutter, right: c.gutter,
          borderRadius: 28, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-22, 0] }) }], opacity: entrance }}>
        <GlassSurface style={{ paddingLeft: c.cardPad, paddingRight: theme.space[1], flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name={notice.tone === 'success' ? 'circleCheck' : 'info'} color={ink} size={22} />
        <Text style={{ ...c.type.body, color: ink, fontFamily: face(theme), flex: 1, paddingVertical: theme.space[2] }}>{notice.text}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={tt('common.close')} onPress={dismiss}
          style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" color={ink} size={18} />
        </Pressable>
        </GlassSurface>
      </Animated.View> : null}
    </View>
  </ToastContext.Provider>;
}
