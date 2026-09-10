import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { HEADSET_COPY } from '../headset-guidance.ts';
import { HeadsetGuidance } from './SessionReminder.tsx';
import { Body, Button, Note, Screen } from '../ui.tsx';

/**
 * APP-03: PaXini's supplied PXCap guidance, localized for the collector.
 * The existing completion endpoint and exam gate remain authoritative.
 */
export function Training() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const { locale } = useLocale();
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const done = useMutation({
    mutationFn: () => api.completeTraining(),
    onSuccess: () => { if (mounted.current) nav.push({ name: 'exam' }); },
    onError: () => { submitting.current = false; },
  });

  return (
    <Screen title={tt('training.title')}>
      <Body>{HEADSET_COPY.intro[locale]}</Body>
      <HeadsetGuidance />
      {done.isError ? <Note text={tt('common.actionFailed')} /> : null}
      <Button disabled={done.isPending} label={tt(done.isPending ? 'common.loading' : 'training.done')} onPress={() => {
        if (submitting.current) return;
        submitting.current = true;
        done.mutate();
      }} />
    </Screen>
  );
}
