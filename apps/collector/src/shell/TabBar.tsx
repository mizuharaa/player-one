import type { ComponentType } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useNav, type TabName } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { MessageKey } from '../i18n.ts';
import { Button, GlassBar, bottomInset, face, measureTabBar } from '../ui.tsx';
import { GlyphHome, GlyphIncome, GlyphPlus, GlyphTasks, GlyphUploads } from '../glyphs.tsx';

/**
 * SPEC.md §10's bar. Four destinations and one preparation action.
 *
 * **Nhiệm vụ replaces Diễn đàn.** The forum has no service behind it; the task
 * hall is the money path, and the owner asked for task browsing to be
 * prominent. The forum is still reachable, from Home's `home.more` row — it
 * just stops holding a quarter of the bar. `nav.tsx` carries the rest of that
 * argument, and it is §22.4, an owner sign-off item.
 *
 * **The raised action's glyph is `GlyphPlus`, and that is a safety rule.** A
 * camera or a record glyph on the one raised, highest-affordance control in
 * the app promises a recording control that **cannot exist**: the camera's own
 * physical buttons start and stop recording and the Bluetooth library has no
 * record command in it. `tab.sessionHint` says so in words — "Không bắt đầu
 * ghi hình" — and the glyph must not contradict the words. This is the most
 * dangerous icon choice available on this screen.
 */
const TABS: { tab: TabName; key: MessageKey; Glyph: ComponentType<{ size?: number; color: string }> }[] = [
  { tab: 'home', key: 'tab.home', Glyph: GlyphHome },
  { tab: 'taskHall', key: 'tab.tasks', Glyph: GlyphTasks },
  { tab: 'uploads', key: 'tab.uploads', Glyph: GlyphUploads },
  { tab: 'income', key: 'tab.income', Glyph: GlyphIncome },
];

/**
 * The width below which the bar has to become two rows.
 *
 * Measured in the harness at 320 dp: the bar is 296 wide, the session slot
 * takes 64, and the four remaining tabs get 58 pt each — while "Trang chủ" at
 * `fontSize.xs` needs about 60. It wraps, that one tab grows taller than its
 * four siblings, and the raised action collides with the bar.
 *
 * Shortening the Vietnamese again is not the fix and §0.3 says so: the fix is
 * the two-row form that already exists here for enlarged type. Four tabs in
 * the bar, the session action as its own full-width control above them.
 * Nothing else changes, and scrolling content reserves the taller bar through
 * the same `measureTabBar()` it already used.
 */
const NARROW = 320;

/** At enlarged type the action gets its own row; so does a narrow phone. */
export function TabBar() {
  const theme = useTheme();
  const tt = useT();
  const nav = useNav();
  const { fontScale, width } = useWindowDimensions();
  const expanded = fontScale > 1.2 || width <= NARROW;
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
          <GlyphPlus size={theme.space[6]} color={theme.color.actionInk} />
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
