import { Failure, StatePanel } from '../ui/StatePanel.tsx';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { dong, quantity, vnd } from '../money.ts';
import { Body, Button, Loading, Note, Screen, face } from '../ui.tsx';
import { EmptySessions } from '../ui/illustrations/index.tsx';
import type { MessageKey } from '../i18n.ts';
import type { CollectorNotificationRow, NotificationKind as ServerKind } from '../api/types.ts';

/**
 * The inbox reads `GET /api/me/notifications` — rows `notify()` wrote inside
 * the transaction of the event they describe (`docs/notifications.md`).
 *
 * There is still **no transport**: push needs an FCM project and an APNs key,
 * ZNS needs an approved template per message, and none of those credentials
 * exist. So `notif.noPush` stays on the screen and stays true — a collector who
 * does not open the app does not find out. What changed is that opening it now
 * shows what actually happened instead of an empty list.
 *
 * `previewItems` is the browser harness and the screen tests, which need rows
 * without a server; it is labelled as a simulation on the screen and is never
 * mounted by the live route.
 */

/** What a notification is about. Decides the glyph, never the wording. */
export type NotificationKind = 'review' | 'payment' | 'session' | 'device' | 'task';

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
  task: '▤',
};

/**
 * The server's kind → the glyph group. A `Record` over the closed union, so a
 * fourteenth kind added to `NOTIFICATION_KINDS` does not compile until somebody
 * has decided which glyph it wears and written its sentence.
 */
const KIND_GROUP: Record<ServerKind, NotificationKind> = {
  upload_verified: 'session',
  upload_ingested: 'session',
  upload_held: 'session',
  upload_failed: 'session',
  review_passed: 'review',
  review_partial: 'review',
  review_failed: 'review',
  bill_issued: 'payment',
  payment_recorded: 'payment',
  payout_account_verified: 'payment',
  payout_account_refused: 'payment',
  task_published: 'task',
  claim_accepted: 'task',
  unknown: 'session',
};

/** The sentence per kind. Carries no figure; see `figuresOf`. */
const KIND_TITLE: Record<ServerKind, MessageKey> = {
  upload_verified: 'notif.upload_verified',
  upload_ingested: 'notif.upload_ingested',
  upload_held: 'notif.upload_held',
  upload_failed: 'notif.upload_failed',
  review_passed: 'notif.review_passed',
  review_partial: 'notif.review_partial',
  review_failed: 'notif.review_failed',
  bill_issued: 'notif.bill_issued',
  payment_recorded: 'notif.payment_recorded',
  payout_account_verified: 'notif.payout_account_verified',
  payout_account_refused: 'notif.payout_account_refused',
  task_published: 'notif.task_published',
  claim_accepted: 'notif.claim_accepted',
  unknown: 'notif.update',
};

/**
 * The row's second line: the server's stored figures, printed and nothing else.
 *
 * Every string here comes out of `payload` and goes through `vnd`, `dong` or
 * `quantity`, which do two string operations and no arithmetic. This function
 * adds nothing, divides nothing and rounds nothing — APP-34 is why, and
 * `quantise` on the server is the one place a figure is ever rounded.
 *
 * A kind with no figure returns the empty string. That is a row with one line,
 * not a row with a blank second line to fill.
 */
