import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, ListScreen, Row, Tag, Title } from '../ui.tsx';
import type { MessageKey } from '../i18n.ts';

/**
 * The five values `settlements.settlement_state` can hold
 * (`packages/store/src/schema.ts`), in the collector's language. The screen
 * used to print the raw column value, so a Vietnamese collector read
 * "bill_generated". An unknown value falls back to itself rather than
 * disappearing — a state the server invented later should be visible, not
 * silently blank.
 */
const SETTLEMENT_STATES: Record<string, MessageKey> = {
  pending_review: 'settlement.pending_review',
  pending_settlement: 'settlement.pending_settlement',
  bill_generated: 'settlement.bill_generated',
  manually_paid: 'settlement.manually_paid',
  exception: 'settlement.exception',
};

const settlementLabel = (tt: (key: MessageKey) => string, state: string): string => {
  const key = SETTLEMENT_STATES[state];
  return key === undefined ? state : tt(key);
};

/**
 * APP-33/34: per-episode effective minutes, amount and settlement state —
 * with estimated and confirmed visually unmistakable: confirmed sits in a
 * solid card with the pass verdict's colours; estimated is dashed, muted, and
 * labelled. Every figure is the server's; the app computes nothing, sums
 * nothing, rounds nothing.
 */
export function Income() {
  const api = useApi();
  const tt = useT();
  const theme = useTheme();
  const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });

  return (
    <ListScreen
      title={tt('income.title')}
      data={income.data ?? []}
      keyOf={(entry) => entry.episodeId}
      empty={income.data !== undefined ? <Body muted>{tt('income.empty')}</Body> : null}
      renderItem={(entry) => {
        const confirmed = entry.kind === 'confirmed';
        return (
          <View
            style={{
              backgroundColor: confirmed ? theme.color.card : theme.color.surface,
              borderWidth: 1,
              borderStyle: confirmed ? 'solid' : 'dashed',
              borderColor: confirmed ? theme.color.border : theme.color.borderStrong,
              borderRadius: theme.radius.base,
              padding: theme.space[4],
              gap: theme.space[2],
            }}
          >
            <Title>{entry.episodeId}</Title>
            {confirmed ? (
              <Tag label={tt('income.confirmed')} fg={theme.color.verdict.pass.fg} bg={theme.color.verdict.pass.bg} />
            ) : (
              <Tag label={tt('income.estimated')} fg={theme.color.mutedForeground} bg={theme.color.muted} />
            )}
            <Row label={tt('income.minutes')} value={entry.effectiveMinutes ?? '—'} />
            <Row label={tt('income.amount')} value={entry.amountVnd !== null ? `${entry.amountVnd} ₫` : '—'} />
            {entry.settlementState !== null ? (
              <Row label={tt('income.settlement')} value={settlementLabel(tt, entry.settlementState)} />
            ) : null}
            {!confirmed ? <Body muted>{tt('income.estimatedHint')}</Body> : null}
          </View>
        );
      }}
    />
  );
}
