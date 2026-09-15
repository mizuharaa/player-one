import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { useSignOut } from '../session.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Loading, NavRow, Note, bottomInset, face, topInset, useTabBarReserve } from '../ui.tsx';
import { AvatarMark, initialsOf } from '../ui/illustrations/index.tsx';
import type { MessageKey } from '../i18n.ts';
import { LOCALES, type Locale } from '../i18n.ts';
import app from '../../app.json';

/**
 * Work order §4.10 — the account screen, copying `13-profile-settings`
 * (wise-583..586 for the header and the row groups, klarna-246 for the centred
 * initials mark, klarna-333 for the log-out confirmation).
 *
 * **Paper, not a gradient header.** klarna-246 puts the avatar on a purple
 * wash and SPEC.md spends the gradient on exactly three surfaces — splash,
 * Income, About. A fourth would make the decision meaningless, so the header
 * here is the plum-and-sun mark on paper and the hierarchy is carried by size
 * and weight, which is §2's anti-slop rule anyway.
 *
 * **Rows carry no icon.** wise-585 draws a circled outline glyph per row and
 * `glyphs.tsx` has seven glyphs, none of them a preference, a language or a
 * bell. Seven invented glyphs is seven drawings nobody specified; the group
 * headings and the one-line subtitles do the same sorting job. `NavRow` takes
 * an `icon` when the kit grows them.
 *
 * **A row whose screen is not in this build says so.** Notifications, About,
 * Privacy and Help are Tier B in the work order and have no `Route`. The
 * owner asked for the list, so the list is here and a tap answers with one
 * live-region sentence naming the desk instead of a dead chevron.
 */
export function Profile() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const signOut = useSignOut();
  const { locale } = useLocale();
  const reserve = useTabBarReserve();
  const { fontScale } = useWindowDimensions();
  /** Which sheet is open, or the row that has no screen yet. */
  const [sheet, setSheet] = useState<'logOut' | 'language' | null>(null);
  const [pending, setPending] = useState<MessageKey | null>(null);

  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const name = profile.data?.name ?? '';

  /** A Tier B row: answer in words rather than navigate nowhere. */
  const notYet = (row: MessageKey) => () => {
    setPending(row);
  };

  const group = (
    title: MessageKey,
    rows: readonly { key: MessageKey; sub?: MessageKey; value?: string; onPress: () => void }[],
  ) => (
    <View key={title} style={{ gap: theme.space[2], marginTop: c.sectionGap }}>
      <Text
        accessibilityRole="header"
        style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
      >
        {tt(title)}
      </Text>
      <View>
        {rows.map((row) => (
          <NavRow
            key={row.key}
            label={tt(row.key)}
            subtitle={row.value ?? (row.sub === undefined ? undefined : tt(row.sub))}
            onPress={row.onPress}
          />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ProfileScroll reserve={reserve}>
        {/* Header: the mark, the name, what the account is. Centred, because a
            single identity block is the one thing on this screen that is not a
            list and centring is how the reference separates it from one. */}
        <View style={{ alignItems: 'center', gap: theme.space[2], paddingBottom: theme.space[4] }}>
          <AvatarMark initials={initialsOf(name)} size={88} />
          <Text
            accessibilityRole="header"
            style={{ ...c.type.h1, color: c.ink, fontFamily: face(theme), textAlign: 'center' }}
          >
            {name === '' ? tt('profile.title') : name}
          </Text>
          <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>
            {profile.data === undefined || profile.data === null
              ? tt('profile.role')
              : `${tt('profile.role')} · ${profile.data.phone}`}
          </Text>
        </View>

        {profile.isPending ? <Loading /> : null}
        {profile.isError ? (
          <Note text={tt('common.loadFailed')} tone="error" onRetry={() => void profile.refetch()} busy={profile.isFetching} />
        ) : null}
        {pending === null ? null : <Note text={`${tt(pending)} — ${tt('profile.notInBuild')}`} />}

        {group('profile.account', [
          { key: 'explore.prefsTitle', sub: 'profile.preferencesSub', onPress: notYet('explore.prefsTitle') },
          { key: 'devices.title', sub: 'profile.devicesSub', onPress: () => nav.push({ name: 'devices' }) },
        ])}
        {group('profile.settings', [
          { key: 'profile.language', value: LOCALE_NAME[locale], onPress: () => setSheet('language') },
          { key: 'profile.notifications', sub: 'profile.notificationsSub', onPress: notYet('profile.notifications') },
        ])}
        {group('profile.actions', [
          { key: 'agreements.title', sub: 'profile.agreementsSub', onPress: () => nav.push({ name: 'agreements' }) },
          { key: 'profile.about', sub: 'profile.aboutSub', onPress: notYet('profile.about') },
          { key: 'profile.privacy', sub: 'profile.privacySub', onPress: notYet('profile.privacy') },
          { key: 'profile.help', sub: 'profile.helpSub', onPress: notYet('profile.help') },
        ])}

        {/* Owner's call: log out is a red fill at the foot of this screen, not
            a row in the list above it. It is the one destructive control the
            collector has, and it is one tap from a confirmation, never from the
            act (klarna-333). */}
        <View style={{ marginTop: c.sectionGap, gap: theme.space[3] }}>
          <Button
            label={tt('profile.logOut')}
            variant="destructive"
            onPress={() => setSheet('logOut')}
            accessibilityHint={tt('profile.logOutBody')}
          />
          <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>
            {`${tt('profile.version')} ${app.expo.version}`}
          </Text>
        </View>
      </ProfileScroll>

      <Sheet open={sheet === 'logOut'} onClose={() => setSheet(null)} title={tt('profile.logOutSure')}>
        <Body muted>{tt('profile.logOutBody')}</Body>
        <Button label={tt('profile.logOutConfirm')} variant="destructive" onPress={signOut} />
        <Button label={tt('common.cancel')} variant="ghost" onPress={() => setSheet(null)} />
      </Sheet>

      {/* Language: a real in-app picker (wise-678/679), one row per catalogue
          locale, each written in its own language — a locale list translated
          into the locale being left is the usual way this gets unusable. */}
      <Sheet open={sheet === 'language'} onClose={() => setSheet(null)} title={tt('profile.language')}>
        <LanguageChoices onPicked={() => setSheet(null)} stacked={fontScale > 1.2} />
      </Sheet>
    </View>
  );
}

/**
 * The scroll body.
 *
 * Not `Screen` from the kit: this screen's header is the identity block, and
 * `Screen` draws a title row with a Back control above whatever it is given —
 * which on a tab root is a title nobody needs and a second way out.
 *
 * `reserve` is `useTabBarReserve()`, measured, so the version line clears the
 * floating dock instead of sitting under it.
 */
function ProfileScroll({ reserve, children }: { reserve: number; children: ReactNode }) {
  const theme = useTheme();
  const c = theme.collector;
  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: c.gutter,
        paddingTop: topInset(theme.space[6]) + theme.space[4],
        paddingBottom: theme.space[4] + reserve,
      }}
    >
      {children}
    </ScrollView>
  );
}

