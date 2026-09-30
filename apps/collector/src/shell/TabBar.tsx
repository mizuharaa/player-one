import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, Text, View } from 'react-native';
import { useNav, type TabName } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { polish, useTheme } from '../theme.tsx';
import type { MessageKey } from '../i18n.ts';
import { face, measureTabBar, useInsets } from '../ui.tsx';
import { GlassSurface } from '../ui/GlassSurface.tsx';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { useReducedMotion } from '../ui/motion.ts';

const TABS: { tab: TabName; key: MessageKey; icon: IconName }[] = [
  { tab: 'home', key: 'tab.home', icon: 'home' },
  { tab: 'taskHall', key: 'tab.tasks', icon: 'search' },
  { tab: 'uploads', key: 'tab.uploads', icon: 'video' },
  { tab: 'income', key: 'tab.income', icon: 'wallet' },
  { tab: 'profile', key: 'tab.profile', icon: 'profile' },
];

function TabGlyph({ active, icon }: { active: boolean; icon: IconName }) {
  const c = useTheme().collector;
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced || !active) { scale.setValue(1); return; }
    scale.setValue(.86);
    const animation = Animated.spring(scale, { toValue: 1, damping: 16, stiffness: 260, mass: .6, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [active, reduced, scale]);
  return <Animated.View style={{ transform: [{ scale }] }}><Icon name={icon} size={23} color={active ? c.ink : c.muted} fill={active && (icon === 'home' || icon === 'wallet') ? c.ink : 'none'} strokeWidth={active ? 2.3 : 1.8} /></Animated.View>;
}

export function TabBar() {
  const theme = useTheme(), c = theme.collector, tt = useT(), nav = useNav(), insets = useInsets();
  const [focused, setFocused] = useState<TabName | null>(null);
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const activeIndex = TABS.findIndex(({ tab }) => tab === nav.route.name);
  const tabWidth = Math.max(0, width - 10) / TABS.length;
  useEffect(() => {
    x.stopAnimation();
    const toValue = Math.max(0, activeIndex) * tabWidth;
    if (reduced || !tabWidth) { x.setValue(toValue); return; }
    const animation = Animated.spring(x, { toValue, damping: 25, stiffness: 320, mass: .8, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [activeIndex, tabWidth, reduced, x]);
  return <View accessibilityRole="tablist" onLayout={event => measureTabBar(event.nativeEvent.layout.height)}
    style={{ position: 'absolute', left: c.gutter + insets.left, right: c.gutter + insets.right, bottom: insets.bottom + 8,
      borderRadius: c.radius.pill, shadowColor: polish.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: .10, shadowRadius: 14, elevation: 6 }}>
    <GlassSurface style={{ borderRadius: c.radius.pill, borderWidth: 0 }}>
      <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ padding: 5, flexDirection: 'row' }}>
      <Animated.View testID="tab-selection" pointerEvents="none" style={{ position: 'absolute', top: 5, bottom: 5, left: 5, width: tabWidth, borderRadius: c.radius.pill, backgroundColor: polish.selection, transform: [{ translateX: x }] }} />
      {TABS.map(({ tab, key, icon }) => {
        const active = nav.route.name === tab;
        return <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={tt(key)} accessibilityState={{ selected: active }} aria-selected={active}
          onPress={() => nav.selectTab(tab)} onFocus={() => setFocused(tab)} onBlur={() => setFocused(null)}
          style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 54, paddingVertical: 5, gap: 3, alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: focused === tab ? c.plum : 'transparent', borderRadius: 22,
            backgroundColor: 'transparent', opacity: pressed ? .65 : 1 })}>
          <TabGlyph active={active} icon={icon} />
          <Text style={{ fontFamily: face(theme), fontSize: 11, lineHeight: 16, fontWeight: active ? '600' : '400', color: active ? c.ink : c.muted, textAlign: 'center' }}>{tt(key)}</Text>
        </Pressable>;
      })}
      </View>
    </GlassSurface>
  </View>;
}
