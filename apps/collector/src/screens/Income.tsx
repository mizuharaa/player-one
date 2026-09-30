import { Panda } from '../identity/Panda.tsx';
import { Failure } from '../ui/StatePanel.tsx';
import { useRef, useState } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { IncomeEntry } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { polish, useTheme } from '../theme.tsx';
import { Icon, FeatureIcon } from '../ui/Icon.tsx';
import { Image, type ImageSource } from 'expo-image';
import { HeaderGradient } from '../ui/HeaderGradient.tsx';
import { taskImage, taskImageLabel } from '../ui/taskImage.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Body, face, Chip, Hatch, NavRow, ListScreen, Loading, Note, Row, Screen, Tag, Timeline } from '../ui.tsx';
import { useNav } from '../nav.tsx';
import { dong, incomeStatus, isLivePaid, quantity, shortId } from '../money.ts';
import type { MessageKey } from '../i18n.ts';

/**
 * Every state this row can be handed, in the collector's language. The screen
 * used to print the raw column value, so a Vietnamese collector read
 * "bill_generated". An unknown value falls back to itself rather than
 * disappearing — a state the server invented later should be visible, not
 * silently blank.
 *
 * Two vocabularies, because there are two servers behind this screen. The first
 * five are `settlements.settlement_state` (`packages/store/src/schema.ts`),
 * which is what `MockCollectorApi` serves. The eleven below are
 * `CollectorState` in `packages/api/src/me.ts`, which is what the real
 * `GET /api/me/income` serves — the internal world already reduced to what a
 * collector is allowed to be told.
 */
const SETTLEMENT_STATES: Record<string, MessageKey> = {
  pending_review: 'settlement.pending_review',
  pending_settlement: 'settlement.pending_settlement',
  bill_generated: 'settlement.bill_generated',
  manually_paid: 'settlement.manually_paid',
  exception: 'settlement.exception',

  uploaded: 'settlement.uploaded',
  approved: 'settlement.approved',
  not_paid: 'settlement.not_paid',
  on_a_bill: 'settlement.on_a_bill',
  action_needed: 'settlement.action_needed',
  waiting_on_us: 'settlement.waiting_on_us',
  on_hold: 'settlement.on_hold',
  being_rechecked: 'settlement.being_rechecked',
  paid: 'settlement.paid',
  cannot_be_paid: 'settlement.cannot_be_paid',
  unknown: 'settlement.unknown',
};

const settlementLabel = (tt: (key: MessageKey) => string, state: string): string => {
  const key = SETTLEMENT_STATES[state];
  return key === undefined ? state : tt(key);
};

/** States recorded as paid; simulation provenance still determines whether money moved. */
const PAID = new Set(['manually_paid', 'paid']);

/**
 * One episode's life, as far as the server has told us.
 *
 * Wise's checkmark timeline, and its rule about weight: a step is bold only
 * once it has happened. "Reviewed" is ticked when the entry is confirmed —
 * `kind === 'confirmed'` is exactly "a reviewer decided" — and "Paid" only when
 * the settlement state says so. Nothing here infers a step from a figure being
 * present: an estimate has an amount too, and drawing that as reviewed would be
 * the app telling a collector they had been paid.
 *
 * There is no separate "under review" checkpoint: `/api/me/income` reports
 * `uploaded` both before a reviewer claims the episode and while that review
 * is pending. The client cannot tell when review started from this response.
 */
const lifecycle = (
  tt: (key: MessageKey) => string,
  entry: IncomeEntry,
): { key: string; label: string; done: boolean; current?: boolean; note?: string }[] => {
  const reviewed = entry.kind === 'confirmed';
  const nonpayable = incomeStatus(entry).startsWith('settlement.');
  const paid = entry.settlementState !== null && PAID.has(entry.settlementState);
  const awaiting = reviewed && ['pending_settlement', 'bill_generated', 'approved', 'on_a_bill', 'waiting_on_us'].includes(entry.settlementState ?? '');
  const steps = [
    { key: 'uploaded', label: tt('income.step.uploaded'), done: entry.settlementState !== null && entry.settlementState !== 'unknown' },
    {
      key: 'reviewed',
      label: tt('income.step.reviewed'),
      done: reviewed,
      note: reviewed ? undefined : tt('income.estimatedHint'),
    },
    {
      key: 'paid',
      label: nonpayable ? tt(incomeStatus(entry)) : tt(paid ? 'income.step.paid' : awaiting ? 'home.awaiting' : 'income.step.payment'),
      done: paid,
      note:
        nonpayable || entry.settlementState === null ? undefined : settlementLabel(tt, entry.settlementState),
    },
  ];
  const current = steps.findIndex(step => !step.done);
  return steps.map((step, index) => ({ ...step, current: !nonpayable && index === current }));
};

