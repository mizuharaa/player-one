import { useRef, useState, type ComponentType } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuide } from '../guide/Guide.tsx';
import { Button, bottomInset, face, topInset, useReducedMotion } from '../ui.tsx';
import { FindWork, ReviewedThenPaid, WearCamera } from '../ui/illustrations/index.tsx';
import type { MessageKey } from '../i18n.ts';

/**
 * Work order §4.1 — three full-bleed cards, copying wise-004..006.
 *
 * The reference's shape: a progress strip at the top, one large object in the
 * upper half, an all-caps display headline, a supporting line, and a single
 * full-width pill at the foot. Three differences, each deliberate:
 *
 * - **Headlines are left-aligned.** wise-004..006 centre them; §2's anti-slop
 *   law says left, and it is the rule the rest of this app follows. The
 *   all-caps display weight is what carries the reference's voice, not the
 *   alignment.
 * - **Dots, not a filling bar** (owner, §4.1). Same information, and a bar
 *   across the top of a card that is not a process reads as loading.
 * - **No consent of any kind here.** klarna-001/002's checkbox card belongs
 *   where APP-17b already lives, on Prepare. CLAUDE.md: no collector consent
 *   field beyond APP-17b, and a card headed "I agree" on the first screen
 *   after sign-in is how a second one gets invented.
 *
 * The last card's CTA is "Show me around" and it calls the tour that already
 * exists — `useGuide().accept()` — rather than a second coach-mark
 * implementation. `onDone` runs first so Home is mounted and its targets are
 * measurable when the overlay looks for them; `accept()` also records the
 * offer as answered, so the tour is not offered again on Home.
 *
 * **Not a `Route`.** Like `Landing` and `SignIn` this is what the app is at a
 * moment, not a place to navigate to, so it takes its handover as a prop and
 * `nav.tsx`'s registry is untouched. It must be mounted inside `GuideProvider`
 * for the tour CTA to work.
 */
const CARDS: readonly {
  key: string;
  title: MessageKey;
  body: MessageKey;
  Art: ComponentType<{ size?: number }>;
}[] = [
  { key: 'find', title: 'onboarding.findTitle', body: 'onboarding.findBody', Art: FindWork },
  { key: 'wear', title: 'onboarding.wearTitle', body: 'onboarding.wearBody', Art: WearCamera },
  { key: 'paid', title: 'onboarding.paidTitle', body: 'onboarding.paidBody', Art: ReviewedThenPaid },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  const guide = useGuide();
  const reduced = useReducedMotion();
  const { width, fontScale } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const pager = useRef<ScrollView>(null);
  const last = index === CARDS.length - 1;

  /**
   * How tall the drawing is allowed to be.
   *
   * It is the one element on the card that can give up room, so at 1.3× text
   * it shrinks and the headline, the line under it and the button keep their
   * own. A fixed 160 clipped the third card's headline at 320×640 and 1.3×.
   */
  const art = Math.min(width * 0.44, fontScale > 1.15 ? 120 : 180);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(CARDS.length - 1, next));
    setIndex(clamped);
    pager.current?.scrollTo({ x: clamped * width, animated: !reduced });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      {/* Skip is top-right and present on every card, including the last: a
          collector who does not want the tour should not have to take it to
          get past this screen. */}
      <View
        style={{
          paddingTop: topInset(theme.space[6]) + theme.space[2],
          paddingHorizontal: c.gutter,
          alignItems: 'flex-end',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tt('onboarding.skip')}
          onPress={onDone}
          hitSlop={theme.space[3]}
          style={({ pressed }) => ({
            minHeight: theme.space[12],
            minWidth: theme.space[12],
            justifyContent: 'center',
            alignItems: 'flex-end',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            style={{
              ...c.type.body,
              color: c.plum,
              fontFamily: face(theme),
              fontWeight: theme.fontWeight.medium,
            }}
          >
            {tt('onboarding.skip')}
          </Text>
        </Pressable>
      </View>

      {/* A paging ScrollView rather than three buttons: swiping between intro
          cards is what a phone does, it is free in core, and `onMomentumScrollEnd`
          keeps the dots honest about where the collector actually is. */}
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const page = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
          if (page !== index) setIndex(page);
        }}
        style={{ flex: 1 }}
      >
        {CARDS.map(({ key, title, body, Art }) => (
          <View
            key={key}
            style={{
              width,
              paddingHorizontal: c.gutter,
              paddingVertical: theme.space[4],
              gap: theme.space[4],
              justifyContent: 'center',
            }}
          >
            <View style={{ alignItems: 'center' }}>
              <Art size={art} />
            </View>
            <Text
              accessibilityRole="header"
              style={{
                ...c.type.display,
                color: c.ink,
                fontFamily: face(theme),
                letterSpacing: -0.5,
              }}
            >
              {tt(title)}
            </Text>
            <Text style={{ ...c.type.body, color: c.muted, fontFamily: face(theme) }}>
              {tt(body)}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: c.gutter,
          paddingBottom: theme.space[4] + bottomInset(theme.space[6]),
          gap: theme.space[4],
        }}
      >
        {/* The dots are one control, not three: they say which card this is and
            they move the pager. Announced once, with the card's own headline as
            the value, so TalkBack says where you are rather than "dot, dot,
            dot". */}
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={tt('onboarding.progress')}
          accessibilityValue={{ text: tt(CARDS[index]?.title ?? 'onboarding.findTitle') }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            go(index + (event.nativeEvent.actionName === 'decrement' ? -1 : 1));
          }}
          style={{
            flexDirection: 'row',
            gap: theme.space[2],
            justifyContent: 'center',
            minHeight: theme.space[12],
            alignItems: 'center',
          }}
        >
          {CARDS.map(({ key }, i) => (
            <View
              key={key}
              importantForAccessibility="no"
              style={{
                // The active dot is a pill, so the position is readable as a
                // shape and not only as a colour.
                width: i === index ? theme.space[6] : theme.space[2],
                height: theme.space[2],
                borderRadius: c.radius.pill,
                backgroundColor: i === index ? c.plum : c.line,
              }}
            />
          ))}
        </View>
        <Button
          label={tt(last ? 'onboarding.tour' : 'common.next')}
          onPress={() => {
            if (!last) {
              go(index + 1);
              return;
            }
            // Home first, then the tour: `GuideOverlay` measures the target it
            // is about to point at, and a target on a screen that has not
            // mounted measures to nothing.
            onDone();
            guide.accept();
          }}
        />
      </View>
    </View>
  );
}
