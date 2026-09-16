import { HeaderGradient } from '../ui/HeaderGradient.tsx';
import { Failure } from '../ui/StatePanel.tsx';
import { BrandSlot } from '../shell/BrandSlot.tsx';
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
import { TaskCard } from '../ui/TaskCard.tsx';
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
  const queries = [profile, devices, episodes, tasks, sessions, income, cycle];
  const failed = queries.find(q => q.isError && q.data === undefined) ?? queries.find(q => q.isError);
  const headerFailure = [profile, cycle].find(q => q.isError && q.data === undefined) ?? [profile, cycle].find(q => q.isError);
  const failureText = (query: { data: unknown }) => tt(query.data === undefined ? 'common.loadFailed' : 'common.refreshFailed');
  const retry = () => { for (const q of queries) void q.refetch(); };
  const earningsTarget = useGuideTarget('home.earnings');
  const tasksTarget = useGuideTarget('home.tasks');
  const nextTarget = useGuideTarget('home.next');
  const today = new Date().toDateString();
  const todaySession = sessions.data?.find(session => new Date(session.createdAt).toDateString() === today);
  const awaiting = income.data?.find(entry => entry.kind === 'confirmed' && ['pending_settlement', 'bill_generated', 'approved', 'not_paid', 'on_a_bill', 'waiting_on_us'].includes(entry.settlementState ?? ''));
  const claimable = (tasks.data ?? []).filter(task => task.claimable);
  const initials = (profile.data?.name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase();
  return <Screen refresh={{ refreshing: [profile, devices, episodes, tasks, sessions, income, cycle].some(q => q.isRefetching), onRefresh: () => { for (const q of [profile, devices, episodes, tasks, sessions, income, cycle]) void q.refetch(); } }} title={tt(`greeting.${mascotStateAt()}`)} right={
    <Pressable accessibilityRole="button" accessibilityLabel={tt('tab.profile')} onPress={() => nav.selectTab('profile')}
      style={{ minWidth: 48, minHeight: 48, borderRadius: c.radius.pill, backgroundColor: c.plum, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ ...c.type.body, fontFamily: face(theme), color: c.surface }}>{initials || '-'}</Text>
    </Pressable>}>
    {failed ? <Failure error={failed.error} text={failureText(failed)} onRetry={retry} busy={queries.some(q => q.isFetching)} /> : null}
    <HeaderGradient>
    <BrandSlot />
    <Text style={{ ...c.type.h1, fontFamily: face(theme), color: c.ink }}>{profile.data?.name ?? ''}</Text>
    {headerFailure ? <Body muted>{failureText(headerFailure)}</Body> : null}
    {cycle.isError && cycle.data === undefined ? null : <View ref={earningsTarget} collapsable={false} style={{ gap: theme.space[2], paddingVertical: c.cardPad }}>
      <Body muted>{cycle.data?.label ? `${tt('home.cycleTitle')} · ${cycle.data.label}` : tt('home.cycleTitle')}</Body>
      {cycle.isPending ? <Loading kind="number" /> : <Text style={{ ...c.type.money, fontFamily: face(theme), color: c.greenInk, fontVariant: ['tabular-nums'] }}>{cycle.data ? dong(cycle.data.confirmedVnd) : '—'}</Text>}
      {cycle.data ? <Body muted>{`${tt('income.confirmed')} · ${tt('home.cycleWithEstimate').replace('{amount}', dong(cycle.data.totalVnd))}`}</Body> : cycle.isPending ? null : <Body muted>{tt('home.cycleUnavailable')}</Body>}
    </View>}
    </HeaderGradient>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
      <Chip label={tt('uploads.title')} onPress={() => nav.selectTab('uploads')} />
      <Chip label={tt('home.myTasks')} onPress={() => nav.push({ name: 'myTasks' })} />
      <Chip label={tt('uploads.deliverTitle')} onPress={() => nav.push({ name: 'uploads', openDelivery: true })} />
    </View>
    <View ref={nextTarget} collapsable={false} style={{ gap: c.cardGap, paddingVertical: c.cardPad }}>
      <Button label={tt('session.title')} onPress={() => nav.push({ name: 'sessionReminder' })} />
      <FlatList horizontal data={['device', 'today', 'awaiting'] as const} keyExtractor={item => item}
        showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: c.cardGap }} renderItem={({ item }) =>
          <View style={{ width: (width - 2 * c.gutter) * 0.76 }}><Card>
            {item === 'device' ? <>
              <NavRow label={tt('home.devices')} subtitle={devices.data?.[0]?.serial} onPress={() => nav.push({ name: 'devices' })} />
              {devices.isError ? <Body muted>{failureText(devices)}</Body> : devices.isPending ? <Loading /> : devices.data?.length === 0 ? <Body muted>{tt('session.needDevice')}</Body> : null}
            </> : item === 'today' ? <>
              <NavRow label={tt('home.today')} subtitle={todaySession ? shortId(todaySession.id) : undefined} onPress={() => nav.selectTab('uploads')} />
              {sessions.isError ? <Body muted>{failureText(sessions)}</Body> : sessions.isPending ? <Loading /> : !todaySession ? <Body muted>{tt('home.noSessionToday')}</Body> : <Body muted>{tt(`scenario.${todaySession.scenario}`)}</Body>}
            </> : <>
              <NavRow label={tt('home.awaiting')} subtitle={awaiting ? shortId(awaiting.episodeId) : undefined} onPress={() => nav.selectTab('income')} />
              {income.isError ? <Body muted>{failureText(income)}</Body> : income.isPending ? <Loading /> : awaiting ? <Text style={{ ...c.type.h2, fontFamily: face(theme), color: c.greenInk }}>{awaiting.amountVnd === null ? '—' : dong(awaiting.amountVnd)}</Text> : <Body muted>{tt('home.noAwaiting')}</Body>}
            </>}
          </Card></View>} />
    </View>
    <View ref={tasksTarget} collapsable={false} style={{ gap: c.cardGap }}>
      <Title>{tt('home.recommended')}</Title>
      {tasks.isError ? <Body muted>{failureText(tasks)}</Body> : null}
      {tasks.isPending ? <Loading /> : claimable.length === 0 && !tasks.isError ? <Hatch action={tt('hall.title')} onPress={() => nav.push({ name: 'taskHall' })} text={tt('home.claimableEmpty')} /> :
        <FlatList horizontal snapToInterval={(width - 2 * c.gutter) * 0.76 + c.cardGap} decelerationRate="fast" disableIntervalMomentum data={claimable} keyExtractor={task => task.id} showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: c.cardGap }} renderItem={({ item }) => <View style={{ width: (width - 2 * c.gutter) * 0.76 }}>
            <TaskCard task={item} hint={tt('detail.title')} onPress={() => nav.push({ name: 'taskDetail', taskId: item.id })} />
          </View>} />}
    </View>
    <View style={{ gap: c.cardGap, paddingTop: c.sectionGap }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><Title>{tt('uploads.title')}</Title><Button label={tt('common.seeAll')} variant="ghost" onPress={() => nav.selectTab('uploads')} /></View>
      {episodes.isPending ? <Loading /> : null}
      {episodes.isError ? <Body muted>{failureText(episodes)}</Body> : null}
      {(episodes.data ?? []).slice(0, 3).map(episode => <NavRow key={episode.episodeId} label={shortId(episode.episodeId)} subtitle={tt(`state.${episode.state}`)} onPress={() => nav.selectTab('uploads')} />)}
      {episodes.data?.length === 0 ? <Hatch action={tt('hall.title')} onPress={() => nav.push({ name: 'taskHall' })} text={tt('uploads.empty')} /> : null}
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
