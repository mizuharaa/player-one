import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Note, bottomInset, face, topInset, useTabBarReserve } from '../ui.tsx';
import type { MessageKey } from '../i18n.ts';

/**
 * Work order §4.13 — Privacy, copying wise-619/620's article layout: a section
 * index at the top, the sections below it, and "Was this helpful?" at the end.
 *
 * **The words are the legal copy this product already has**, not new policy.
 * Privacy is legal's problem (CLAUDE.md) and the four sections here restate
 * what the app already tells a collector elsewhere: what the camera records,
 * who reviews it, what must not be recorded, and the two APP-17b declarations
 * that are the whole of what a collector declares. Nothing here invents a
 * third consent or a new obligation.
 *
 * The index is not decoration: at 1.3x text this page is several screens long,
 * and the alternative to an index is scrolling past three sections to reach
 * the one that answers the question. Each entry scrolls to its section, which
 * is the only thing on the page that moves.
 */
const SECTIONS: readonly { key: MessageKey; body: MessageKey }[] = [
  { key: 'privacy.s1', body: 'privacy.s1Body' },
  { key: 'privacy.s2', body: 'privacy.s2Body' },
  { key: 'privacy.s3', body: 'privacy.s3Body' },
  { key: 'privacy.s4', body: 'privacy.s4Body' },
];

export function Privacy() {
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const reserve = useTabBarReserve();
  const scroll = useRef<ScrollView>(null);
  /** Where each section starts, measured rather than guessed. */
  const tops = useRef<Record<string, number>>({});
  const [answered, setAnswered] = useState(false);

  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{
        paddingHorizontal: c.gutter,
        paddingTop: topInset(theme.space[6]) + theme.space[4],
        paddingBottom: theme.space[6] + Math.max(reserve, bottomInset(theme.space[6])),
        gap: theme.space[3],
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ ...c.type.h1, color: c.ink, fontFamily: face(theme), letterSpacing: -0.5 }}
      >
        {tt('profile.privacy')}
      </Text>

      <View style={{ gap: theme.space[2], marginTop: theme.space[2] }}>
        <Text
          accessibilityRole="header"
          style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme), fontWeight: theme.fontWeight.semibold }}
        >
          {tt('privacy.index')}
        </Text>
        {SECTIONS.map(({ key }) => (
          <Pressable
            key={key}
            accessibilityRole="link"
            accessibilityLabel={tt(key)}
            onPress={() => scroll.current?.scrollTo({ y: Math.max(0, (tops.current[key] ?? 0) - theme.space[4]), animated: true })}
            style={({ pressed }) => ({
              minHeight: theme.space[12],
              justifyContent: 'center',
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
              {tt(key)}
            </Text>
          </Pressable>
        ))}
      </View>

      {SECTIONS.map(({ key, body }) => (
        <View
          key={key}
          onLayout={(event) => { tops.current[key] = event.nativeEvent.layout.y; }}
          style={{ gap: theme.space[2], marginTop: c.sectionGap }}
        >
          <Text
            accessibilityRole="header"
            style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
          >
            {tt(key)}
          </Text>
          <Body>{tt(body)}</Body>
        </View>
      ))}

      {/* wise-620's footer. Two buttons and one acknowledgement; the answer
          goes nowhere yet, so it says that rather than implying a ticket. */}
      <View style={{ marginTop: c.sectionGap, gap: theme.space[3] }}>
        <Text
          accessibilityRole="header"
          style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
        >
          {tt('privacy.helpful')}
        </Text>
        {answered ? (
          <Note text={tt('privacy.thanks')} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
            <View style={{ flexGrow: 1, flexBasis: '40%' }}>
              <Button label={tt('privacy.yes')} variant="secondary" onPress={() => setAnswered(true)} />
            </View>
            <View style={{ flexGrow: 1, flexBasis: '40%' }}>
              <Button label={tt('privacy.no')} variant="secondary" onPress={() => setAnswered(true)} />
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