export function Income() {
  const api = useApi();
  const { width, fontScale } = useWindowDimensions();
  const stackFigures = width < 360 || fontScale > 1.2;
  const nav = useNav();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [showDestination, setShowDestination] = useState(false);
  const [extra, setExtra] = useState<'statement' | 'help' | null>(null);
  const tt = useT();
  const theme = useTheme();
  const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });
  const cycle = useQuery({ queryKey: ['income', 'cycle'], queryFn: () => api.incomeCycle() });
  const payout = useQuery({ queryKey: ['payout'], queryFn: () => api.payout() });
  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.sessions() });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const awaitingReview = income.data?.some(entry => entry.kind === 'estimated' && ['uploaded', 'pending_review'].includes(entry.settlementState ?? ''))
    || episodes.data?.some(episode => episode.state === 'uploaded' || episode.state === 'under_review');
  const queries = [income, cycle, payout];
  const failed = queries.find(q => q.isError && q.data === undefined) ?? queries.find(q => q.isError);
  const listTarget = useGuideTarget('income.list');

  const c = theme.collector;
  const cycleData = cycle.data ?? null;
  const currentSelection = income.data?.find(entry => entry.episodeId === selectedId);
  const lastSelection = useRef<IncomeEntry | undefined>(undefined);
  if (currentSelection) lastSelection.current = currentSelection;
  // Keep the content stable throughout the sheet's closing animation.
  const selected = currentSelection ?? lastSelection.current;
  const status = payout.data?.status ?? null;
  const statusKey: MessageKey = status === 'verified' ? 'payout.verified' : status === 'none' ? 'payout.none' : 'payout.awaiting';
  const destination = <>
    {payout.isPending ? <Loading /> : payout.isError ? <Body muted>{tt('common.loadFailed')}</Body> : <>
      <Tag label={status === 'verified' && payout.data?.verification_simulation ? `${tt(statusKey)} - ${tt('payout.simulationLabel')}` : tt(statusKey)} fg={c.ink} bg={c.paper} mark={status === 'verified' ? '✓' : '?'} />
      <Body>{status === null ? tt('payout.unknown') : payout.data?.masked ? `${tt('payout.zalopay')} · ${payout.data.masked}` : tt('payout.zalopay')}</Body>
      {status === 'awaiting' ? <Body muted>{tt('payout.awaitingPayment')}</Body> : null}
      {payout.data?.payment ? <Body muted>{tt('payout.paidReference').replace('{reference}', payout.data.payment.reference)}</Body> : null}
      {payout.data?.payment && payout.data.simulation ? <Body muted>{tt('payout.simulation')}</Body> : null}
    </>}
  </>;
  return <>
    <ListScreen ambientHeader title={tt('income.title')} data={income.data ?? []} keyOf={entry => entry.episodeId}
      refresh={{ refreshing: income.isFetching || cycle.isFetching || payout.isFetching, onRefresh: () => { for (const q of [...queries, episodes, sessions, tasks]) void q.refetch(); } }}
      masthead={<HeaderGradient>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Text accessibilityRole="header" style={{ ...c.type.h1, fontFamily: face(theme), color: c.ink, flex: 1 }}>{tt('income.title')}</Text><Panda size={64} pose="review" /></View>
        <View style={{ gap: 8, paddingTop: 18, paddingBottom: 20 }}>
          <Text style={{ ...c.type.body, fontFamily: face(theme), color: c.muted }}>{tt('income.confirmedEarnings')}</Text>
          {cycle.isPending ? <Loading kind="number" /> : <Text testID="income-headline-amount" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ ...c.type.money, fontFamily: face(theme), color: c.plum, fontVariant: ['tabular-nums'] }}>{cycleData ? dong(cycleData.confirmedVnd) : NOTHING}</Text>}
          <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.muted }}>{tt(cycleData ? 'income.reviewedCaption' : 'income.notAvailable')}</Text>
          {cycleData ? <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.muted }}>{cycleData.label}</Text> : null}
        </View>
        <View style={{ flexDirection: stackFigures ? 'column' : 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line }}>
          <View style={{ flex: 1, gap: 5 }}><Text style={{ ...c.type.body, fontWeight: '600', color: c.ink, fontFamily: face(theme) }}>{tt(awaitingReview ? 'income.awaitingTitle' : 'income.estimated')}</Text><Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt('income.estimated')}</Text></View>
          {cycle.isPending ? <Loading kind="number" /> : <Text testID="income-headline-amount" style={{ ...c.type.h2, fontFamily: face(theme), color: c.ink, fontVariant: ['tabular-nums'] }}>{cycleData ? dong(cycleData.estimatedVnd) : NOTHING}</Text>}
        </View>
        {cycleData?.simulation ? <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.muted }}>{tt('payout.simulation')}</Text> : null}
      </HeaderGradient>}
      header={<View ref={listTarget} collapsable={false} style={{ gap: 12 }}>
        {failed ? <Failure error={failed.error} text={tt(failed.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} onRetry={() => { for (const q of queries) void q.refetch(); }} busy={queries.some(q => q.isFetching)} /> : null}
        <Text accessibilityRole="header" style={{ ...c.type.h2, fontFamily: face(theme), fontWeight: '700', color: c.ink }}>{tt('income.activity')}</Text>
        {income.isError && income.data === undefined ? <Body muted>{tt('income.transactions')} —</Body> : null}
        {income.isPending ? <Loading /> : null}
      </View>}
      footer={<View style={{ paddingTop: 6 }}>
        <NavRow icon={<FeatureIcon name="tasks" />} label={tt('income.howCalculated')} onPress={() => setExtra('help')} />
        <NavRow icon={<FeatureIcon name="wallet" />} label={tt('payout.title')} onPress={() => setShowDestination(true)} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: c.sun, borderRadius: 12, padding: 12, marginVertical: 16 }}><Icon name="info" color={c.plum} size={21} /><Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.ink, flex: 1 }}>{tt('income.disclosure')}</Text></View>
        <View style={{ paddingVertical: 16, gap: 8, borderTopWidth: 1, borderColor: c.line }}><Text style={{ ...c.type.body, color: c.ink, fontWeight: '700', fontFamily: face(theme) }}>{tt('income.next')}</Text><Body muted>{tt('income.nextBody')}</Body></View>
        <NavRow icon={<FeatureIcon name="file" />} label={tt('income.statement')} onPress={() => setExtra('statement')} />
        <NavRow icon={<Icon name="camera" color={c.ink} />} label={tt('uploads.title')} onPress={() => nav.selectTab('uploads')} />
        <NavRow icon={<Icon name="help" color={c.ink} />} label={tt('profile.help')} onPress={() => nav.push({ name: 'about' })} />
      </View>}
      empty={income.isPending || income.isError ? null : <Hatch action={tt('hall.title')} onPress={() => nav.selectTab('taskHall')} text={tt('income.empty')} />}
      renderItem={entry => {
        // Only an explicit API relationship may attach a task's title/photo to money.
        const episode = episodes.data?.find(row => row.episodeId === entry.episodeId);
        const session = sessions.data?.find(row => row.id === episode?.sessionId);
        const task = tasks.data?.find(row => row.id === (episode?.taskId ?? session?.taskId));
        const title = entry.taskTitle ?? episode?.taskTitle ?? task?.title ?? shortId(entry.episodeId);
        return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${tt(incomeStatus(entry))}${entry.simulation ? `. ${tt('payout.simulation')}` : ''}`}
          onPress={() => { setSelectedId(entry.episodeId); setDetails(false); }}
          style={({ pressed }) => ({ paddingVertical: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: c.line, opacity: pressed ? .65 : 1 })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {task ? <Image source={taskImage(task) as unknown as ImageSource} contentFit="cover" accessible={false} style={{ width: 56, height: 64, borderRadius: 14 }} /> : <View style={{ width: 28, height: 48, alignItems: 'center', justifyContent: 'center' }}><Icon name={entry.kind === 'confirmed' ? 'file' : 'clock'} color={c.ink} size={24} /></View>}
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text style={{ ...c.type.body, fontFamily: face(theme), color: c.ink, fontWeight: '600' }}>{title}</Text>
              <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.muted }}>{entry.settlementState ? settlementLabel(tt, entry.settlementState) : tt(incomeStatus(entry))}</Text>
              {task ? <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.muted }}>{tt(taskImageLabel(task))}</Text> : null}
              {stackFigures ? <><Text style={{ ...c.type.body, fontFamily: face(theme), color: isLivePaid(entry) ? c.greenInk : c.muted, fontVariant: ['tabular-nums'] }}>{entry.amountVnd === null ? NOTHING : dong(entry.amountVnd)}</Text><Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt(incomeStatus(entry))}</Text></> : null}
            </View>
            {!stackFigures ? <View style={{ maxWidth: '34%', alignItems: 'flex-end', gap: 4 }}><Text style={{ ...c.type.caption, fontWeight: '600', fontFamily: face(theme), color: isLivePaid(entry) ? c.greenInk : c.muted, fontVariant: ['tabular-nums'] }}>{entry.amountVnd === null ? NOTHING : dong(entry.amountVnd)}</Text><Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme), textAlign: 'right' }}>{tt(incomeStatus(entry))}</Text></View> : null}
            <Icon name="chevronRight" size={19} color={c.ink} />
          </View>
          {entry.simulation ? <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.muted, marginLeft: task ? 72 : 54 }}>{tt('payout.simulationLabel')}</Text> : null}
        </Pressable>;
      }} />
    <Sheet open={currentSelection !== undefined} title={selected ? shortId(selected.episodeId) : tt('income.details')} onClose={() => setSelectedId(null)}>
      {selected ? <>
        <Text style={{ fontFamily: face(theme), ...c.type.money, color: isLivePaid(selected) ? c.greenInk : c.muted, fontVariant: ['tabular-nums'] }}>{selected.amountVnd === null ? NOTHING : dong(selected.amountVnd)}</Text>
        <Tag label={tt(incomeStatus(selected))} fg={c.ink} bg={c.surface} mark={incomeStatus(selected) === 'income.confirmed' ? '✓' : selected.kind === 'estimated' ? '~' : undefined} />
        <View style={{ flexDirection: 'row', gap: c.cardGap }}>
          <Chip label={tt('income.progress')} selected={!details} onPress={() => setDetails(false)} />
          <Chip label={tt('income.details')} selected={details} onPress={() => setDetails(true)} />
        </View>
        {selected.simulation ? <Body muted>{tt('payout.simulation')}</Body> : null}
        {details ? <>
          <Row label={tt('income.minutes')} value={selected.effectiveMinutes === null ? NOTHING : quantity(selected.effectiveMinutes)} />
          <Row label={tt('income.settlement')} value={selected.settlementState ? settlementLabel(tt, selected.settlementState) : tt('settlement.unknown')} />
          {selected.kind === 'estimated' ? <Note text={tt('income.estimatedHint')} /> : null}
        </> : <Timeline steps={lifecycle(tt, selected)} />}
      </> : null}
    </Sheet>
    <Modal visible={extra !== null} animationType="none" onRequestClose={() => setExtra(null)}>
      <Screen title={tt(extra === 'help' ? 'profile.help' : 'income.statement')} onBack={() => setExtra(null)}>
        {extra === 'help' ? <><Body>{tt('detail.noTotal')}</Body><Body>{tt('income.estimatedHint')}</Body><Body>{tt('income.reviewedCaption')}</Body><Body muted>{tt('profile.helpSub')}</Body></> : cycleData ? <>
          <Body>{cycleData.label}</Body>
          <Row label={tt('income.confirmed')} value={dong(cycleData.confirmedVnd)} />
          <Row label={tt('income.estimated')} value={dong(cycleData.estimatedVnd)} />
          <Row label={tt('income.total')} value={dong(cycleData.totalVnd)} />
          {cycleData.simulation ? <Body muted>{tt('payout.simulation')}</Body> : null}
        </> : cycle.isPending ? <Loading /> : <Note text={tt('home.cycleUnavailable')} onRetry={() => void cycle.refetch()} busy={cycle.isFetching} />}
      </Screen>
    </Modal>
    <Modal visible={showDestination} animationType="none" onRequestClose={() => setShowDestination(false)}>
      <Screen title={tt('payout.title')} onBack={() => setShowDestination(false)}>{destination}</Screen>
    </Modal>
  </>;
}

const NOTHING = '—';
