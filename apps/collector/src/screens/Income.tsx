import { Failure } from '../ui/StatePanel.tsx';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { IncomeEntry } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Body, Button, Card, face, Chip, Hatch, NavRow, ListScreen, Loading, Note, Row, Screen, Tag, Timeline } from '../ui.tsx';
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
      label: nonpayable ? tt(incomeStatus(entry)) : tt('income.step.paid'),
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
  const nav = useNav();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [showDestination, setShowDestination] = useState(false);
  const [extra, setExtra] = useState<'statement' | 'help' | null>(null);
  const [options, setOptions] = useState(false);
  const tt = useT();
  const theme = useTheme();
  const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });
  const cycle = useQuery({ queryKey: ['income', 'cycle'], queryFn: () => api.incomeCycle() });
  const payout = useQuery({ queryKey: ['payout'], queryFn: () => api.payout() });
  const queries = [income, cycle, payout];
  const failed = queries.find(q => q.isError && q.data === undefined) ?? queries.find(q => q.isError);
  const listTarget = useGuideTarget('income.list');

  const c = theme.collector;
  const cycleData = cycle.data ?? null;
  const selected = income.data?.find(entry => entry.episodeId === selectedId);
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
    <ListScreen title={tt('income.title')} data={options ? [] : income.data ?? []} keyOf={entry => entry.episodeId}
      refresh={{ refreshing: income.isFetching || cycle.isFetching || payout.isFetching, onRefresh: () => { void income.refetch(); void cycle.refetch(); void payout.refetch(); } }}
      header={<View ref={listTarget} collapsable={false} style={{ gap: c.sectionGap }}>
        {failed ? <Failure error={failed.error} text={tt(failed.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} onRetry={() => { for (const q of queries) void q.refetch(); }} busy={queries.some(q => q.isFetching)} /> : null}
        {cycle.isError && cycle.data === undefined ? <Body muted>{tt('home.cycleTitle')} —</Body> : <Card>
          <Text style={{ fontFamily: face(theme), ...c.type.caption, color: c.ink }}>{cycleData?.label ? `${tt('home.cycleTitle')} · ${cycleData.label}` : tt('home.cycleTitle')}</Text>
          {cycle.isPending ? <Loading kind="number" /> : <Text style={{ fontFamily: face(theme), ...c.type.money, color: c.ink, fontVariant: ['tabular-nums'] }}>{cycleData ? dong(cycleData.confirmedVnd) : NOTHING}</Text>}
          <Text style={{ fontFamily: face(theme), ...c.type.body, color: c.ink }}>{tt('income.confirmed')}</Text>
          {cycleData ? <Text style={{ fontFamily: face(theme), ...c.type.caption, color: c.ink }}>{tt('home.cycleWithEstimate').replace('{amount}', dong(cycleData.totalVnd))}</Text> :
            <Text style={{ fontFamily: face(theme), ...c.type.caption, color: c.ink }}>{tt(cycle.isPending ? 'common.loading' : 'home.cycleUnavailable')}</Text>}
          {cycleData?.simulation ? <Body muted>{tt('payout.simulation')}</Body> : null}
        </Card>}
        <View style={{ flexDirection: 'row', gap: c.cardGap, alignItems: 'flex-start' }}>
          {([
            ['uploads.title', '↑', () => nav.selectTab('uploads')],
            ['income.statement', '≡', () => setExtra('statement')],
            ['payout.title', '↗', () => setShowDestination(true)],
            ['profile.help', '?', () => setExtra('help')],
          ] as const).map(([label, mark, press]) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={tt(label)}
            onPress={press} style={{ flex: 1, minHeight: 48, alignItems: 'center', gap: theme.space[2] }}>
            <View style={{ width: 52, height: 52, borderRadius: c.radius.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ ...c.type.h2, color: c.plum, fontFamily: face(theme) }}>{mark}</Text>
            </View><Text style={{ ...c.type.caption, color: c.ink, fontFamily: face(theme), textAlign: 'center' }}>{tt(label)}</Text>
          </Pressable>)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], padding: theme.space[1], borderRadius: c.radius.pill, backgroundColor: c.line }}>
          <Chip label={tt('income.transactions')} selected={!options} onPress={() => setOptions(false)} />
          <Chip label={tt('income.options')} selected={options} onPress={() => setOptions(true)} />
        </View>
        {options ? <>
          <NavRow label={tt('income.statement')} onPress={() => setExtra('statement')} />
          <NavRow label={tt('payout.title')} onPress={() => setShowDestination(true)} />
          <NavRow label={tt('profile.help')} subtitle={tt('profile.helpSub')} onPress={() => setExtra('help')} />
        </> : null}
        <Body muted>{tt('income.intro')}</Body>
        {income.isError && income.data === undefined ? <Body muted>{tt('income.transactions')} —</Body> : null}
        {income.isPending ? <Loading /> : null}
      </View>}
      empty={options || income.isPending || income.isError ? null : <Hatch action={tt('common.retry')} onPress={() => void income.refetch()} text={tt('income.empty')} />}
      renderItem={entry => <Pressable accessibilityRole="button" accessibilityLabel={`${shortId(entry.episodeId)}. ${tt(incomeStatus(entry))}${entry.simulation ? `. ${tt('payout.simulation')}` : ''}`}
        onPress={() => { setSelectedId(entry.episodeId); setDetails(false); }}
        style={({ pressed }) => ({ borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: c.cardPad, gap: c.cardGap, backgroundColor: c.surface, opacity: pressed ? .85 : 1 })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: c.cardGap }}>
          <View style={{ flex: 1, minWidth: theme.space[24], gap: theme.space[1] }}>
            <Body>{shortId(entry.episodeId)}</Body>
            <Body muted>{entry.settlementState ? settlementLabel(tt, entry.settlementState) : tt('settlement.unknown')}</Body>
          </View>
          <Text style={{ fontFamily: face(theme), ...c.type.h2, color: isLivePaid(entry) ? c.greenInk : c.muted, fontVariant: ['tabular-nums'] }}>{entry.amountVnd === null ? NOTHING : dong(entry.amountVnd)}</Text>
        </View>
        {entry.simulation ? <Body muted>{tt('payout.simulation')}</Body> : null}
        <Tag label={tt(incomeStatus(entry))} fg={c.ink} bg={c.surface} mark={incomeStatus(entry) === 'income.confirmed' ? '✓' : entry.kind === 'estimated' ? '~' : undefined} />
      </Pressable>} />
    <Modal visible={selected !== undefined} animationType="none" onRequestClose={() => setSelectedId(null)}>
      {selected ? <Screen title={shortId(selected.episodeId)} onBack={() => setSelectedId(null)}>
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
      </Screen> : null}
    </Modal>
    <Modal visible={extra !== null} animationType="none" onRequestClose={() => setExtra(null)}>
      <Screen title={tt(extra === 'help' ? 'profile.help' : 'income.statement')} onBack={() => setExtra(null)}>
        {extra === 'help' ? <Body>{tt('profile.helpSub')}</Body> : cycleData ? <>
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
