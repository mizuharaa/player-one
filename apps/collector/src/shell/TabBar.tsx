import type { ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNav, type TabName } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { MessageKey } from '../i18n.ts';
import { bottomInset, face } from '../ui.tsx';
import {
  GlyphHome,
  GlyphIncome,
  GlyphSession,
  GlyphTasks,
  GlyphUploads,
} from '../glyphs.tsx';

/**
 * The bottom bar: Home · Tasks · [● Session] · Uploads · Income.
 *
 * Four destinations and one action, which is why the middle one is drawn
 * differently. Material's navigation bar takes three to five destinations and
 * this has four; preparing a collection session is not a destination, it is the
 * thing a collector opens the app to do, so it is the raised centre button —
 * Android's FAB argument, applied to the one screen that ends in an APP-16
 * session identifier.
 *
 * **The centre button prepares. It does not record.** It pushes `sessionCreate`,
 * where task, device, scenario and the two APP-17b declarations are bound and
 * the server issues a session id. The app never starts or stops recording, the
 * camera's own buttons do, and nothing in this bar may imply otherwise —
 * which is why the glyph is a ring with a dot in it and not a red circle.
 *
 * Active is the sun pill, per the token contract: sun means action and the
 * current destination is where the collector's action is. Every item carries
 * its word as well as its mark, in whichever language is set.
 */

const TABS: {
  tab: TabName;
  key: MessageKey;
  Glyph: ComponentType<{ size?: number; color: string }>;
}[] = [
  { tab: 'home', key: 'tab.home', Glyph: GlyphHome },
  { tab: 'taskHall', key: 'tab.tasks', Glyph: GlyphTasks },
  { tab: 'uploads', key: 'tab.uploads', Glyph: GlyphUploads },
  { tab: 'income', key: 'tab.income', Glyph: GlyphIncome },
];

export function TabBar() {
  const theme = useTheme();
  const tt = useT();
  const nav = useNav();
  const current = nav.route.name;
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  const item = ({ tab, key, Glyph }: (typeof TABS)[number]) => {
    const active = current === tab;
    return (
      <Pressable
        key={tab}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={tt(key)}
        onPress={() => nav.selectTab(tab)}
        style={({ pressed }) => ({
          flexGrow: 1,
          flexBasis: 0,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space[1],
          minHeight: theme.space[12],
          paddingVertical: theme.space[1],
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            paddingHorizontal: theme.space[4],
            paddingVertical: theme.space[1],
            borderRadius: theme.radius.pill,
            backgroundColor: active ? theme.color.sun[500] : 'transparent',
          }}
        >
          <Glyph
            size={theme.space[5]}
            color={active ? theme.color.stage.ground : theme.color.mutedForeground}
          />
        </View>
        <Text
          numberOfLines={1}
          style={{
            color: active ? theme.color.foreground : theme.color.mutedForeground,
            fontFamily: face(theme),
            fontSize: theme.fontSize.xs,
            fontWeight: active ? theme.fontWeight.semibold : theme.fontWeight.regular,
          }}
        >
          {tt(key)}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      accessibilityRole="tablist"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: theme.color.background,
        borderTopWidth: 1,
        borderTopColor: theme.color.border,
        paddingTop: theme.space[2],
        // The gesture bar. Without this the labels sit under the system pill
        // and the 48dp targets stop being 48dp.
        paddingBottom: bottomInset(theme.space[6]),
      }}
    >
      {left.map(item)}
      <View style={{ width: theme.space[16], alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tt('tab.session')}
          accessibilityHint={tt('tab.sessionHint')}
          onPress={() => nav.push({ name: 'sessionCreate' })}
          style={({ pressed }) => ({
            width: theme.space[12] + theme.space[1],
            height: theme.space[12] + theme.space[1],
            borderRadius: (theme.space[12] + theme.space[1]) / 2,
            backgroundColor: theme.color.stage.ground,
            alignItems: 'center',
            justifyContent: 'center',
            // It sits above the bar's top edge — the one raised element on the
            // screen, and the reason it reads as an action and not a fifth
            // destination.
            marginTop: -theme.space[5],
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <GlyphSession size={theme.space[6]} color={theme.color.stage.fg} />
        </Pressable>
        <Text
          numberOfLines={1}
          style={{
            color: theme.color.mutedForeground,
            fontFamily: face(theme),
            fontSize: theme.fontSize.xs,
            marginTop: theme.space[1],
          }}
        >
          {tt('tab.session')}
        </Text>
      </View>
      {right.map(item)}
    </View>
  );
}
