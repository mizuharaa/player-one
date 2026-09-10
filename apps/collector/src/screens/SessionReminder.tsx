import { View } from 'react-native';
import { HEADSET_COPY, HEADSET_GUIDANCE } from '../headset-guidance.ts';
import { useLocale, useT } from '../locale.tsx';
import { useNav } from '../nav.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Note, Screen, Title } from '../ui.tsx';

/** Same source-backed material in onboarding and before each new session. */
export function HeadsetGuidance() {
  const { locale } = useLocale();
  const theme = useTheme();
  return (
    <>
      <Note text={HEADSET_COPY.external[locale]} />
      {HEADSET_GUIDANCE.map((section) => (
        <View key={section.id} style={{ gap: theme.space[3], marginTop: theme.space[3] }}>
          <Title>{section.title[locale]}</Title>
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
    <Screen title={HEADSET_COPY.shiftTitle[locale]}>
      <Body>{HEADSET_COPY.shiftIntro[locale]}</Body>
      <Body>{tt('reminder.body')}</Body>
      <HeadsetGuidance />
      <Button label={HEADSET_COPY.continue[locale]} onPress={() => nav.push({ name: 'sessionCreate' })} />
    </Screen>
  );
}