function figuresOf(
  kind: ServerKind,
  payload: Record<string, string | null>,
  tt: (key: MessageKey) => string,
): string {
  const at = (key: string): string | null => {
    const v = payload[key];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  const join = (parts: (string | null)[]): string => parts.filter((p) => p !== null).join(' · ');

  switch (kind) {
    case 'review_passed':
    case 'review_partial':
    case 'review_failed': {
      const minutes = at('effective_minutes');
      const amount = at('amount');
      return join([
        minutes === null ? null : `${tt('income.minutes')} ${quantity(minutes)}`,
        amount === null ? null : dong(amount),
      ]);
    }
    case 'bill_issued': {
      const total = at('total');
      return total === null ? '' : dong(total);
    }
    case 'payment_recorded': {
      const amount = at('amount_vnd');
      return join([amount === null ? null : dong(amount), at('reference')]);
    }
    case 'task_published': {
      const price = at('unit_price');
      return join([at('task_name'), price === null ? null : `${vnd(price)} ${tt('hall.perMinute')}`]);
    }
    default:
      return '';
  }
}

/** A server row as the screen's own shape. */
const toItem = (
  row: CollectorNotificationRow,
  tt: (key: MessageKey) => string,
): CollectorNotification => ({
  id: row.id,
  kind: KIND_GROUP[row.kind],
  title: tt(KIND_TITLE[row.kind]),
  body: [row.payload.simulation === 'true' ? tt('payout.simulation') : '', figuresOf(row.kind, row.payload, tt)].filter(Boolean).join(' - '),
  at: row.createdAt,
  read: row.readAt !== null,
});

export function Notifications({ previewItems }: { previewItems?: readonly CollectorNotification[] } = {}) {
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const api = useApi();
  const simulation = previewItems !== undefined;
  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications(),
    enabled: !simulation,
  });
  const [preview, setPreview] = useState<readonly CollectorNotification[]>(previewItems ?? []);
  const [markError, setMarkError] = useState<unknown>(null);
  const [marking, setMarking] = useState(false);
  /**
   * The first read is still out.
   *
   * A disabled react-query query reports `isPending` for ever, so the
   * `simulation` half of this is load-bearing rather than defensive: without it
   * the harness would sit on `Loading…` and never draw its fixture.
   */
  const pending = !simulation && inbox.isPending;
  const items: readonly CollectorNotification[] = simulation
    ? preview
    : (inbox.data ?? []).map((row) => toItem(row, tt));
  const unread = items.filter(item => !item.read).length;
  /**
   * One POST per unread row, then a refetch.
   *
   * ponytail: the server has no mark-all route and this does not add one — the
   * read stamp is per notification because `read_at` is the record that a
   * person saw THAT thing. At pilot scale an inbox holds tens of rows. Add a
   * bulk route the first time somebody's unread count is in the hundreds.
   */
  const markAllRead = async () => {
    if (simulation) {
      setPreview(rows => rows.map(row => ({ ...row, read: true })));
      return;
    }
    setMarking(true); setMarkError(null);
    try {
      for (const item of items.filter((row) => !row.read)) await api.markNotificationRead(item.id);
      await inbox.refetch();
    } catch (error) {
      setMarkError(error);
    } finally {
      setMarking(false);
    }
  };
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

      {/**
       * The unavailable state. `loadFailed` when there is nothing on screen and
       * `refreshFailed` when the rows below are the previous load — the same
       * two sentences every other list in this app uses, and the distinction
       * matters because one of them means "what you are reading is stale" and
       * the other means "there is nothing to read".
       */}
      {inbox.isError ? (
        <Failure error={inbox.error}
          tone="error"
          text={tt(inbox.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')}
          busy={inbox.isFetching}
          onRetry={() => void inbox.refetch()}
        />
      ) : null}

      {markError ? <Failure error={markError} text={tt('common.actionFailed')} onRetry={() => void markAllRead()} busy={marking} /> : null}
      {pending ? <Loading /> : null}

      {/* Never the empty state while the first read is out or after it failed:
          "nothing yet" is a claim about the server's answer, and neither of
          those is an answer. */}
      {items.length === 0 && !pending && !inbox.isError ? (
        <View style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[8] }}>
          <EmptySessions size={120} />
          <Text
            accessibilityRole="header"
            style={{ ...c.type.h1, color: c.ink, fontFamily: face(theme), textAlign: 'center' }}
          >
            {tt('notif.emptyTitle')}
          </Text>
          <Body muted>{tt('notif.emptyBody')}</Body>
          <Button label={tt('common.retry')} onPress={() => void inbox.refetch()} busy={inbox.isFetching} variant="secondary" />
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
          <Button label={tt('notif.markAllRead')} variant="secondary" busy={marking} onPress={() => void markAllRead()} />
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
      accessibilityLabel={`${item.read ? '' : `${tt('notif.unread')}. `}${item.title}${item.body === '' ? '' : `. ${item.body}`}`}
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
        {/* A kind with no figure is a one-line row, not a row with a gap. */}
        {item.body === '' ? null : (
          <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{item.body}</Text>
        )}
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
      {simulation ? <Body muted>{tt('notif.settingsIntro')}</Body> : <StatePanel title={tt('state.unavailable')} text={tt('notif.settingsIntro')} action={tt('common.back')} onPress={onBack} />}
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
