import { View } from 'react-native';
import { HEADSET_COPY, HEADSET_GUIDANCE } from '../headset-guidance.ts';
import { useLocale, useT } from '../locale.tsx';
import { useNav } from '../nav.tsx';
import { useTheme } from '../theme.tsx';
import { HowCharge, HowWear, HowPressDevice, HowHandOver } from '../ui/illustrations/index.tsx';
import { Body, Button, Card, Note, Screen, Title } from '../ui.tsx';
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
        <View key={section.id} style={{ gap: theme.space[3], marginTop: theme.space[3], backgroundColor: theme.collector.surface, padding: 16, borderRadius: 20 }}>
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
