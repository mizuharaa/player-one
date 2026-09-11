import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { View } from 'react-native';
import { useTheme } from '../theme.tsx';
import { Body, Button, CardLink, Hatch, ListScreen, NavRow, Note, Row, Title } from '../ui.tsx';

/** APP-11: claimed tasks and their state. */
export function MyTasks() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const claims = useQuery({ queryKey: ['claims'], queryFn: () => api.myClaims() });

  return (
    <ListScreen
      title={tt('mine.title')}
      data={claims.data ?? []}
      keyOf={(claim) => claim.id}
      header={<View style={{ gap: theme.space[3] }}>
        {claims.isError ? <><Note text={tt(claims.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} /><Button label={tt('common.retry')} variant="secondary" disabled={claims.isFetching} onPress={() => void claims.refetch()} /></> : null}
        {(claims.data?.length ?? 0) > 0 ? <Button label={tt('session.title')} onPress={() => nav.push({ name: 'sessionCreate' })} /> : null}
        <NavRow label={tt('home.uploads')} onPress={() => nav.selectTab('uploads')} />
      </View>}
      empty={
        claims.isError ? null : claims.isPending ? (
          <Body muted>{tt('common.loading')}</Body>
        ) : (
          <><Hatch text={tt('mine.empty')} /><Button label={tt('hall.title')} onPress={() => nav.push({ name: 'taskHall' })} /></>
        )
      }
      renderItem={(claim) => (
        <CardLink
          label={claim.taskName ?? claim.taskId}
          onPress={() => nav.push({ name: 'taskDetail', taskId: claim.taskId })}
        >
          <Title>{claim.taskName ?? claim.taskId}</Title>
          <Body muted>{tt('detail.claimed')}</Body>
          <Row label={tt('mine.claimedAt')} value={new Date(claim.claimedAt).toLocaleString()} />
        </CardLink>
      )}
    />
  );
}
