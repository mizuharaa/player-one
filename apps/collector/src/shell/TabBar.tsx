import type { ComponentType } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useNav, type TabName } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { MessageKey } from '../i18n.ts';
import { Button, GlassBar, bottomInset, face, measureTabBar } from '../ui.tsx';
import { GlyphForum, GlyphHome, GlyphIncome, GlyphSession, GlyphUploads } from '../glyphs.tsx';

const TABS: { tab: TabName; key: MessageKey; Glyph: ComponentType<{ size?: number; color: string }> }[] = [
  { tab: 'home', key: 'tab.home', Glyph: GlyphHome },
  { tab: 'forum', key: 'forum.title', Glyph: GlyphForum },
  { tab: 'uploads', key: 'tab.uploads', Glyph: GlyphUploads },
  { tab: 'income', key: 'tab.income', Glyph: GlyphIncome },
];

/** Four destinations and one preparation action. At enlarged type the action
 * gets its own row; scroll content reserves this bar's actual measured height. */
export function TabBar() {
  const theme = useTheme();
  const tt = useT();
  const nav = useNav();
  const { fontScale } = useWindowDimensions();
  const expanded = fontScale > 1.2;
  const prepare = () => nav.push({ name: 'sessionCreate' });
  const item = ({ tab, key, Glyph }: (typeof TABS)[number]) => {
    const active = nav.route.name === tab;
    return <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={tt(key)} onPress={() => nav.selectTab(tab)}
      style={({ pressed }) => ({ flex: 1, minWidth: theme.space[12], alignItems: 'center', justifyContent: 'flex-start', gap: theme.space[1], minHeight: theme.space[12], paddingVertical: theme.space[1], opacity: pressed ? 0.7 : 1 })}>
      <View style={{ paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderRadius: theme.radius.pill, backgroundColor: active ? theme.color.action : 'transparent' }}>
        <Glyph size={theme.space[5]} color={active ? theme.color.actionInk : theme.color.mutedForeground} />
      </View>
      <Text style={{ color: theme.color.foreground, fontFamily: face(theme), fontSize: theme.fontSize.xs, fontWeight: active ? theme.fontWeight.semibold : theme.fontWeight.regular, textAlign: 'center', alignSelf: 'stretch' }}>{tt(key)}</Text>
    </Pressable>;
  };

  return <View onLayout={(event) => measureTabBar(event.nativeEvent.layout.height)}
    style={{ position: 'absolute', left: theme.space[3], right: theme.space[3], bottom: bottomInset(theme.space[6]), gap: expanded ? theme.space[2] : 0 }}>
    {expanded ? <>
      <View accessibilityRole="tablist"><GlassBar>{TABS.map(item)}</GlassBar></View>
      <Button label={tt('session.title')} accessibilityHint={tt('tab.sessionHint')} onPress={prepare} />
    </> : <>
      <View pointerEvents="box-none" style={{ alignItems: 'center', justifyContent: 'flex-end', zIndex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={tt('session.title')} accessibilityHint={tt('tab.sessionHint')} onPress={prepare}
          style={({ pressed }) => ({ width: theme.space[12] + theme.space[2], height: theme.space[12] + theme.space[2], borderRadius: theme.radius.pill, backgroundColor: theme.color.action, alignItems: 'center', justifyContent: 'center', borderWidth: theme.space[0.5], borderColor: theme.color.background, marginBottom: -theme.space[5], elevation: theme.elevation.floating, opacity: pressed ? 0.85 : 1 })}>
          <GlyphSession size={theme.space[6]} color={theme.color.actionInk} />
        </Pressable>
      </View>
      <View accessibilityRole="tablist"><GlassBar>
        {TABS.slice(0, 2).map(item)}
        {/* The caption shares the raised button's pointer action, but only
            the raised button is an accessibility or keyboard stop. */}
        <Pressable accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" focusable={false} tabIndex={-1} onPress={prepare}
          style={{ width: theme.space[16], minHeight: theme.space[12], alignItems: 'center', justifyContent: 'flex-end', paddingVertical: theme.space[1] }}>
          <Text style={{ color: theme.color.foreground, fontFamily: face(theme), fontSize: theme.fontSize.xs, textAlign: 'center' }}>{tt('tab.session')}</Text>
        </Pressable>
        {TABS.slice(2).map(item)}
      </GlassBar></View>
    </>}
  </View>;
}
