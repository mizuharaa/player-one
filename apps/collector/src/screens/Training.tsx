import { useMutation } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Card, Note, Screen } from '../ui.tsx';

/**
 * APP-03: mechanism only. The material itself is PaXini's deliverable,
 * localised by VNG; this screen is the slot it drops into.
 */
export function Training() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();

  const done = useMutation({
    mutationFn: () => api.completeTraining(),
    onSuccess: () => nav.push({ name: 'exam' }),
  });

  return (
    <Screen title={tt('training.title')}>
      <Note text={tt('training.placeholder')} />
      <Card>
        <Body>{tt('training.body')}</Body>
      </Card>
      <Button label={tt('training.done')} onPress={() => done.mutate()} />
    </Screen>
  );
}
