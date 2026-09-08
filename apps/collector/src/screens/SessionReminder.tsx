import { useT } from '../locale.tsx';
import { useNav } from '../nav.tsx';
import { Body, Button, Screen } from '../ui.tsx';

export function SessionReminder() {
  const tt = useT();
  const nav = useNav();
  return (
    <Screen title={tt('reminder.title')}>
      <Body>{tt('reminder.body')}</Body>
      <Button label={tt('reminder.continue')} onPress={() => nav.push({ name: 'sessionCreate' })} />
    </Screen>
  );
}
