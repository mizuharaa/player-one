import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Body, CardLink, ListScreen, Row, Title } from '../ui.tsx';

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
    <ListScreen
      title={tt('mine.title')}
      data={claims.data ?? []}
      keyOf={(claim) => claim.id}
      empty={claims.data !== undefined ? <Body muted>{tt('mine.empty')}</Body> : null}
      renderItem={(claim) => (
        <CardLink
          label={titleOf(claim.taskId)}
          onPress={() => nav.push({ name: 'taskDetail', taskId: claim.taskId })}
        >
          <Title>{titleOf(claim.taskId)}</Title>
          <Row label={tt('mine.claimedAt')} value={new Date(claim.claimedAt).toLocaleString()} />
        </CardLink>
      )}
    />
  );
}
