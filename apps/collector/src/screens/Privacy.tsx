import { useNav } from '../nav.tsx';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AGREEMENTS } from '../api/types.ts';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Card, Header, Note, Row, face, useInsets, useTabBarReserve, useReducedMotion } from '../ui.tsx';
import type { MessageKey } from '../i18n.ts';

/**
 * Work order §4.13 — Privacy, in wise-619/620's article layout: an index at
 * the top, the sections below it, and "Was this helpful?" at the end.
 *
 * **Every word of substance on this page already existed.** Privacy wording is
 * legal's to write and legal's to approve (CLAUDE.md), so this screen is a
 * reader over the copy the app already ships — the six agreement names and
 * their version from `AGREEMENTS`, `agreements.intro`, and the two APP-17b
 * declarations from the session screen. It authors no policy of its own.
 *
 * An earlier draft of this file had four sections of prose written for it.
 * That was wrong twice over: it put legal text in a screen lane's hands, and
 * it would have drifted from the six agreements a collector actually accepted
 * the moment either changed. What is left is layout over existing strings.
 *
 * The index earns its place: at 1.3x text this page is several screens long,
 * and each entry scrolls to its section's measured offset.
 */

/** The two APP-17b declarations, which are the whole of what a collector declares. */
const DECLARATIONS: readonly MessageKey[] = ['session.othersTitle', 'session.sensitiveTitle'];

export function Privacy({ onAgreements }: { onAgreements?: () => void } = {}) {
  const reduced = useReducedMotion();
  const nav = useNav();
  const openDocument = onAgreements ?? (() => nav.push({ name: 'agreements' }));
  const tt = useT();
  const theme = useTheme();
  const insets = useInsets();
  const c = theme.collector;
  const reserve = useTabBarReserve();
  const scroll = useRef<ScrollView>(null);
  /** Where each section starts, measured rather than guessed. */
  const tops = useRef<Record<string, number>>({});
  const [answered, setAnswered] = useState(false);

  const index: readonly { id: string; label: string }[] = [
    { id: 'agreements', label: tt('agreements.title') },
    { id: 'declarations', label: tt('session.declare') },
  ];

  const heading = (text: string) => (
    <Text
      accessibilityRole="header"
      style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
    >
      {text}
    </Text>
  );

  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{
        paddingHorizontal: c.gutter,
        paddingTop: 0,
        paddingBottom: theme.space[6] + Math.max(reserve, Math.max(insets.bottom, theme.space[6])),
        gap: theme.space[3],
      }}
    >
      <Header title={tt('legal.privacy')} />
      <Body muted>{tt('agreements.intro')}</Body>

      <View style={{ gap: theme.space[2], marginTop: theme.space[2] }}>
        <Text
          accessibilityRole="header"
          style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme), fontWeight: theme.fontWeight.semibold }}
        >
          {tt('privacy.index')}
        </Text>
        {index.map(({ id, label }) => (
          <Pressable
            key={id}
            accessibilityRole="link"
            accessibilityLabel={label}
            onPress={() => scroll.current?.scrollTo({ y: Math.max(0, (tops.current[id] ?? 0) - theme.space[4]), animated: !reduced })}
            style={({ pressed }) => ({ minHeight: theme.space[12], justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ ...c.type.body, color: c.plum, fontFamily: face(theme), fontWeight: theme.fontWeight.medium }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* The six agreements, by the names and versions the server's own
          `collector_agreements_name_check` closes over. The full text is on
          the agreements screen, which is where acceptance is recorded. */}
      <View
        onLayout={(event) => { tops.current.agreements = event.nativeEvent.layout.y; }}
        style={{ gap: theme.space[2], marginTop: c.sectionGap }}
      >
        {heading(tt('agreements.title'))}
        <Card>
          {AGREEMENTS.map((agreement) => (
            <Row
              key={agreement.id}
              label={tt(`agreement.${agreement.id}`)}
              value={`${tt('agreements.version')} ${agreement.version}`}
            />
          ))}
        </Card>
        {
          <Button label={tt('agreements.title')} variant="secondary" onPress={openDocument} />
        }
      </View>

      {/* APP-17b, and nothing beyond it. */}
      <View
        onLayout={(event) => { tops.current.declarations = event.nativeEvent.layout.y; }}
        style={{ gap: theme.space[2], marginTop: c.sectionGap }}
      >
        {heading(tt('session.declare'))}
        <Card>
          {DECLARATIONS.map((key) => (
            <Body key={key}>{tt(key)}</Body>
          ))}
        </Card>
        <Body muted>{tt('legal.dataNotice')}</Body>
      </View>

      {/* wise-620's footer. The answer goes nowhere yet, so it says that
          rather than implying a ticket was raised. */}
      <View style={{ marginTop: c.sectionGap, gap: theme.space[3] }}>
        {heading(tt('privacy.helpful'))}
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
