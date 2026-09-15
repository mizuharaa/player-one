import { useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Screen, face } from '../ui.tsx';
import { EmptySessions } from '../ui/illustrations/index.tsx';
import type { MessageKey } from '../i18n.ts';

/** Live inbox is empty until a transport exists. Only the browser preview
 * supplies sample events; inbox and settings visibly label that simulation. */

/** What a notification is about. Decides the glyph, never the wording. */
export type NotificationKind = 'review' | 'payment' | 'session' | 'device';

export interface CollectorNotification {
  id: string;
  kind: NotificationKind;
  /** Already in the collector's language when it comes from the platform. */
  title: string;
  body: string;
  /** ISO 8601, as every other timestamp in this app arrives. */
  at: string;
  read: boolean;
}

/* ── The screen ─────────────────────────────────────────────────────────── */

const KIND_GLYPH: Record<NotificationKind, string> = {
  review: '✓',
  payment: '₫',
  session: '▣',
  device: '⌁',
};

export function Notifications({ previewItems }: { previewItems?: readonly CollectorNotification[] } = {}) {
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const simulation = previewItems !== undefined;
  const [items, setItems] = useState<readonly CollectorNotification[]>(previewItems ?? []);
  const unread = items.filter(item => !item.read).length;
  const markAllRead = () => setItems(rows => rows.map(row => ({ ...row, read: true })));
  const [settings, setSettings] = useState(false);

  if (settings) return <NotificationSettings simulation={simulation} onBack={() => setSettings(false)} />;

  const today = new Date().toDateString();
  const groups: readonly { key: MessageKey; rows: readonly CollectorNotification[] }[] = [
    { key: 'notif.today', rows: items.filter((item) => new Date(item.at).toDateString() === today) },
    { key: 'notif.earlier', rows: items.filter((item) => new Date(item.at).toDateString() !== today) },
  ];

  return (
    <Screen
      title={tt('profile.notifications')}
      right={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tt('notif.settings')}
          onPress={() => setSettings(true)}
          hitSlop={theme.space[2]}
          style={{ minHeight: theme.space[12], justifyContent: 'center' }}
        >
          <Text style={{ ...c.type.caption, color: c.plum, fontFamily: face(theme), fontWeight: theme.fontWeight.medium }}>
            {tt('notif.settings')}
          </Text>
        </Pressable>
      }
    >
      {simulation ? <Body>{tt('common.simulation')}</Body> : null}
      <Body muted>{tt('notif.noPush')}</Body>

      {items.length === 0 ? (
        <View style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[8] }}>
          <EmptySessions size={120} />
          <Text
            accessibilityRole="header"
            style={{ ...c.type.h1, color: c.ink, fontFamily: face(theme), textAlign: 'center' }}
          >
            {tt('notif.emptyTitle')}
          </Text>
          <Body muted>{tt('notif.emptyBody')}</Body>
        </View>
      ) : null}

      {groups.map(({ key, rows }) =>
        rows.length === 0 ? null : (
          <View key={key} style={{ gap: theme.space[2], marginTop: theme.space[2] }}>
            <Text
              accessibilityRole="header"
              style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme), fontWeight: theme.fontWeight.semibold }}
            >
              {tt(key)}
            </Text>
            {rows.map((item) => (
              <NotificationRow key={item.id} item={item} />
            ))}
          </View>
        ),
      )}

      {unread > 0 ? (
        <View style={{ marginTop: c.sectionGap }}>
          <Button label={tt('notif.markAllRead')} variant="secondary" onPress={markAllRead} />
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * One row: the glyph, the words, the date, and the dot.
 *
 * The unread state is a dot **and** a weight change on the title, never the
 * dot alone: one plum disc 8dp across is not a state a collector with low
 * vision can find.
 */
function NotificationRow({ item }: { item: CollectorNotification }) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.2;
  return (
    <View
      accessible
      accessibilityLabel={`${item.read ? '' : `${tt('notif.unread')}. `}${item.title}. ${item.body}`}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.space[3],
        paddingVertical: theme.space[3],
        borderBottomWidth: 1,
        borderBottomColor: c.line,
      }}
    >
      <View
        importantForAccessibility="no"
        style={{
          width: theme.space[10],
          height: theme.space[10],
          borderRadius: c.radius.pill,
          borderWidth: 1,
          borderColor: c.line,
          backgroundColor: c.paper,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ ...c.type.body, color: c.plum, fontFamily: face(theme) }}>{KIND_GLYPH[item.kind]}</Text>
      </View>
      <View style={{ flex: 1, gap: theme.space[1] }}>
        <View style={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'center', gap: theme.space[2] }}>
          <Text
            style={{
              ...c.type.body,
              color: c.ink,
              fontFamily: face(theme),
              fontWeight: item.read ? theme.fontWeight.regular : theme.fontWeight.semibold,
              flexShrink: 1,
              flexGrow: 1,
            }}
          >
            {item.title}
          </Text>
          <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>
            {new Date(item.at).toLocaleDateString()}
          </Text>
        </View>
        <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{item.body}</Text>
      </View>
      {item.read ? null : (
        <View
          importantForAccessibility="no"
          style={{ width: theme.space[2], height: theme.space[2], borderRadius: c.radius.pill, backgroundColor: c.plum, marginTop: theme.space[2] }}
        />
      )}
    </View>
  );
}

