import { FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { mascotStateAt } from '@playerone/design/tokens';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { nextLocale } from '../i18n.ts';
import { useTheme } from '../theme.tsx';
import { useGuide, useGuideTarget } from '../guide/Guide.tsx';
import { Body, Button, Card, Chip, Hatch, Loading, NavRow, Note, Screen, Title, face } from '../ui.tsx';
import { TaskCard } from '../v2.tsx';
import { dong, shortId } from '../money.ts';

export function Home() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const { width } = useWindowDimensions();
  const { locale, setLocale } = useLocale();
  const guide = useGuide();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.boundDevices() });
  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.sessions() });
  const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });
  const cycle = useQuery({ queryKey: ['income', 'cycle'], queryFn: () => api.incomeCycle() });
  const earningsTarget = useGuideTarget('home.earnings');
  const tasksTarget = useGuideTarget('home.tasks');
  const nextTarget = useGuideTarget('home.next');
  const today = new Date().toDateString();
  const todaySession = sessions.data?.find(session => new Date(session.createdAt).toDateString() === today);
  const awaiting = income.data?.find(entry => entry.kind === 'confirmed' && ['pending_settlement', 'bill_generated', 'approved', 'not_paid', 'on_a_bill', 'waiting_on_us'].includes(entry.settlementState ?? ''));
  const claimable = (tasks.data ?? []).filter(task => task.claimable);
  const initials = (profile.data?.name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase();
  return <Screen title={tt(`greeting.${mascotStateAt()}`)} right={
    <Pressable accessibilityRole="button" accessibilityLabel={tt('tab.profile')} onPress={() => nav.selectTab('profile')}
      style={{ minWidth: 48, minHeight: 48, borderRadius: c.radius.pill, backgroundColor: c.plum, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ ...c.type.body, fontFamily: face(theme), color: c.surface }}>{initials || '-'}</Text>
    </Pressable>}>
    <Text style={{ ...c.type.h1, fontFamily: face(theme), color: c.ink }}>{profile.data?.name ?? ''}</Text>
    {profile.isError ? <Note tone="error" text={tt('common.loadFailed')} onRetry={() => void profile.refetch()} busy={profile.isFetching} /> : null}
    <View ref={earningsTarget} collapsable={false} style={{ gap: theme.space[2], paddingVertical: c.cardPad }}>
      <Body muted>{cycle.data?.label ? `${tt('home.cycleTitle')} · ${cycle.data.label}` : tt('home.cycleTitle')}</Body>
      {cycle.isPending ? <Loading /> : <Text style={{ ...c.type.money, fontFamily: face(theme), color: c.greenInk, fontVariant: ['tabular-nums'] }}>{cycle.data ? dong(cycle.data.confirmedVnd) : '—'}</Text>}
      {cycle.data ? <Body muted>{`${tt('income.confirmed')} · ${tt('home.cycleWithEstimate').replace('{amount}', dong(cycle.data.totalVnd))}`}</Body> : cycle.isPending ? null : <Body muted>{tt('home.cycleUnavailable')}</Body>}
      {cycle.isError ? <Note tone="error" text={tt('common.loadFailed')} onRetry={() => void cycle.refetch()} busy={cycle.isFetching} /> : null}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
      <Chip label={tt('uploads.title')} onPress={() => nav.selectTab('uploads')} />
      <Chip label={tt('home.myTasks')} onPress={() => nav.push({ name: 'myTasks' })} />
      <Chip label={tt('uploads.deliverTitle')} onPress={() => nav.push({ name: 'uploads', openDelivery: true })} />
    </View>
    <View ref={nextTarget} collapsable={false} style={{ gap: c.cardGap, paddingVertical: c.cardPad }}>
      <Button label={tt('session.title')} onPress={() => nav.push({ name: 'sessionReminder' })} />
      <FlatList horizontal data={['device', 'today', 'awaiting'] as const} keyExtractor={item => item}
        showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: c.cardGap }} renderItem={({ item }) =>
          <View style={{ width: (width - 2 * c.gutter) * 0.86 }}><Card>
            {item === 'device' ? <>
              <NavRow label={tt('home.devices')} subtitle={devices.data?.[0]?.serial} onPress={() => nav.push({ name: 'devices' })} />
              {devices.isError ? <Note tone="error" text={tt('common.loadFailed')} onRetry={() => void devices.refetch()} busy={devices.isFetching} /> : devices.isPending ? <Loading /> : devices.data?.length === 0 ? <Body muted>{tt('session.needDevice')}</Body> : null}
            </> : item === 'today' ? <>
              <NavRow label={tt('home.today')} subtitle={todaySession ? shortId(todaySession.id) : undefined} onPress={() => nav.selectTab('uploads')} />
              {sessions.isError ? <Note tone="error" text={tt('common.loadFailed')} onRetry={() => void sessions.refetch()} busy={sessions.isFetching} /> : sessions.isPending ? <Loading /> : !todaySession ? <Body muted>{tt('home.noSessionToday')}</Body> : <Body muted>{tt(`scenario.${todaySession.scenario}`)}</Body>}
            </> : <>
              <NavRow label={tt('home.awaiting')} subtitle={awaiting ? shortId(awaiting.episodeId) : undefined} onPress={() => nav.selectTab('income')} />
              {income.isError ? <Note tone="error" text={tt('common.loadFailed')} onRetry={() => void income.refetch()} busy={income.isFetching} /> : income.isPending ? <Loading /> : awaiting ? <Text style={{ ...c.type.h2, fontFamily: face(theme), color: c.greenInk }}>{awaiting.amountVnd === null ? '—' : dong(awaiting.amountVnd)}</Text> : <Body muted>{tt('home.noAwaiting')}</Body>}
            </>}
          </Card></View>} />
    </View>
    <View ref={tasksTarget} collapsable={false} style={{ gap: c.cardGap }}>
      <Title>{tt('home.claimable')}</Title>
      {tasks.isError ? <Note tone="error" text={tt(tasks.data ? 'common.refreshFailed' : 'common.loadFailed')} onRetry={() => void tasks.refetch()} busy={tasks.isFetching} /> : null}
      {tasks.isPending ? <Loading /> : claimable.length === 0 && !tasks.isError ? <Hatch text={tt('home.claimableEmpty')} /> :
        <FlatList horizontal data={claimable} keyExtractor={task => task.id} showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: c.cardGap }} renderItem={({ item }) => <View style={{ width: (width - 2 * c.gutter) * 0.86 }}>
            <TaskCard task={item} variant="tile" hint={tt('detail.title')} onPress={() => nav.push({ name: 'taskDetail', taskId: item.id })} />
          </View>} />}
    </View>
    <View style={{ gap: c.cardGap, paddingTop: c.sectionGap }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><Title>{tt('uploads.title')}</Title><Button label={tt('common.seeAll')} variant="ghost" onPress={() => nav.selectTab('uploads')} /></View>
      {episodes.isPending ? <Loading /> : null}
      {episodes.isError ? <Note tone="error" text={tt('common.loadFailed')} onRetry={() => void episodes.refetch()} busy={episodes.isFetching} /> : null}
      {(episodes.data ?? []).slice(0, 3).map(episode => <NavRow key={episode.episodeId} label={shortId(episode.episodeId)} subtitle={tt(`state.${episode.state}`)} onPress={() => nav.selectTab('uploads')} />)}
      {episodes.data?.length === 0 ? <Hatch text={tt('uploads.empty')} /> : null}
    </View>
    <View style={{ gap: c.cardGap, paddingTop: c.sectionGap }}>
      <NavRow label={tt('tab.profile')} onPress={() => nav.selectTab('profile')} />
      <NavRow label={tt('forum.title')} onPress={() => nav.push({ name: 'forum' })} />
      <NavRow label={tt('groups.title')} onPress={() => nav.push({ name: 'groupChats' })} />
      <NavRow label={tt('home.training')} onPress={() => nav.push({ name: 'training' })} />
      <Chip label={tt('common.language')} onPress={() => setLocale(nextLocale(locale))} />
      <Chip label={tt('guide.open')} onPress={guide.accept} />
    </View>
    {guide.offered ? <Card><Title>{tt('guide.offerTitle')}</Title><Body muted>{tt('guide.offerBody')}</Body>
      <Button label={tt('guide.offerYes')} variant="secondary" onPress={guide.accept} />
      <Button label={tt('guide.offerNo')} variant="ghost" onPress={guide.decline} /></Card> : null}
  </Screen>;
}
