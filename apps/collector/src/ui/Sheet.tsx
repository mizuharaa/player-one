import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { polish, useTheme } from '../theme.tsx';
import { useT } from '../locale.tsx';
import { face, useInsets } from '../ui.tsx';
import { useReducedMotion } from './motion.ts';
import { Icon } from './Icon.tsx';
import { GlassSurface } from './GlassSurface.tsx';

export function Sheet({
  open, onClose, title, children, dark = false, footer, dismissible = true,
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
  dark?: boolean; footer?: ReactNode; dismissible?: boolean;
}) {
  const theme = useTheme(), insets = useInsets(), c = theme.collector, tt = useT();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const wide = width >= 640;
  const [presented, setPresented] = useState(open);
  const [shown, setShown] = useState(false);
  const y = useRef(new Animated.Value(height)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const close = () => { if (dismissible) onClose(); };
  const closeRef = useRef(close); closeRef.current = close;
  const dismissibleRef = useRef(dismissible); dismissibleRef.current = dismissible;
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  const enter = useCallback(() => {
    y.stopAnimation(); fade.stopAnimation();
    if (reduced) { y.setValue(0); fade.setValue(1); return; }
    Animated.parallel([
      Animated.spring(y, { toValue: 0, damping: 23, stiffness: 260, mass: .85, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
  }, [reduced, y, fade]);
  useEffect(() => {
    if (open) {
      setPresented(true);
      y.setValue(reduced ? 0 : 70);
      fade.setValue(reduced ? 1 : 0);
      // Wait for Modal to mount its native/portal subtree before animating it.
      return;
    }
    if (reduced) { setPresented(false); setShown(false); return; }
    const leave = Animated.parallel([
      Animated.timing(y, { toValue: 80, duration: 160, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: Platform.OS !== 'web' }),
    ]);
    leave.start(({ finished }) => { if (finished) { setPresented(false); setShown(false); } });
    return () => leave.stop();
  }, [open, reduced, y, fade]);
  useEffect(() => { if (open && shown) enter(); }, [open, shown, enter]);
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, state) => dismissibleRef.current && state.dy > 6 && Math.abs(state.dy) > Math.abs(state.dx),
    onPanResponderMove: (_, state) => { if (!reducedRef.current) y.setValue(Math.max(0, state.dy)); },
    onPanResponderRelease: (_, state) => {
      if (dismissibleRef.current && (state.dy > 80 || (state.dy > 20 && state.vy > .7))) closeRef.current();
      else Animated.spring(y, { toValue: 0, damping: 22, stiffness: 280, velocity: state.vy, useNativeDriver: Platform.OS !== 'web' }).start();
    },
    onPanResponderTerminate: () => Animated.spring(y, { toValue: 0, damping: 22, stiffness: 280, useNativeDriver: Platform.OS !== 'web' }).start(),
  })).current;
  const ink = dark ? c.surface : c.ink;
  return <Modal visible={open || presented} transparent animationType="none" statusBarTranslucent onRequestClose={close} onShow={() => setShown(true)}>
    <View style={{ flex: 1, justifyContent: wide ? 'center' : 'flex-end' }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        {dark ? <GlassSurface dark backdrop intensity={36} style={[StyleSheet.absoluteFill, { borderRadius: 0, borderWidth: 0 }]} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: c.night, opacity: .28 }]} />}
      </Animated.View>
      <Pressable accessibilityRole="button" accessibilityLabel={tt('common.close')} aria-disabled={!dismissible} disabled={!dismissible} accessibilityState={{ disabled: !dismissible }} onPress={close} style={StyleSheet.absoluteFill} />
      <Animated.View testID="preferences-sheet-surface" accessibilityViewIsModal
        style={{ width: wide ? Math.min(560, width - 32) : '100%', maxWidth: 560, alignSelf: 'center',
          backgroundColor: dark ? 'transparent' : c.paper, borderRadius: wide ? 28 : undefined,
          borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden',
          paddingHorizontal: c.gutter, paddingTop: 10, paddingBottom: c.gutter + insets.bottom,
          maxHeight: height - insets.top - 20, gap: 10, transform: [{ translateY: y }], opacity: fade }}>
        {dark ? <GlassSurface dark intensity={100} style={[StyleSheet.absoluteFill, { borderRadius: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28 }]} /> : null}
        <View {...pan.panHandlers} style={{ gap: 8 }}>
          <View accessible={false} style={{ width: 40, height: 5, borderRadius: c.radius.pill, backgroundColor: dark ? polish.darkEdge : c.line, alignSelf: 'center', marginTop: 2, marginBottom: 6 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text accessibilityRole="header" style={{ ...(dark && width >= 360 && height >= 700 ? c.type.h1 : c.type.h2), fontWeight: '700', color: ink, fontFamily: face(theme), flex: 1 }}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={tt('common.close')} aria-disabled={!dismissible} disabled={!dismissible} accessibilityState={{ disabled: !dismissible }} onPress={close}
              style={{ opacity: dismissible ? 1 : .45, width: dark ? 48 : undefined, minWidth: 48, paddingHorizontal: dark ? 0 : 12, gap: 6, height: 48, flexDirection: 'row', borderRadius: 24, backgroundColor: dark ? 'transparent' : c.surface, alignItems: 'center', justifyContent: 'center' }}>
              {!dark ? <Text style={{ ...c.type.caption, color: ink, fontFamily: face(theme) }}>{tt('common.close')}</Text> : null}<Icon name="close" color={ink} size={18} />
            </Pressable>
          </View>
        </View>
        <ScrollView persistentScrollbar keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>{children}</ScrollView>
        {footer}
      </Animated.View>
    </View>
  </Modal>;
}
