import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme.tsx';
import { useT } from '../locale.tsx';
import { face, useInsets } from '../ui.tsx';

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
  const gesture = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, state) => state.dy < -8,
    onPanResponderRelease: (_, state) => { if (state.dy < -8) dismiss(); },
  }), [dismiss]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismiss, 3000);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);
  const fill = notice?.tone === 'error' ? c.red : notice?.tone === 'neutral' ? c.night : c.green;
  const ink = notice?.tone === 'success' ? c.night : c.surface;
  return <ToastContext.Provider value={show}>
    <View style={{ flex: 1 }}>{children}
      {notice ? <View {...gesture.panHandlers} accessibilityLiveRegion="polite"
        style={{ position: 'absolute', top: insets.top + theme.space[2], left: c.gutter, right: c.gutter,
          backgroundColor: fill, borderRadius: c.radius.pill, paddingLeft: c.cardPad, paddingRight: theme.space[1],
          flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Text style={{ ...c.type.body, color: ink }}>{notice.tone === 'success' ? '✓' : notice.tone === 'error' ? '!' : 'i'}</Text>
        <Text style={{ ...c.type.body, color: ink, fontFamily: face(theme), flex: 1, paddingVertical: theme.space[2] }}>{notice.text}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={tt('common.close')} onPress={dismiss}
          style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ ...c.type.h2, color: ink }}>×</Text>
        </Pressable>
      </View> : null}
    </View>
  </ToastContext.Provider>;
}
