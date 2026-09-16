import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
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
  { tab: 'taskHall', key: 'tab.tasks', icon: 'grid' },
  { tab: 'uploads', key: 'tab.uploads', icon: 'camera' },
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
  return <Animated.View style={{ transform: [{ scale }] }}><Icon name={icon} size={23} color={active ? c.plum : c.muted} strokeWidth={active ? 2.3 : 1.8} /></Animated.View>;
}

export function TabBar() {
  const theme = useTheme(), c = theme.collector, tt = useT(), nav = useNav(), insets = useInsets();
  const [focused, setFocused] = useState<TabName | null>(null);
  return <View accessibilityRole="tablist" onLayout={event => measureTabBar(event.nativeEvent.layout.height)}
    style={{ position: 'absolute', left: c.gutter + insets.left, right: c.gutter + insets.right, bottom: insets.bottom + 8,
      borderRadius: c.radius.dock, shadowColor: polish.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: .12, shadowRadius: 16, elevation: 6 }}>
    <GlassSurface style={{ borderRadius: c.radius.dock, padding: 5, flexDirection: 'row' }}>
      {TABS.map(({ tab, key, icon }) => {
        const active = nav.route.name === tab;
        return <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={tt(key)} accessibilityState={{ selected: active }} aria-selected={active}
          onPress={() => nav.selectTab(tab)} onFocus={() => setFocused(tab)} onBlur={() => setFocused(null)}
          style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 54, paddingVertical: 5, gap: 3, alignItems: 'center', justifyContent: 'center',
            borderWidth: 2, borderColor: focused === tab ? c.plum : 'transparent', borderRadius: 22,
            backgroundColor: active ? polish.selection : 'transparent', opacity: pressed ? .65 : 1 })}>
          <TabGlyph active={active} icon={icon} />
          <Text style={{ fontFamily: face(theme), fontSize: 11, lineHeight: 15, fontWeight: active ? '600' : '400', color: active ? c.ink : c.muted, textAlign: 'center' }}>{tt(key)}</Text>
        </Pressable>;
      })}
    </GlassSurface>
  </View>;
}