/**
 * Each locale's name, written in that locale.
 *
 * Deliberately NOT message keys. A language name in its own language is the
 * same string in every catalogue, and `test/i18n.test.ts` holds the catalogue
 * to "translated, not copied" — three keys identical across all three locales
 * is exactly the shape that check exists to catch. wise-678/679 lists the
 * endonyms because a list translated into the language you are leaving is the
 * usual way this control becomes unusable, so the endonyms are data here.
 */
const LOCALE_NAME: Record<Locale, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
  zh: '中文',
};

function LanguageChoices({ onPicked, stacked }: { onPicked: () => void; stacked: boolean }) {
  const { locale, setLocale } = useLocale();
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  return (
    <View>
      {LOCALES.map((option) => {
        const selected = option === locale;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={LOCALE_NAME[option]}
            onPress={() => {
              setLocale(option);
              onPicked();
            }}
            style={({ pressed }) => ({
              minHeight: theme.space[12],
              paddingVertical: theme.space[3],
              flexDirection: stacked ? 'column' : 'row',
              alignItems: stacked ? 'flex-start' : 'center',
              justifyContent: 'space-between',
              gap: theme.space[2],
              borderBottomWidth: 1,
              borderBottomColor: c.line,
              backgroundColor: pressed ? c.paper : undefined,
            })}
          >
            <Text style={{ ...c.type.body, color: c.ink, fontFamily: face(theme), flexShrink: 1 }}>
              {LOCALE_NAME[option]}
            </Text>
            {/* A shape as well as a colour: the selected row carries a filled
                disc, so the choice is readable without the plum. */}
            <View
              importantForAccessibility="no"
              style={{
                width: theme.space[5],
                height: theme.space[5],
                borderRadius: c.radius.pill,
                borderWidth: 2,
                borderColor: selected ? c.plum : c.muted,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {selected ? (
                <View
                  style={{
                    width: theme.space[2],
                    height: theme.space[2],
                    borderRadius: c.radius.pill,
                    backgroundColor: c.plum,
                  }}
                />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A bottom sheet, copying `18-sheets-and-toggles` / klarna-333: drag affordance,
 * a heading, the content, and a scrim that dismisses.
 *
 * `Modal` from react-native core rather than a gesture-driven sheet: it is the
 * only thing in core that actually takes the Android back button and the iOS
 * accessibility focus trap with it, and drag-to-dismiss is motion work that
 * belongs in Astra's kit rather than duplicated per screen.
 *
 * ponytail: `animationType="none"`. The kit owns motion (work order §3) and a
 * sheet that springs in two different ways on two screens is worse than one
 * that appears. It also means the sheet leaves the tree the moment it closes
 * rather than waiting on an animation event, which is what a reader and a
 * test both need.
 */
function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,17,38,0.55)' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tt('common.close')}
          onPress={onClose}
          style={{ flex: 1 }}
        />
        <View
          style={{
            backgroundColor: c.surface,
            borderTopLeftRadius: c.radius.card * 1.5,
            borderTopRightRadius: c.radius.card * 1.5,
            padding: c.gutter,
            paddingBottom: c.gutter + bottomInset(theme.space[6]),
            gap: theme.space[3],
          }}
        >
          <View
            importantForAccessibility="no"
            style={{
              alignSelf: 'center',
              width: theme.space[10],
              height: theme.space[1],
              borderRadius: c.radius.pill,
              backgroundColor: c.line,
            }}
          />
          <Text
            accessibilityRole="header"
            style={{ ...c.type.h1, color: c.ink, fontFamily: face(theme) }}
          >
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}
