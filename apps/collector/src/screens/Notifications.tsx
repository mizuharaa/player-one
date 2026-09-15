import { useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Screen, face } from '../ui.tsx';
import { EmptySessions } from '../ui/illustrations/index.tsx';
import type { MessageKey } from '../i18n.ts';

/**
 * Work order §4.11 — the inbox and its settings.
 *
 * The list copies klarna-288 and wise-613: a circled category glyph, a title,
 * one line of body, the date on the right, grouped under Today and Earlier,
 * with an unread dot on the rows that have not been read. The settings
 * sub-screen copies wise-670..673: one explanatory sentence per group, then
 * the Email and Push toggles for that group.
 *
 * **There is no push transport, and this screen does not pretend there is.**
 * The work order's "Not built" list names it. `useNotifications` below is a
 * typed fixture behind the shape the real hook will have, so the screen can be
 * designed, shot and reviewed now and swapped to a query later without a
 * single change above the hook. The settings toggles are the same: they are
 * local state over that fixture, and the screen says plainly that nothing is
 * sent yet rather than implying a preference was saved on a server.
 */

/* ── The data this screen needs, and the fixture standing in for it ─────── */

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

/**
 * Four rows that exercise every state this screen has: unread and read, all
 * four kinds, and both date groups.
 *
 * Fixture numbers are real shapes rather than lorem (§2's anti-slop law), and
 * no row states an amount — a payment notification that named a figure would
 * be a money number this app invented.
 */
const FIXTURE: readonly CollectorNotification[] = [
  {
    id: 'n-1',
    kind: 'review',
    title: 'Một video đã được duyệt',
    body: 'Buổi ghi ngày 12/09 đã qua duyệt. Số phút hiệu quả nằm trong mục Thu nhập.',
    at: new Date().toISOString(),
    read: false,
  },
  {
    id: 'n-2',
    kind: 'session',
    title: 'Nhớ mang thẻ nhớ tới quầy',
    body: 'Buổi ghi hôm nay đã xong. Mang thẻ tới quầy để nhân viên nhận.',
    at: new Date().toISOString(),
    read: false,
  },
  {
    id: 'n-3',
    kind: 'payment',
    title: 'Kỳ thanh toán đã chốt',
    body: 'Kỳ 01/09 – 07/09 đã chốt. Xem chi tiết trong mục Thu nhập.',
    at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    read: true,
  },
  {
    id: 'n-4',
    kind: 'device',
    title: 'Thiết bị cần sạc',
    body: 'Máy EGO1-PILOT-0007 báo pin yếu ở lần bàn giao trước.',
    at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    read: true,
  },
];

/**
 * The inbox.
 *
 * ponytail: a fixture behind a hook, not a fake API client. The seam that has
 * to be right is this function's return type — `{ items, unread, markAllRead }`
 * — and that is what the notifications lane replaces with a `useQuery`. Writing
 * a second mock transport for a channel that does not exist yet would be
 * building the thing the work order says is not built.
 */
export function useNotifications(): {
  items: readonly CollectorNotification[];
  unread: number;
  markAllRead: () => void;
} {
  const [items, setItems] = useState(FIXTURE);
  return {
    items,
    unread: items.filter((item) => !item.read).length,
    markAllRead: () => setItems((rows) => rows.map((row) => ({ ...row, read: true }))),
  };
}

/* ── The screen ─────────────────────────────────────────────────────────── */

const KIND_GLYPH: Record<NotificationKind, string> = {
  review: '✓',
  payment: '₫',
  session: '▣',
  device: '⌁',
};

export function Notifications() {
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const { items, unread, markAllRead } = useNotifications();
  const [settings, setSettings] = useState(false);

  if (settings) return <NotificationSettings onBack={() => setSettings(false)} />;

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

function NotificationSettings({ onBack }: { onBack: () => void }) {
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const [state, setState] = useState<Record<string, Channels>>(() =>
    Object.fromEntries(GROUPS.map((group) => [group.key, { email: true, push: false }])),
  );

  const set = (key: string, channel: keyof Channels, value: boolean) =>
    setState((rows) => ({ ...rows, [key]: { ...(rows[key] ?? { email: false, push: false }), [channel]: value } }));

  return (
    <Screen title={tt('notif.settings')} onBack={onBack}>
      {/* The honest sentence first: nothing here reaches a server yet. */}
      <Body muted>{tt('notif.settingsIntro')}</Body>
      {GROUPS.map(({ key, why }) => {
        const channels = state[key] ?? { email: true, push: false };
        return (
          <View key={key} style={{ gap: theme.space[2], marginTop: c.sectionGap }}>
            <Text
              accessibilityRole="header"
              style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
            >
              {tt(key)}
            </Text>
            <Body muted>{tt(why)}</Body>
            <Toggle
              label={`${tt(key)} — ${tt('notif.email')}`}
              printed={tt('notif.email')}
              value={channels.email}
              onChange={(v) => set(key, 'email', v)}
            />
            <Toggle
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
}: {
  label: string;
  printed: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  const c = theme.collector;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
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
        backgroundColor: pressed ? c.paper : undefined,
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
