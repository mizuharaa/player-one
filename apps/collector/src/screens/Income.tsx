import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Row, Screen, Tag, Title } from '../ui.tsx';

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
    <Screen title={tt('income.title')}>
      {income.data !== undefined && income.data.length === 0 ? (
        <Body muted>{tt('income.empty')}</Body>
      ) : null}
      {(income.data ?? []).map((entry) => {
        const confirmed = entry.kind === 'confirmed';
        return (
          <View
            key={entry.episodeId}
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
              <Row label={tt('income.settlement')} value={entry.settlementState} />
            ) : null}
            {!confirmed ? <Body muted>{tt('income.estimatedHint')}</Body> : null}
          </View>
        );
      })}
    </Screen>
  );
}
