import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { IncomeEntry } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Amount, Body, Button, Hatch, ListScreen, Note, Row, Tag, Timeline, Title } from '../ui.tsx';
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

/** The settlement states that mean money actually moved. */
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
): { key: string; label: string; done: boolean; note?: string }[] => {
  const reviewed = entry.kind === 'confirmed';
  const paid = entry.settlementState !== null && PAID.has(entry.settlementState);
  return [
    { key: 'uploaded', label: tt('income.step.uploaded'), done: true },
    {
      key: 'reviewed',
      label: tt('income.step.reviewed'),
      done: reviewed,
      note: reviewed ? undefined : tt('income.estimatedHint'),
    },
    {
      key: 'paid',
      label: tt('income.step.paid'),
      done: paid,
      note:
        entry.settlementState === null ? undefined : settlementLabel(tt, entry.settlementState),
    },
  ];
};

/**
 * APP-33/34: per-episode effective minutes, amount and settlement state —
 * with estimated and confirmed visually unmistakable: confirmed sits in a
 * solid card with the pass verdict's label; estimated is dashed, muted, and
 * labelled in words as well as geometry. Every figure is the server's; the app
 * computes nothing, sums nothing, rounds nothing.
 *
 * There is deliberately **no total and no balance** on this screen. Grab's rule:
 * typed rows, never netted. A single wallet figure would be the app doing
 * arithmetic on money, which is the one thing this client must never do — and
 * it would net a reviewed payment against an estimate that a reviewer may yet
 * cut to nothing.
 */
export function Income() {
  const api = useApi();
  const tt = useT();
  const theme = useTheme();
  const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });
  const listTarget = useGuideTarget('income.list');

  return (
    <ListScreen
      title={tt('income.title')}
      data={income.data ?? []}
      keyOf={(entry) => entry.episodeId}
      header={
        <View ref={listTarget} collapsable={false} style={{ gap: theme.space[3] }}>
          <Body muted>{tt('income.intro')}</Body>
          {income.isError ? <><Note text={tt(income.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} /><Button label={tt('common.retry')} variant="secondary" disabled={income.isFetching} onPress={() => void income.refetch()} /></> : null}
          {income.isPending || income.isFetching ? <Body muted>{tt('common.loading')}</Body> : null}
        </View>
      }
      empty={
        income.isError || income.isPending ? null : (
          <Hatch text={tt('income.empty')} />
        )
      }
      renderItem={(entry) => {
        const confirmed = entry.kind === 'confirmed';
        return (
          <View
            style={{
              backgroundColor: confirmed ? theme.color.card : theme.color.surface,
              borderWidth: 1,
              // Geometry as well as a label: a dashed edge for a figure that is
              // still an estimate, a solid one for a figure a reviewer decided.
              borderStyle: confirmed ? 'solid' : 'dashed',
              borderColor: confirmed ? theme.color.border : theme.color.borderStrong,
              borderRadius: theme.radius.base,
              padding: theme.space[4],
              gap: theme.space[3],
            }}
          >
            <View style={{ gap: theme.space[2] }}>
              <Title>{entry.episodeId}</Title>
              {income.isError ? <Note text={tt('income.stale')} /> : null}
              {confirmed ? (
                /*
                 * Ink, not the pass green.
                 *
                 * Confirmed money and a passed episode are two different
                 * facts, and a partial pass produces confirmed money too — so
                 * a green tag on this row told a collector their episode
                 * passed when it may have half passed. APP-34 asks only that
                 * confirmed and estimated be unmistakable, and the solid card
                 * against the dashed one already says it; the tag says which
                 * in words. The verdict hues stay on the verdict, which is on
                 * the episode's own row in Uploads.
                 */
                <Tag
                  label={tt('income.confirmed')}
                  fg={theme.color.background}
                  bg={theme.color.foreground}
                />
              ) : (
                <Tag
                  label={tt('income.estimated')}
                  fg={theme.color.mutedForeground}
                  bg={theme.color.muted}
                />
              )}
              <Amount
                label={tt('income.amount')}
                value={entry.amountVnd !== null ? `${entry.amountVnd} ₫` : '—'}
              />
              <Row label={tt('income.minutes')} value={entry.effectiveMinutes ?? '—'} />
              {entry.settlementState !== null ? (
                <Row
                  label={tt('income.settlement')}
                  value={settlementLabel(tt, entry.settlementState)}
                />
              ) : null}
            </View>
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.color.border,
                paddingTop: theme.space[3],
                gap: theme.space[2],
              }}
            >
              <Body muted>{tt('income.progress')}</Body>
              <Timeline steps={lifecycle(tt, entry)} />
            </View>
          </View>
        );
      }}
    />
  );
}
