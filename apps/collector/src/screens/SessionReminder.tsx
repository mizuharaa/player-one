import { Image, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import claimedPanda from '../../assets/illustrations/panda-claim-success.png';
import { HEADSET_COPY, HEADSET_GUIDANCE } from '../headset-guidance.ts';
import { useLocale, useT } from '../locale.tsx';
import { useNav, useRoute } from '../nav.tsx';
import { useTheme } from '../theme.tsx';
import { HowCharge, HowWear, HowPressDevice, HowHandOver } from '../ui/illustrations/index.tsx';
import { Body, Button, Card, Note, Screen, Title, face } from '../ui.tsx';
import { taskImage } from '../ui/taskImage.ts';
import { dong } from '../money.ts';
import { Icon } from '../ui/Icon.tsx';
import { DemoSkip } from '../ui/DemoSkip.tsx';

/** Same source-backed material in onboarding and before each new session. */
export function HeadsetGuidance() {
  const { locale } = useLocale();
  const theme = useTheme();
  return (
    <>
      <Note text={HEADSET_COPY.external[locale]} />
      {HEADSET_GUIDANCE.map((section, index) => (
        <View key={section.id} style={{ gap: theme.space[3], paddingVertical: theme.space[4], borderBottomWidth: 1, borderBottomColor: theme.collector.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Icon name={index === 0 ? 'camera' : index === 1 ? 'check' : 'info'} color={theme.collector.plum} /><View style={{ flex: 1 }}><Title>{section.title[locale]}</Title></View></View>
          {section.items.map((item) => <Body key={item.id}>{item.text[locale]}</Body>)}
        </View>
      ))}
      <Body muted>{HEADSET_COPY.source[locale]}</Body>
    </>
  );
}

/** Reading step only: no consent, telemetry, persistence or recording commands. */
export function SessionReminder() {
  const { locale } = useLocale();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme(), c = theme.collector, api = useApi();
  const { claimedTaskId } = useRoute('sessionReminder');
  const task = useQuery({ queryKey: ['task', claimedTaskId], queryFn: () => api.task(claimedTaskId!), enabled: !!claimedTaskId });
  if (claimedTaskId) return <Screen title={tt('detail.claimSuccess')}
    footer={<View style={{ gap: 8 }}><Button label={tt('detail.openSetup')} onPress={() => nav.push({ name: 'sessionReminder' })} /><Button label={tt('detail.backToTasks')} variant="ghost" onPress={() => nav.reset({ name: 'myTasks' })} /></View>}>
    <View testID="claim-success" style={{ alignItems: 'center', paddingVertical: 24, gap: 16 }}>
      <Image source={claimedPanda} accessible={false} style={{ width: 144, height: 144, resizeMode: 'contain' }} />
      <Text accessibilityRole="header" style={{ ...c.type.h1, fontFamily: face(theme), fontWeight: '700', color: c.ink, textAlign: 'center' }}>{tt('detail.claimSuccess')}</Text>
      <Body muted>{tt('detail.claimSuccessBody')}</Body>
    </View>
    {task.data ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line }}>
      <Image source={taskImage(task.data)} accessible={false} style={{ width: 72, height: 80, borderRadius: 16 }} />
      <View style={{ flex: 1, gap: 6 }}><Title>{task.data.title}</Title><Body>{dong(task.data.unitPriceVndPerMinute)} {tt('detail.perMinute')}</Body></View>
    </View> : null}
    <Title>{tt('detail.beforeStart')}</Title>
    <Body>{tt('detail.setupReminder')}</Body>
  </Screen>;
  return (
    <Screen title={HEADSET_COPY.shiftTitle[locale]}
      right={<DemoSkip from="sessionReminder" to="sessionCreate" onSkipped={() => nav.push({ name: 'sessionCreate' })} />}
      footer={<Button label={HEADSET_COPY.continue[locale]} onPress={() => nav.push({ name: 'sessionCreate' })} />}>
      <Body>{HEADSET_COPY.shiftIntro[locale]}</Body>
      <Body>{tt('reminder.body')}</Body>
      <HeadsetGuidance />
    </Screen>
  );
}

/** Short reminder after preparation; the full sourced guidance remains before every session. */
export function RecordingSteps() {
  const { locale } = useLocale();
  const items = HEADSET_GUIDANCE.map(section => section.items).flat();
  return <>{([
    ['power', HowCharge], ['mount', HowWear], ['sequence', HowPressDevice], ['handover', HowHandOver],
  ] as const).map(([id, Art]) => <Card key={id}><Art size={96} /><Body>{items.find(item => item.id === id)!.text[locale]}</Body></Card>)}</>;
}