/* ── Settings (wise-670..673) ───────────────────────────────────────────── */

const GROUPS: readonly { key: MessageKey; why: MessageKey }[] = [
  { key: 'notif.groupReview', why: 'notif.groupReviewWhy' },
  { key: 'notif.groupPayment', why: 'notif.groupPaymentWhy' },
  { key: 'notif.groupSession', why: 'notif.groupSessionWhy' },
];

type Channels = { email: boolean; push: boolean };

function NotificationSettings({ onBack, simulation }: { onBack: () => void; simulation: boolean }) {
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const [state, setState] = useState<Record<string, Channels>>(() =>
    Object.fromEntries(GROUPS.map((group) => [group.key, { email: false, push: false }])),
  );

  const set = (key: string, channel: keyof Channels, value: boolean) =>
    setState((rows) => ({ ...rows, [key]: { ...(rows[key] ?? { email: false, push: false }), [channel]: value } }));

  return (
    <Screen title={tt('notif.settings')} onBack={onBack}>
      {/* The honest sentence first: nothing here reaches a server yet. */}
      {simulation ? <Body>{tt('common.simulation')}</Body> : null}
      <Body muted>{tt('notif.settingsIntro')}</Body>
      {GROUPS.map(({ key, why }) => {
        const channels = state[key] ?? { email: false, push: false };
        return (
          <View key={key} style={{ gap: theme.space[2], marginTop: c.sectionGap }}>
            <Text
              accessibilityRole="header"
              style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
            >
              {tt(key)}
            </Text>
            <Body muted>{tt(why)}</Body>
            <Toggle disabled={!simulation}
              label={`${tt(key)} — ${tt('notif.email')}`}
              printed={tt('notif.email')}
              value={channels.email}
              onChange={(v) => set(key, 'email', v)}
            />
            <Toggle disabled={!simulation}
              label={`${tt(key)} — ${tt('notif.push')}`}
              printed={tt('notif.push')}
              value={channels.push}
              onChange={(v) => set(key, 'push', v)}
            />
          </View>
        );
      })}
    </Screen>
  );
}

/**
 * A switch row.
 *
 * `label` is what a reader hears — the group's name and the channel, because
 * "Push" six times on one screen names nothing — and `printed` is the word on
 * the row, where the group heading above it supplies the rest.
 */
function Toggle({
  label,
  printed,
  value,
  onChange,
  disabled,
}: {
  label: string;
  printed: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const c = theme.collector;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      // React Native forwards `aria-checked` on its own since 0.71, and
      // `react-native-web` needs it: it does not map a switch's
      // `accessibilityState.checked` onto the DOM attribute.
      aria-checked={value}
      onPress={() => onChange(!value)}
      style={({ pressed }) => ({
        minHeight: theme.space[12],
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space[3],
        borderBottomWidth: 1,
        borderBottomColor: c.line,
        backgroundColor: pressed ? c.surface : undefined,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={{ ...c.type.body, color: c.ink, fontFamily: face(theme), flexShrink: 1 }}>{printed}</Text>
      <View
        importantForAccessibility="no"
        style={{
          width: theme.space[10],
          height: theme.space[6],
          borderRadius: c.radius.pill,
          padding: 2,
          backgroundColor: value ? c.plum : c.line,
          alignItems: value ? 'flex-end' : 'flex-start',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: theme.space[5], height: theme.space[5], borderRadius: c.radius.pill, backgroundColor: c.surface }} />
      </View>
    </Pressable>
  );
}
