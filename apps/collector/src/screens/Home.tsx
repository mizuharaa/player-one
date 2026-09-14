import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { mascotStateAt } from '@playerone/design/tokens';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { nextLocale } from '../i18n.ts';
import { useTheme } from '../theme.tsx';
import { useGuide, useGuideTarget } from '../guide/Guide.tsx';
import { useSignOut } from '../session.tsx';
import { Body, Button, Card, CardLink, Chip, Hatch, Loading, NavRow, Note, Row, Screen, Title } from '../ui.tsx';

const REVIEWED = ['review_passed', 'review_failed'];

/** APP-08/24: work first; server facts stay distinct from preparation actions. */
export function Home() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const { locale, setLocale } = useLocale();
  const guide = useGuide();
  const signOut = useSignOut();
  const shift = mascotStateAt();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.boundDevices() });
  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const ringTarget = useGuideTarget('home.ring');
  const tasksTarget = useGuideTarget('home.tasks');
  const claimable = (tasks.data ?? []).filter((task) => task.claimable);
  const reviewed = (episodes.data ?? []).filter((episode) => REVIEWED.includes(episode.state)).length;
  const ringLabel = episodes.isError ? tt('home.ringFailed') : episodes.data === undefined
    ? tt('home.ringLoading') : `${reviewed} ${tt('home.reviewedCaption')}`;

  return <Screen title={tt(`greeting.${shift}`)} right={
    <Chip label={tt('common.language')} onPress={() => setLocale(nextLocale(locale))} />
  }>
    {profile.data?.name === undefined ? null : <Body muted>{profile.data.name}</Body>}
    <View style={{ gap: theme.space[2] }}>
      <Button label={tt('hall.title')} onPress={() => nav.push({ name: 'taskHall' })} />
      <Button label={tt('home.myTasks')} variant="secondary" onPress={() => nav.push({ name: 'myTasks' })} />
    </View>

    <View ref={tasksTarget} collapsable={false} style={{ gap: theme.space[3], paddingTop: theme.space[4] }}>
      <Title>{tt('home.claimable')}</Title>
      {tasks.isError ? <><Note text={tt(tasks.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} /><Button label={tt('common.retry')} variant="secondary" disabled={tasks.isFetching} onPress={() => void tasks.refetch()} /></> : null}
      {tasks.isFetching ? <Loading /> : null}
      {tasks.data !== undefined && claimable.length === 0 && !tasks.isError ? <Hatch text={tt('home.claimableEmpty')} /> : null}
      {/* The same card as the hall's, and for the same reason: the task's name
          is what the collector is choosing between, and the unit price is a
          measured quantity beside it rather than a 24sp figure above it. Three
          of these stacked under one heading was three hero metrics on the screen
          the app opens on — `DESIGN.md` allows one ink figure per screen, on
          `TaskDetail`, where it carries the payment rule and the claim button. */}
      {claimable.slice(0, 3).map((task) => <CardLink key={task.id} label={task.title} hint={tt('detail.title')} onPress={() => nav.push({ name: 'taskDetail', taskId: task.id })}>
        <View style={{ gap: theme.space[1] }}>
          <Title>{task.title}</Title>
          <Body muted>{task.scenario === null ? (task.type || tt('detail.notSupplied')) : tt(`scenario.${task.scenario}`)}</Body>
        </View>
        <Row label={tt('hall.pricePerMinute')} value={`${task.unitPriceVndPerMinute} ${task.currency}`} />
        <Body>{tt('detail.title')} ›</Body>
      </CardLink>)}
    </View>

    <View style={{ gap: theme.space[2], paddingTop: theme.space[4] }}>
      <Title>{tt('session.title')}</Title>
      {profile.data !== undefined && profile.data !== null && !profile.data.examPassed ? <Note text={tt('home.gateExam')} /> : null}
      {devices.isError ? <><Note text={tt('common.loadFailed')} /><Button label={tt('common.retry')} variant="secondary" disabled={devices.isFetching} onPress={() => void devices.refetch()} /></>
        : devices.isPending ? <Loading />
        : devices.data?.length === 0 ? <Note text={tt('home.gateDevice')} /> : null}
      <NavRow label={tt('home.devices')} onPress={() => nav.push({ name: 'devices' })} />
      <NavRow label={tt('session.title')} onPress={() => nav.push({ name: 'sessionReminder' })} />
      <View ref={ringTarget} collapsable={false}>
        <NavRow label={`${tt('home.uploads')} · ${ringLabel}`} onPress={() => nav.selectTab('uploads')} />
      </View>
    </View>

    <View style={{ paddingTop: theme.space[4] }}>
      <Title>{tt('home.more')}</Title>
      <NavRow label={tt('home.incomeLink')} onPress={() => nav.selectTab('income')} />
      {/* The forum is pushed now, not a tab root: §10 gave its bar slot to the
          task hall, which is the money path. It is still one tap from here. */}
      <NavRow label={tt('forum.title')} onPress={() => nav.push({ name: 'forum' })} />
      <NavRow label={tt('home.training')} onPress={() => nav.push({ name: 'training' })} />
      <NavRow label={tt('guide.open')} onPress={guide.accept} />
    </View>
    {/* The account, last, and the only place it is offered. Ghost, because it
        is a way out rather than a commitment, and at the foot of the screen
        that carries the collector's name — not across the foot of all four
        tabs, which is where it used to be (`session.tsx`). */}
    <View style={{ paddingTop: theme.space[4] }}>
      <Button label={tt('signIn.signOut')} variant="ghost" onPress={signOut} />
    </View>
    {guide.offered ? <Card>
      <Title>{tt('guide.offerTitle')}</Title><Body muted>{tt('guide.offerBody')}</Body>
      <Button label={tt('guide.offerYes')} variant="secondary" onPress={guide.accept} />
      <Button label={tt('guide.offerNo')} variant="ghost" onPress={guide.decline} />
    </Card> : null}
  </Screen>;
}
