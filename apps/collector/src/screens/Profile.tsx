import { Failure, StatePanel } from '../ui/StatePanel.tsx';
import { ServerSettings } from '../ui/ServerSettings.tsx';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, RefreshControl, Text, View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { BUILD_PROFILE } from '../api/config.ts';
import { getApiOrigin, hostOf } from '../api/origin.ts';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { useSignOut } from '../session.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Field, Loading, NavRow, Note, face, useInsets, useTabBarReserve } from '../ui.tsx';
import { AvatarMark, initialsOf } from '../ui/illustrations/index.tsx';
// The sheet shell and the preferences sheet live with Explore, which has three
// sheets to this screen's two. Fable: both want to move into Astra's `ui.tsx`
// once the kit grows a sheet — they are the shared parts of this lane.
import { PreferencesSheet, Sheet, usePreferences } from './TaskHall.tsx';
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
  const [sheet, setSheet] = useState<'logOut' | 'language' | 'prefs' | 'server' | null>(null);
  const [pending, setPending] = useState<MessageKey | null>(null);
  const { prefs, save: savePrefs } = usePreferences();

  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  /**
   * The task list, for the preferences sheet's histogram.
   *
   * Same query key as Explore's, so on a phone that has already been to
   * Explore this is a cache read and no request at all — and the histogram is
   * drawn from the rows the server actually sent either way.
   */
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const name = profile.data?.name ?? '';

  /** A Tier B row: answer in words rather than navigate nowhere. */
  const notYet = (row: MessageKey) => () => {
    setPending(row);
  };

  /**
   * A group of rows under its heading.
   *
   * The Tier B answer is rendered **inside the group that caused it**, right
   * under the row that was tapped. It used to sit at the top of the screen:
   * a live region announces itself either way, but a sighted collector who
   * taps the fourth row of the third group and gets a sentence above the
   * avatar has to go looking for the reply to their own tap.
   */
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
          <View key={row.key}>
            <NavRow
              label={tt(row.key)}
              subtitle={row.value ?? (row.sub === undefined ? undefined : tt(row.sub))}
              onPress={row.onPress}
            />
            {pending === row.key ? (
              <View style={{ paddingVertical: theme.space[2] }}>
                <StatePanel title={tt('state.unavailable')} text={tt('profile.notInBuild')} action={tt('common.done')} onPress={() => setPending(null)} />
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ProfileScroll reserve={reserve} refresh={{ refreshing: profile.isRefetching || tasks.isRefetching, onRefresh: () => { void profile.refetch(); void tasks.refetch(); } }}>
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
          <Text
            numberOfLines={2}
            style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme), textAlign: 'center' }}
          >
            {profile.data === undefined || profile.data === null
              ? tt('profile.role')
              : `${tt('profile.role')} · ${profile.data.phone}`}
          </Text>
        </View>

        {profile.isPending ? <Loading /> : null}
        {profile.isError || tasks.isError ? (
          <Failure error={profile.error ?? tasks.error} text={tt('common.loadFailed')} onRetry={() => { void profile.refetch(); void tasks.refetch(); }} busy={profile.isFetching || tasks.isFetching} />
        ) : null}

        {group('profile.account', [
          { key: 'explore.prefsTitle', sub: 'profile.preferencesSub', onPress: () => setSheet('prefs') },
          { key: 'devices.title', sub: 'profile.devicesSub', onPress: () => nav.push({ name: 'devices' }) },
        ])}
        {group('profile.settings', [
          { key: 'profile.language', value: LOCALE_NAME[locale], onPress: () => setSheet('language') },
          { key: 'profile.notifications', sub: 'profile.notificationsSub', onPress: () => nav.push({ name: 'notifications' }) },
        ])}
        {group('profile.actions', [
          { key: 'agreements.title', sub: 'profile.agreementsSub', onPress: () => nav.push({ name: 'agreements' }) },
          { key: 'profile.about', sub: 'profile.aboutSub', onPress: () => nav.push({ name: 'about' }) },
          /* Which server this build talks to. Under About because that is
             where "which build am I holding" already lives, and the answer to
             that question is now two things: a version and a server.
             Absent on a Play build: the OS itself refuses plain HTTP there
             (usesCleartextTraffic/NSAllowsArbitraryLoads both false), so the
             row would only ever offer an override the platform silently
             drops. */
          ...(BUILD_PROFILE === 'play' ? [] : [{ key: 'server.title' as const, value: hostOf(getApiOrigin()), onPress: () => {
            setSheet('server');
          } }]),
          { key: 'profile.privacy', sub: 'profile.privacySub', onPress: () => nav.push({ name: 'privacy' }) },
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
          {/* The version, and which platform's build it is.
              `app.json`'s `expo.version` rather than `expo-constants`: that
              module is not a dependency of this app (DEVICE_DEPS.md lists what
              is) and one `Platform.OS` plus a JSON field answers the only
              question this line exists for — which build am I looking at. */}
          <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>
            {`${tt('profile.version')} ${app.expo.version} · ${Platform.OS}`}
          </Text>
        </View>
      </ProfileScroll>

      <Sheet open={sheet === 'logOut'} onClose={() => setSheet(null)} title={tt('profile.logOutSure')}>
        <Body muted>{tt('profile.logOutBody')}</Body>
        <Button label={tt('profile.logOutConfirm')} variant="destructive" onPress={signOut} />
        <Button label={tt('common.cancel')} variant="ghost" onPress={() => setSheet(null)} />
      </Sheet>

      {sheet === 'server' ? <ServerSettings onClose={() => setSheet(null)} /> : null}

      {/* Language: a real in-app picker (wise-678/679), one row per catalogue
          locale, each written in its own language — a locale list translated
          into the locale being left is the usual way this gets unusable. */}
      <Sheet open={sheet === 'language'} onClose={() => setSheet(null)} title={tt('profile.language')}>
        <LanguageChoices onPicked={() => setSheet(null)} stacked={fontScale > 1.2} />
      </Sheet>

      {/* The same sheet Explore opens, over the same per-account store, so the
          two screens cannot disagree about what the collector chose. Explore
          re-reads the store when it mounts. */}
      <PreferencesSheet
        open={sheet === 'prefs'}
        value={prefs}
        tasks={tasks.data ?? []}
        onClose={() => setSheet(null)}
        onSave={(next) => { savePrefs(next); setSheet(null); }}
      />
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
function ProfileScroll({ reserve, children, refresh }: { reserve: number; children: ReactNode; refresh: { refreshing: boolean; onRefresh: () => void } }) {
  const theme = useTheme();
  const insets = useInsets();
  const c = theme.collector;
  return (
    <View style={{ flex: 1, paddingBottom: reserve }}><ScrollView refreshControl={<RefreshControl {...refresh} />}
      contentContainerStyle={{
        paddingHorizontal: c.gutter,
        paddingTop: insets.top + theme.space[4],
        paddingBottom: theme.space[4],
      }}
    >
      {children}
    </ScrollView></View>
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
export const LOCALE_NAME: Record<Locale, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
  zh: '中文',
};

export function LanguageChoices({ onPicked, stacked }: { onPicked: () => void; stacked: boolean }) {
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
