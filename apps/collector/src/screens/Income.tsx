import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { IncomeEntry } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Tag, Timeline } from '../ui.tsx';
import {
  EmptyState,
  LoadFailed,
  ScreenTitle,
  Skeleton,
  StaleStrip,
  WarmCard,
  WarmList,
  textStyle,
} from '../v2.tsx';
import { dong, quantity, shortId } from '../money.ts';
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
 * SPEC §14. APP-33/34: per-episode effective minutes, amount and settlement
 * state, with estimated and confirmed visually unmistakable — a solid border
 * for a figure a reviewer decided, a dashed one for a figure that is still an
 * estimate, and a labelled pill either way. Geometry *and* words, because
 * `guide.income.split` already explains the dash to the collector and colour
 * alone is not allowed to carry this on a payment screen.
 *
 * Three things §14 is emphatic about, each of which a well-meaning change
 * breaks:
 *
 * - **The hero is `confirmedVnd`**, exactly as on Home and for the same APP-34
 *   reason. `estimatedVnd` never appears as a bare figure; it reaches the
 *   screen only inside `home.cycleWithEstimate`, which names it in the same
 *   sentence. Until §14.1's field arrives the card renders
 *   `home.cycleUnavailable` with no money and no split.
 * - **The payout card defaults to unknown.** The pill reads `payout.awaiting`
 *   and the body reads `payout.unknown`; `verified` is rendered only when the
 *   server has actually sent it. A fixture that seeds `verified` teaches
 *   everyone who reviews it a state the platform has never produced, and the
 *   first real collector to see "Chờ xác minh" would read it as a regression.
 *   Neither field is faked client-side.
 * - **A `null` renders as `—`, never as `0`.** The server having nothing to say
 *   is not the same as a zero.
 *
 * There is deliberately no total and no balance over the rows. Grab's rule:
 * typed rows, never netted. A single wallet figure would be the app doing
 * arithmetic on money, and it would net a reviewed payment against an estimate
 * a reviewer may yet cut to nothing. There is no cash-out button either —
 * settlement is manual and offline, which is the sixth agreement the collector
 * signed.
 *
 * **Motion: none beyond the list's own fade.** A money screen that animates its
 * numbers is a money screen people distrust.
 */
