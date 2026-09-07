import type { ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNav, type TabName } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { MessageKey } from '../i18n.ts';
import { GlassBar, bottomInset, face } from '../ui.tsx';
import {
  GlyphForum,
  GlyphHome,
  GlyphIncome,
  GlyphSession,
  GlyphUploads,
} from '../glyphs.tsx';

/**
 * The bottom bar: Home · Forum · [● Session] · Uploads · Income.
 *
 * Four destinations and one action, which is why the middle one is drawn
 * differently. Material's navigation bar takes three to five destinations and
 * this has four; preparing a collection session is not a destination, it is the
 * thing a collector opens the app to do, so it is the raised centre button —
 * Android's FAB argument, applied to the one screen that ends in an APP-16
 * session identifier.
 *
 * ## Why the forum took the task hall's slot instead of becoming a fifth
 *
 * The community screens landed on a bar that was already full, and the width
 * decided it rather than taste. This bar is inset `space[3]` from each edge and
 * carries `space[2]` of its own padding, so at **320dp** — the short end of the
 * Android range this pilot ships to, and the width PRODUCT.md's "legibility
 * across a wide Android device range" is about — the row has 280dp of content.
 * The centre column is a fixed `space[16]` = 64dp, because it holds the word
 * under the raised button. That leaves **216dp for the destinations**:
 *
 * | Destinations | Each | Verdict |
 * |---|---|---|
 * | 4 (today) | 54dp | already under Android's 48dp target only in width-per-label, and the labels ellipsise |
 * | 5 (a "More" slot) | 43dp | under the 48dp minimum touch width |
 * | 6 (Forum + Groups as slots) | 36dp | under it by a third; "Trang chính" would be two characters |
 *
 * So a sixth and seventh slot is not a taste call, it fails a target-size
 * floor, and a "More" slot fails the same one — it is a sixth slot with a
 * vaguer name. Material's three-to-five is not exceeded here and was never the
 * binding constraint; 320dp was.
 *
 * What was displaced, and why it was the hall. `Home` is task-first: its hero
 * is the first claimable task and it lists the rest, including the ones at
 * capacity. It is the only destination in this bar whose content is already
 * rendered by another destination, so it is the only one that can leave
 * without a collector losing a place. `taskHall` is still a route and still
 * has its own screen — it carries the per-task progress bar and claimant count
 * Home does not — reached from Home's "Nơi khác trong ứng dụng" row, one tap
 * from where the collector already is.
 *
 * Group chats is **not** a bar destination and was never going to be: the same
 * 216dp says so. It hangs off the forum's own header, which is also where it
 * belongs — the forum and the groups are the one community surface, and the
 * unread count rides on the control that opens it.
 *
 * **The centre button prepares. It does not record.** It pushes `sessionCreate`,
 * where task, device, scenario and the two APP-17b declarations are bound and
 * the server issues a session id. The app never starts or stops recording, the
 * camera's own buttons do, and nothing in this bar may imply otherwise —
 * which is why the glyph is a ring with a dot in it and not a red circle.
 *
 * **It floats now.** A rounded glass pill inset from the three edges rather
 * than a full-width bar welded to the bottom, which is the world committed on
 * 2026-09-07 (`DESIGN.md`). The bar takes the denser of the two glass weights
 * — `theme.glass.bar.fill` — because a card sits on the page and knows what is
 * behind it, and this passes over whatever the collector is scrolling. That is
 * also the only place in this app where the ground behind glass genuinely
 * varies, which is what makes it read as a material rather than as a tint.
 *
 * **Active is the ink pill**, not sun: sun is VNG's partner mark now and is not
 * an action colour anywhere here. Ink is what the primary button carries, and
 * the current destination is where the collector's action is. Lime is left
 * alone on purpose — it is the one accent and it belongs to progress on the
 * screen, so spending it on furniture that appears on every screen would spend
 * it five times. The centre button is the same ink and is told apart by being
 * a raised circle half out of the bar rather than a pill inside it.
 *
 * **Every label is `foreground`, active or not.** Measured: over the worst
 * content this bar can pass over — a near-black photograph, which composites
 * the bar to #C7C7C7 — `mutedForeground` reads 4.44:1 and misses AA by six
 * hundredths. The glyphs stay muted when inactive at 4.44:1, which clears
 * 1.4.11's 3:1 and is all they are held to: every one of them sits under its
 * own word. State is carried by the pill and by weight, never by colour alone.
 */

const TABS: {
  tab: TabName;
  key: MessageKey;
  Glyph: ComponentType<{ size?: number; color: string }>;
}[] = [
  { tab: 'home', key: 'tab.home', Glyph: GlyphHome },
  // `forum.title` and not a `tab.forum` of its own: the bar label and the
  // screen heading are the same word in all three catalogues.
  { tab: 'forum', key: 'forum.title', Glyph: GlyphForum },
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
            backgroundColor: active ? theme.color.action : 'transparent',
          }}
        >
          <Glyph
            size={theme.space[5]}
            color={active ? theme.color.actionInk : theme.color.mutedForeground}
          />
        </View>
        <Text
          numberOfLines={1}
          style={{
            color: theme.color.foreground,
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
        // Inset from all three edges: the bar floats over the content rather
        // than closing the screen off, and the wash it passes over is what
        // makes the glass read.
        left: theme.space[3],
        right: theme.space[3],
        // The gesture bar. Without this the labels sit under the system pill
        // and the 48dp targets stop being 48dp.
        bottom: bottomInset(theme.space[6]),
      }}
    >
      {/* The raised centre button is a sibling of the bar, not a child of it:
          it hangs above the pill's top edge and a child would be clipped by
          the `overflow: 'hidden'` the frost needs. */}
      <View
        pointerEvents="box-none"
        style={{ alignItems: 'center', justifyContent: 'flex-end', zIndex: 1 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tt('tab.session')}
          accessibilityHint={tt('tab.sessionHint')}
          onPress={() => nav.push({ name: 'sessionCreate' })}
          style={({ pressed }) => ({
            width: theme.space[12] + theme.space[2],
            height: theme.space[12] + theme.space[2],
            borderRadius: (theme.space[12] + theme.space[2]) / 2,
            backgroundColor: theme.color.action,
            alignItems: 'center',
            justifyContent: 'center',
            // A ring of the page colour around it, so the circle separates
            // from the bar it overlaps instead of merging into the ink pill of
            // whichever destination happens to be active beside it.
            borderWidth: theme.space[0.5],
            borderColor: theme.color.background,
            // It sits above the bar's top edge — the one raised element on the
            // screen, and the reason it reads as an action and not a fifth
            // destination.
            marginBottom: -theme.space[5],
            elevation: theme.elevation.floating,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <GlyphSession size={theme.space[6]} color={theme.color.actionInk} />
        </Pressable>
      </View>

      <GlassBar>
        {left.map(item)}
        {/* The centre column holds the word only; the button itself floats
            above, so this keeps the five slots evenly spaced. */}
        <View
          style={{
            width: theme.space[16],
            alignItems: 'center',
            justifyContent: 'flex-end',
            // The same padding the four destinations carry, so all five words
            // sit on one line rather than the middle one dropping 4dp.
            paddingVertical: theme.space[1],
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: theme.color.foreground,
              fontFamily: face(theme),
              fontSize: theme.fontSize.xs,
            }}
          >
            {tt('tab.session')}
          </Text>
        </View>
        {right.map(item)}
      </GlassBar>
    </View>
  );
}
