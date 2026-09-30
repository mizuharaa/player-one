import { Icon, FeatureIcon } from '../ui/Icon.tsx';
import { PhantomPressable } from '../ui/PhantomPressable.tsx';
import { TaskCard } from '../ui/TaskCard.tsx';
import { CollectorMasthead } from '../ui/CollectorMasthead.tsx';
import { HeaderGradient } from '../ui/HeaderGradient.tsx';
import { Failure } from '../ui/StatePanel.tsx';
import { Text, View, useWindowDimensions } from 'react-native';
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

/** Identity, task status, featured photograph, then compact task rows. */
export function Home() {
  const api = useApi(), nav = useNav(), tt = useT(), theme = useTheme(), c = theme.collector;
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.2;
  const { locale, setLocale } = useLocale();
  const guide = useGuide();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.boundDevices() });
  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const claims = useQuery({ queryKey: ['claims'], queryFn: () => api.myClaims() });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.sessions() });
  const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });
  const cycle = useQuery({ queryKey: ['income', 'cycle'], queryFn: () => api.incomeCycle() });
  const queries = [profile, devices, episodes, tasks, claims, sessions, income, cycle];
  const failed = queries.find(q => q.isError && q.data === undefined) ?? queries.find(q => q.isError);
  const failureText = (query: { data: unknown }) => tt(query.data === undefined ? 'common.loadFailed' : 'common.refreshFailed');
  const retry = () => { for (const q of queries) void q.refetch(); };
  const earningsTarget = useGuideTarget('home.earnings'), tasksTarget = useGuideTarget('home.tasks'), nextTarget = useGuideTarget('home.next');
  const today = new Date().toDateString();
  const todaySession = sessions.data?.find(session => new Date(session.createdAt).toDateString() === today);
  const awaiting = income.data?.find(entry => entry.kind === 'confirmed' && ['pending_settlement', 'bill_generated', 'approved', 'on_a_bill', 'waiting_on_us'].includes(entry.settlementState ?? ''));
  const claimedIds = new Set([...(claims.data ?? []).map(claim => claim.taskId), ...(tasks.data ?? []).filter(task => task.claimedByMe).map(task => task.id)]);
  const claimable = (tasks.data ?? []).filter(task => task.claimable);
  const featured = claimable[0];
  const taskRows = [...(tasks.data ?? []).filter(task => claimedIds.has(task.id)), ...claimable.filter(task => !claimedIds.has(task.id))].slice(0, 3);
  const waitingEpisodes = episodes.data?.filter(episode => episode.state === 'uploaded' || episode.state === 'under_review');
  const awaitingTaskIds = new Set(waitingEpisodes?.map(episode => sessions.data?.find(session => session.id === episode.sessionId)?.taskId).filter(Boolean));
  const caption = { ...c.type.caption, color: c.muted, fontFamily: face(theme) };
  const statusTiles = [
    { label: tt('home.myTasks'), hint: tt('home.claimedTasks'), value: claims.data ? String(claimedIds.size) : '—', icon: 'camera' as const, onPress: () => nav.push({ name: 'myTasks' }), query: claims },
    { label: tt('home.awaitingReview'), hint: tt('home.reviewProgress'), value: waitingEpisodes ? String(waitingEpisodes.length) : '—', icon: 'clock' as const, onPress: () => nav.selectTab('uploads'), query: episodes },
  ];
  return <Screen ambientHeader refresh={{ refreshing: queries.some(q => q.isRefetching), onRefresh: retry }} title="PlayerOne" header={
    <HeaderGradient>
      <CollectorMasthead />
      <View style={{ gap: 4 }}>
        <Text style={{ ...c.type.body, color: c.ink, fontFamily: face(theme) }}>{tt(`greeting.${mascotStateAt()}`)}{profile.data?.name ? `, ${profile.data.name}` : ''}</Text>
        <Text style={{ ...c.type.h1, color: c.ink, fontFamily: face(theme), fontWeight: '700', letterSpacing: -.6 }}>{tt('home.readyTitle')}</Text>
      </View>
      <View ref={nextTarget} collapsable={false} style={{ flexDirection: 'row', gap: 10 }}>
        {statusTiles.map(tile => <PhantomPressable key={tile.label} accessibilityRole="button" accessibilityHint={tile.hint} onPress={tile.onPress}
          style={{ flex: 1, padding: 12, borderRadius: 18, backgroundColor: tile.icon === 'camera' ? c.glow : c.surface, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <View style={{ width: 38, height: 42, alignItems: 'center', justifyContent: 'center' }}><FeatureIcon name={tile.icon} size={30} /></View>
            <View style={{ flex: 1, gap: 4 }}><Text style={{ ...caption, fontSize: 12, lineHeight: 18, minHeight: compact ? 36 : 18, color: c.ink }}>{tile.label}</Text>
              {tile.query.isPending ? <Loading kind="number" /> : <Text style={{ ...c.type.h1, fontWeight: '700', fontFamily: face(theme), color: c.ink }}>{tile.value}</Text>}
            </View>
          </View>
          {!compact || tile.query.isError ? <Text style={{ ...caption, fontSize: 12, lineHeight: 18 }}>{tile.query.isError ? failureText(tile.query) : tile.hint}</Text> : null}
        </PhantomPressable>)}
      </View>
    </HeaderGradient>}>
    {failed ? <Failure error={failed.error} text={failureText(failed)} onRetry={retry} busy={queries.some(q => q.isFetching)} /> : null}
    {profile.data && !profile.data.onboarded ? <View style={{ paddingVertical: 12, gap: 8 }}><Title>{tt('landing.centre')}</Title><Body>{tt('detail.needOnboarding')}</Body><Body muted>{tt('counter.where')}</Body></View> : profile.data && (!profile.data.examPassed || !profile.data.trainingDone) ? <PhantomPressable accessibilityRole="button" onPress={() => nav.push({ name: 'training' })}
      style={{ paddingVertical: 12, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Icon name="file" color={c.plum} /><View style={{ flex: 1, gap: 4 }}><Title>{tt('home.readiness')}</Title><Body muted>{tt('home.readinessBody')}</Body></View><Icon name="chevronRight" color={c.plum} />
    </PhantomPressable> : null}
    <View ref={tasksTarget} collapsable={false} style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><Title>{tt('home.featured')}</Title><Button label={tt('common.seeAll')} variant="ghost" onPress={() => nav.selectTab('taskHall')} /></View>
      {tasks.isPending ? <Loading /> : featured ? <TaskCard task={featured} variant="featured" onPress={() => nav.push({ name: 'taskDetail', taskId: featured.id })} /> : tasks.isError ? <Body muted>{failureText(tasks)}</Body> : <Hatch action={tt('hall.title')} onPress={() => nav.selectTab('taskHall')} text={tt('home.claimableEmpty')} />}
    </View>
    <View style={{ gap: 2, paddingTop: 12 }}>
      <Title>{tt('home.yourTasks')}</Title>
      {taskRows.map(task => <TaskCard key={task.id} task={task} variant="compact"
        status={awaitingTaskIds.has(task.id) ? tt('home.awaitingReview') : claimedIds.has(task.id) ? tt('detail.claimed') : claims.isSuccess ? tt('hall.open') : undefined}
        onPress={() => nav.push({ name: 'taskDetail', taskId: task.id })} />)}
      <NavRow icon={<Icon name="camera" color={c.muted} />} label={tt('session.title')} onPress={() => nav.push({ name: 'sessionReminder' })} />
    </View>
    <View ref={earningsTarget} collapsable={false} style={{ marginTop: 12 }}>
      <PhantomPressable accessibilityRole="button" onPress={() => nav.selectTab('income')} style={{ paddingVertical: 16, gap: 6, borderBottomWidth: 1, borderColor: c.line }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="wallet" size={20} color={c.plum} /><Text style={{ ...caption, flex: 1 }}>{cycle.data?.label ? `${tt('home.cycleTitle')} · ${cycle.data.label}` : tt('home.cycleTitle')}</Text><Icon name="chevronRight" color={c.ink} /></View>
        {cycle.isPending ? <Loading kind="number" /> : <Text style={{ ...c.type.h2, fontFamily: face(theme), color: c.ink, fontVariant: ['tabular-nums'] }}>{cycle.data ? dong(cycle.data.confirmedVnd) : '—'}</Text>}
        <Text style={caption}>{tt('income.confirmed')}</Text>
        {cycle.isError ? <Body muted>{failureText(cycle)}</Body> : null}
        {cycle.data?.simulation ? <Text style={caption}>{tt('payout.simulation')}</Text> : null}
      </PhantomPressable>
    </View>
    <View style={{ gap: 4, paddingTop: 8 }}>
      <NavRow icon={<Icon name="camera" color={c.muted} />} label={tt('uploads.title')} onPress={() => nav.selectTab('uploads')} />
      <NavRow icon={<Icon name="upload" color={c.muted} />} label={tt('uploads.deliverTitle')} onPress={() => nav.push({ name: 'uploads', openDelivery: true })} />
      <NavRow icon={<Icon name="camera" color={c.muted} />} label={tt('home.devices')} subtitle={devices.data?.[0]?.serial ?? (devices.isError ? failureText(devices) : devices.isPending ? tt('common.loading') : tt('session.needDevice'))} onPress={() => nav.push({ name: 'devices' })} />
      <NavRow icon={<Icon name="clock" color={c.muted} />} label={tt('home.today')} subtitle={todaySession ? shortId(todaySession.id) : sessions.isError ? failureText(sessions) : sessions.isPending ? tt('common.loading') : tt('home.noSessionToday')} onPress={() => nav.selectTab('uploads')} />
      <NavRow icon={<Icon name="wallet" color={c.muted} />} label={tt('home.awaiting')} subtitle={awaiting ? shortId(awaiting.episodeId) : income.isError ? failureText(income) : income.isPending ? tt('common.loading') : tt('home.noAwaiting')} onPress={() => nav.selectTab('income')} />
      {awaiting ? <View style={{ gap: 4 }}><Text style={{ ...c.type.h2, fontFamily: face(theme), color: c.ink }}>{awaiting.amountVnd === null ? '—' : dong(awaiting.amountVnd)}</Text>{awaiting.simulation ? <Body muted>{tt('payout.simulation')}</Body> : null}</View> : null}
      <NavRow icon={<Icon name="chat" color={c.muted} />} label={tt('forum.title')} onPress={() => nav.push({ name: 'forum' })} />
      <NavRow icon={<Icon name="chat" color={c.muted} />} label={tt('groups.title')} onPress={() => nav.push({ name: 'groupChats' })} />
      <NavRow icon={<Icon name="file" color={c.muted} />} label={tt('home.training')} onPress={() => nav.push({ name: 'training' })} />
      <Button label={`${tt('profile.language')} / ${locale.toUpperCase()}`} variant="ghost" onPress={() => setLocale(nextLocale(locale))} />
      <Chip label={tt('guide.open')} onPress={guide.accept} />
    </View>
    {guide.offered ? <Card><Title>{tt('guide.offerTitle')}</Title><Body muted>{tt('guide.offerBody')}</Body><Button label={tt('guide.offerYes')} variant="secondary" onPress={guide.accept} /><Button label={tt('guide.offerNo')} variant="ghost" onPress={guide.decline} /></Card> : null}
  </Screen>;
}
