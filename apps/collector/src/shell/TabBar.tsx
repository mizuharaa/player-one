import { useState, type ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav, type TabName } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { MessageKey } from '../i18n.ts';
import { face, measureTabBar, useInsets } from '../ui.tsx';
import { GlyphHome, GlyphIncome, GlyphTasks, GlyphUploads } from '../glyphs.tsx';

const TABS: { tab: TabName; key: MessageKey; Glyph?: ComponentType<{ size?: number; color: string }> }[] = [
  { tab: 'home', key: 'tab.home', Glyph: GlyphHome },
  { tab: 'taskHall', key: 'tab.tasks', Glyph: GlyphTasks },
  { tab: 'uploads', key: 'tab.uploads', Glyph: GlyphUploads },
  { tab: 'income', key: 'tab.income', Glyph: GlyphIncome },
  { tab: 'profile', key: 'tab.profile' },
];

export function TabBar() {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  const nav = useNav();
  const api = useApi();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const initials = (profile.data?.name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase();
  const insets = useInsets();
  const [focused, setFocused] = useState<TabName | null>(null);
  return <View accessibilityRole="tablist" onLayout={event => measureTabBar(event.nativeEvent.layout.height)}
    style={{ position: 'absolute', left: c.gutter + insets.left, right: c.gutter + insets.right,
      bottom: insets.bottom + theme.space[6], backgroundColor: c.night, borderRadius: c.radius.dock,
      padding: theme.space[2], flexDirection: 'row' }}>
    {TABS.map(({ tab, key, Glyph }) => {
      const active = nav.route.name === tab;
      return <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={tt(key)}
        accessibilityState={{ selected: active }} aria-selected={active}
        onPress={() => nav.selectTab(tab)} onFocus={() => setFocused(tab)} onBlur={() => setFocused(null)}
        style={({ pressed }) => ({ flex: 1, minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center',
          borderWidth: 2, borderColor: focused === tab ? c.glow : 'transparent', borderRadius: c.radius.pill,
          backgroundColor: active ? c.nightSurface : 'transparent', opacity: pressed ? 0.7 : 1 })}>
        {Glyph ? <Glyph size={24} color={active ? c.glow : c.paper} /> :
          <View style={{ minWidth: 32, minHeight: 32, padding: theme.space[1], borderRadius: c.radius.pill, backgroundColor: c.plum, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ ...c.type.caption, fontFamily: face(theme), fontWeight: '600', color: c.surface }}>{initials || '-'}</Text>
          </View>}
        {active ? <View style={{ position: 'absolute', bottom: theme.space[1], height: theme.space[1], width: theme.space[1], borderRadius: c.radius.pill, backgroundColor: c.glow }} /> : null}
      </Pressable>;
    })}
  </View>;
}
