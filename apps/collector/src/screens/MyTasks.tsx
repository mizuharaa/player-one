import { Failure } from '../ui/StatePanel.tsx';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme.tsx';
import { Button, Hatch, ListScreen, Loading, NavRow, Title } from '../ui.tsx';
import { Icon } from '../ui/Icon.tsx';
import { face } from '../ui.tsx';

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
        {claims.isError ? <Failure error={claims.error} text={tt(claims.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} onRetry={() => void claims.refetch()} busy={claims.isFetching} /> : null}
        {(claims.data?.length ?? 0) > 0 ? <Button label={tt('session.title')} onPress={() => nav.push({ name: 'sessionCreate' })} /> : null}
        <NavRow icon={<Icon name="camera" color={theme.collector.muted} />} label={tt('home.uploads')} onPress={() => nav.selectTab('uploads')} />
      </View>}
      empty={
        claims.isError ? null : claims.isPending ? (
          <Loading />
        ) : (
          <><Hatch text={tt('mine.empty')} /><Button label={tt('hall.title')} onPress={() => nav.push({ name: 'taskHall' })} /></>
        )
      }
      renderItem={(claim) => (
        <Pressable accessibilityRole="button" accessibilityLabel={claim.taskName ?? claim.taskId} onPress={() => nav.push({ name: 'taskDetail', taskId: claim.taskId })}
          style={({ pressed }) => ({ backgroundColor: theme.collector.surface, borderRadius: 20, padding: 16, gap: 12, opacity: pressed ? .7 : 1 })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: theme.collector.glow, alignItems: 'center', justifyContent: 'center' }}><Icon name="tasks" color={theme.collector.ink} /></View>
            <View style={{ flex: 1, gap: 4 }}><Title>{claim.taskName ?? claim.taskId}</Title><Text style={{ ...theme.collector.type.caption, fontFamily: face(theme), color: theme.collector.muted }}>{tt('detail.claimed')}</Text></View>
            <Icon name="chevronRight" color={theme.collector.muted} size={18} />
          </View>
          <Text style={{ ...theme.collector.type.caption, fontFamily: face(theme), color: theme.collector.muted }}>{tt('mine.claimedAt')} · {new Date(claim.claimedAt).toLocaleString()}</Text>
        </Pressable>
      )}
    />
  );
}
