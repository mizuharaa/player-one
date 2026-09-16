import { useEffect } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { useT } from '../locale.tsx';
import { Body, Card, Screen, Title } from '../ui.tsx';
import { HowHandOver } from '../ui/illustrations/index.tsx';

/** Guidance only: registration and qualification remain with the existing pipeline. */
export function CounterRegistration({ onBack }: { onBack: () => void }) {
  const tt = useT();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => listener.remove();
  }, [onBack]);
  return <Screen title={tt('landing.register')} onBack={onBack}>
    <View style={{ alignItems: 'center' }}><HowHandOver size={144} /></View>
    {(['bring', 'where', 'staff', 'next'] as const).map(section => <Card key={section}>
      <Title>{tt(`counter.${section}Title`)}</Title>
      <Body>{tt(`counter.${section}`)}</Body>
    </Card>)}
  </Screen>;
}
