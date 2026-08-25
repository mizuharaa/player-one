import { Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Body, Card, Row, Screen, Title } from '../ui.tsx';

/** APP-11: claimed tasks and their state. */
export function MyTasks() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const claims = useQuery({ queryKey: ['claims'], queryFn: () => api.myClaims() });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });

  const titleOf = (taskId: string): string =>
    (tasks.data ?? []).find((t) => t.id === taskId)?.title ?? taskId;

  return (
    <Screen title={tt('mine.title')}>
      {claims.data !== undefined && claims.data.length === 0 ? (
        <Body muted>{tt('mine.empty')}</Body>
      ) : null}
      {(claims.data ?? []).map((claim) => (
        <Pressable key={claim.id} onPress={() => nav.push({ name: 'taskDetail', taskId: claim.taskId })}>
          <Card>
            <Title>{titleOf(claim.taskId)}</Title>
            <Row label={tt('mine.claimedAt')} value={new Date(claim.claimedAt).toLocaleString()} />
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