export function Income() {
  const api = useApi();
  const tt = useT();
  const theme = useTheme();
  const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });
  const cycle = useQuery({ queryKey: ['income', 'cycle'], queryFn: () => api.incomeCycle() });
  const payout = useQuery({ queryKey: ['payout'], queryFn: () => api.payout() });
  const listTarget = useGuideTarget('income.list');

  const caption = { ...textStyle(theme, 'caption'), color: theme.color.discover.muted };
  const micro = { ...textStyle(theme, 'micro'), color: theme.color.discover.muted };
  const cycleData = cycle.data ?? null;

  /**
   * §14.2. `null` — the server has not answered, or answered with a status
   * this app does not know — is `unknown`, and `unknown` wears the awaiting
   * pill with the "we do not know where to pay you" sentence. It is never
   * `verified` and never `none`: the neighbour of "refused" is "awaiting", and
   * telling a collector to wait for a verification that already failed is the
   * lie this card exists to avoid.
   */
  const status = payout.data?.status ?? null;
  const statusKey: MessageKey =
    status === 'verified' ? 'payout.verified' : status === 'none' ? 'payout.none' : 'payout.awaiting';

  return (
    <WarmList
      data={income.data ?? []}
      keyOf={(entry) => entry.episodeId}
      refresh={{
        refreshing: income.isFetching && !income.isPending,
        onRefresh: () => void income.refetch(),
      }}
      header={
        <View ref={listTarget} collapsable={false} style={{ gap: theme.space[3] }}>
          <ScreenTitle>{tt('income.title')}</ScreenTitle>

          {/* The cycle card. Plain ink on the card's own ground, NOT boxed:
              §0.2's one rule the reference pass overruled a draft on — a
              primary figure is anchored by size, and a boxed total reads as a
              crypto app. */}
          <WarmCard>
            <Text style={caption}>
              {cycleData === null || cycleData.label === ''
                ? tt('home.cycleTitle')
                : `${tt('home.cycleTitle')} · ${cycleData.label}`}
            </Text>
            {cycle.isPending ? (
              <Skeleton lines={3} />
            ) : (
              <Text
                style={{
                  ...textStyle(theme, 'hero'),
                  color: theme.color.discover.ink,
                  fontWeight: theme.fontWeight.display,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {cycleData === null ? NOTHING : dong(cycleData.confirmedVnd)}
              </Text>
            )}
            {cycleData === null ? (
              cycle.isPending ? null : (
                <Text style={caption}>{tt('home.cycleUnavailable')}</Text>
              )
            ) : (
              <>
                <Text style={caption}>
                  {`${tt('income.confirmed')} · ${tt('home.cycleWithEstimate').replace(
                    '{amount}',
                    dong(cycleData.totalVnd),
                  )}`}
                </Text>
                <Text style={micro}>{tt('income.estimatedHint')}</Text>
              </>
            )}
          </WarmCard>

          {/* §14.2, the payout destination. */}
          <View
            style={{
              backgroundColor: theme.color.discover.surface,
              borderRadius: theme.radius.lg,
              padding: theme.space[4],
              gap: theme.space[2],
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: theme.space[2],
              }}
            >
              <Text
                style={{
                  ...textStyle(theme, 'lead'),
                  color: theme.color.discover.ink,
                  fontWeight: theme.fontWeight.semibold,
                  flexShrink: 1,
                }}
              >
                {tt('payout.title')}
              </Text>
              <Tag
                label={tt(statusKey)}
                fg={status === 'verified' ? theme.color.verdict.pass.fg : theme.color.discover.ink}
                bg={status === 'verified' ? theme.color.verdict.pass.bg : theme.color.discover.soft}
                mark={status === 'verified' ? '✔' : undefined}
              />
            </View>
            <Text style={caption}>
              {status === null
                ? tt('payout.unknown')
                : payout.data?.masked === null || payout.data?.masked === undefined
                  ? tt('payout.zalopay')
                  : `${tt('payout.zalopay')} · ${payout.data.masked}`}
            </Text>
          </View>

          {/* The promise this screen is built around, printed where a collector
              reads it before the rows: one episode at a time, no totalling. */}
          <Text style={caption}>{tt('income.intro')}</Text>

          {income.isError && income.data !== undefined ? (
            <StaleStrip text={tt('income.stale')} />
          ) : null}
          {income.isPending ? <Skeleton lines={5} /> : null}
        </View>
      }
      empty={
        income.isPending ? null : income.isError ? (
          <LoadFailed onRetry={() => void income.refetch()} />
        ) : (
          <EmptyState text={tt('income.empty')} />
        )
      }
      renderItem={(entry) => {
        const confirmed = entry.kind === 'confirmed';
        return (
          <View
            style={{
              backgroundColor: theme.color.discover.surface,
              borderWidth: 1,
              // Geometry as well as a label: a dashed edge for a figure that is
              // still an estimate, a solid one for a figure a reviewer decided.
              borderStyle: confirmed ? 'solid' : 'dashed',
              borderColor: theme.color.discover.line,
              borderRadius: theme.radius.lg,
              padding: theme.space[4],
              gap: theme.space[3],
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: theme.space[3],
              }}
            >
              <View style={{ flex: 1, gap: theme.space[1] }}>
                <Text
                  style={{
                    ...textStyle(theme, 'body'),
                    color: theme.color.discover.ink,
                    fontWeight: theme.fontWeight.semibold,
                  }}
                >
                  {shortId(entry.episodeId)}
                </Text>
                <Text style={caption}>
                  {`${tt('income.minutes')} · ${
                    entry.effectiveMinutes === null ? NOTHING : quantity(entry.effectiveMinutes)
                  }`}
                </Text>
                {entry.settlementState === null ? null : (
                  <Text style={caption}>
                    {`${tt('income.settlement')} · ${settlementLabel(tt, entry.settlementState)}`}
                  </Text>
                )}
              </View>
              <View style={{ alignItems: 'flex-end', gap: theme.space[2] }}>
                <Text
                  style={{
                    ...textStyle(theme, 'section'),
                    color: theme.color.discover.ink,
                    fontWeight: theme.fontWeight.display,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {entry.amountVnd !== null ? dong(entry.amountVnd) : NOTHING}
                </Text>
                {/*
                 * Ink, not the pass green.
                 *
                 * Confirmed money and a passed episode are two different facts,
                 * and a partial pass produces confirmed money too — so a green
                 * tag here told a collector their episode passed when it may
                 * have half passed. APP-34 asks only that confirmed and
                 * estimated be unmistakable, and the solid card against the
                 * dashed one already says it; the tag says which in words. The
                 * verdict hues stay on the verdict, on the episode's own row in
                 * Uploads.
                 */}
                {confirmed ? (
                  <Tag
                    label={tt('income.confirmed')}
                    fg={theme.color.actionInk}
                    bg={theme.color.action}
                  />
                ) : (
                  <Tag
                    label={tt('income.estimated')}
                    fg={theme.color.discover.muted}
                    bg={theme.color.discover.soft}
                  />
                )}
              </View>
            </View>
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.color.discover.line,
                paddingTop: theme.space[3],
                gap: theme.space[2],
              }}
            >
              <Text style={caption}>{tt('income.progress')}</Text>
              <Timeline steps={lifecycle(tt, entry)} />
            </View>
          </View>
        );
      }}
    />
  );
}

/** The server having nothing to say is not the same as a zero (§14). */
const NOTHING = '—';
