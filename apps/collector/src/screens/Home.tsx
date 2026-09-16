import { Icon } from '../ui/Icon.tsx';
import { GlassSurface } from '../ui/GlassSurface.tsx';
import { TaskCard } from '../ui/TaskCard.tsx';
import { Failure } from '../ui/StatePanel.tsx';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { mascotStateAt } from '@playerone/design/tokens';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { nextLocale } from '../i18n.ts';
import { useTheme } from '../theme.tsx';
import { useGuide, useGuideTarget } from '../guide/Guide.tsx';
import { Body, Button, Card, Chip, Hatch, Loading, NavRow, Screen, Title, face } from '../ui.tsx';
import { dong, shortId } from '../money.ts';

export function Home() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
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
  const awaiting = income.data?.find(entry => entry.kind === 'confirmed' && ['pending_settlement', 'bill_generated', 'approved', 'on_a_bill', 'waiting_on_us'].includes(entry.settlementState ?? ''));
  const claimable = (tasks.data ?? []).filter(task => task.claimable);
  const initials = (profile.data?.name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase();
  return <Screen refresh={{ refreshing: queries.some(q => q.isRefetching), onRefresh: retry }} title={tt(`greeting.${mascotStateAt()}`)} right={
    <Pressable accessibilityRole="button" accessibilityLabel={`${tt('profile.language')} / ${locale.toUpperCase()}`} onPress={() => setLocale(nextLocale(locale))}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: c.surface }}>
      <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.ink, fontWeight: '600' }}>{locale.toUpperCase()}</Text>
    </Pressable>}>
    {failed ? <Failure error={failed.error} text={failureText(failed)} onRetry={retry} busy={queries.some(q => q.isFetching)} /> : null}
    <View testID="home-header-wash" style={{ gap: 16, paddingBottom: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={tt('tab.profile')} onPress={() => nav.selectTab('profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.glow }}>
          <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.ink, fontWeight: '600' }}>{initials || '—'}</Text>
        </View>
        <Text style={{ ...c.type.body, fontFamily: face(theme), color: c.ink, flex: 1 }}>{profile.data?.name ?? tt('tab.profile')}</Text>
        <Icon name="chevronRight" color={c.muted} size={18} />
      </Pressable>
      {headerFailure ? <Body muted>{failureText(headerFailure)}</Body> : null}
      {cycle.isError && cycle.data === undefined ? null : <View ref={earningsTarget} collapsable={false}>
        <GlassSurface style={{ padding: 16, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="wallet" size={18} color={c.muted} />
            <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.muted, flex: 1 }}>{cycle.data?.label ? `${tt('home.cycleTitle')} · ${cycle.data.label}` : tt('home.cycleTitle')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={tt('income.title')} onPress={() => nav.selectTab('income')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrowUpRight" color={c.ink} /></Pressable>
          </View>
          {cycle.isPending ? <Loading kind="number" /> : <Text style={{ ...c.type.money, fontFamily: face(theme), color: c.ink, fontVariant: ['tabular-nums'] }}>{cycle.data ? dong(cycle.data.confirmedVnd) : '—'}</Text>}
          <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.muted }}>{tt('income.confirmed')}{cycle.data ? ` · ${tt('home.cycleWithEstimate').replace('{amount}', dong(cycle.data.totalVnd))}` : ''}</Text>
          {cycle.data?.simulation ? <Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.muted }}>{tt('payout.simulation')}</Text> : null}
        </GlassSurface>
      </View>}
    </View>
    <View ref={nextTarget} collapsable={false} style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ flex: 1 }}><Button label={tt('session.title')} onPress={() => nav.push({ name: 'sessionReminder' })} /></View>
      <Button label={tt('home.myTasks')} variant="secondary" onPress={() => nav.push({ name: 'myTasks' })} />
    </View>
    <View ref={tasksTarget} collapsable={false} style={{ gap: 12, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}><Title>{tt('home.recommended')}</Title></View>
        <Button label={tt('common.seeAll')} variant="ghost" onPress={() => nav.selectTab('taskHall')} />
      </View>
      {tasks.isError ? <Body muted>{failureText(tasks)}</Body> : null}
      {tasks.isPending ? <Loading /> : claimable.length === 0 && !tasks.isError ? <Hatch action={tt('hall.title')} onPress={() => nav.push({ name: 'taskHall' })} text={tt('home.claimableEmpty')} /> :
        claimable.slice(0, 3).map(task => <TaskCard key={task.id} task={task} hint={tt('detail.title')} onPress={() => nav.push({ name: 'taskDetail', taskId: task.id })} />)}
    </View>
    <View style={{ gap: 8, paddingTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Title>{tt('uploads.title')}</Title><Button label={tt('common.seeAll')} variant="ghost" onPress={() => nav.selectTab('uploads')} /></View>
      {episodes.isPending ? <Loading /> : null}
      {episodes.isError ? <Body muted>{failureText(episodes)}</Body> : null}
      {(episodes.data ?? []).slice(0, 3).map(episode => <NavRow key={episode.episodeId} icon={<Icon name="camera" color={c.muted} />} label={shortId(episode.episodeId)} subtitle={tt(`state.${episode.state}`)} onPress={() => nav.selectTab('uploads')} />)}
      {episodes.data?.length === 0 ? <Hatch action={tt('hall.title')} onPress={() => nav.push({ name: 'taskHall' })} text={tt('uploads.empty')} /> : null}
      <Button label={tt('uploads.deliverTitle')} variant="secondary" onPress={() => nav.push({ name: 'uploads', openDelivery: true })} />
    </View>
    <View style={{ gap: 4, paddingTop: 16 }}>
      <NavRow icon={<Icon name="camera" color={c.muted} />} label={tt('home.devices')} subtitle={devices.data?.[0]?.serial ?? (devices.isPending ? tt('common.loading') : tt('session.needDevice'))} onPress={() => nav.push({ name: 'devices' })} />
      <NavRow icon={<Icon name="clock" color={c.muted} />} label={tt('home.today')} subtitle={todaySession ? shortId(todaySession.id) : tt('home.noSessionToday')} onPress={() => nav.selectTab('uploads')} />
      <NavRow icon={<Icon name="wallet" color={c.muted} />} label={tt('home.awaiting')} subtitle={awaiting ? shortId(awaiting.episodeId) : tt('home.noAwaiting')} onPress={() => nav.selectTab('income')} />
      {awaiting ? <Text style={{ ...c.type.h2, fontFamily: face(theme), color: c.ink }}>{awaiting.amountVnd === null ? '—' : dong(awaiting.amountVnd)}</Text> : null}
      {awaiting?.simulation ? <Body muted>{tt('payout.simulation')}</Body> : null}
      <NavRow icon={<Icon name="chat" color={c.muted} />} label={tt('forum.title')} onPress={() => nav.push({ name: 'forum' })} />
      <NavRow icon={<Icon name="chat" color={c.muted} />} label={tt('groups.title')} onPress={() => nav.push({ name: 'groupChats' })} />
      <NavRow icon={<Icon name="file" color={c.muted} />} label={tt('home.training')} onPress={() => nav.push({ name: 'training' })} />
      <Chip label={tt('guide.open')} onPress={guide.accept} />
    </View>
    {guide.offered ? <Card><Title>{tt('guide.offerTitle')}</Title><Body muted>{tt('guide.offerBody')}</Body>
      <Button label={tt('guide.offerYes')} variant="secondary" onPress={guide.accept} />
      <Button label={tt('guide.offerNo')} variant="ghost" onPress={guide.decline} /></Card> : null}
  </Screen>;
}
