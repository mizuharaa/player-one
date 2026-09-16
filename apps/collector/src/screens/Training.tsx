import { StatePanel } from '../ui/StatePanel.tsx';
import { Failure } from '../ui/StatePanel.tsx';
import { useEffect, useRef } from 'react';
import { Image, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { HEADSET_COPY } from '../headset-guidance.ts';
import { HeadsetGuidance } from './SessionReminder.tsx';
import { Body, Button, Note, Screen } from '../ui.tsx';
import header from '../../assets/discover/work-wide.webp';

/**
 * APP-03: PaXini's supplied PXCap guidance, localized for the collector.
 * SPEC.md §7 — behaviour unchanged, restyled.
 *
 * The completion endpoint and the exam gate behind it are untouched: one
 * `api.completeTraining()`, the same re-entrancy guard, the same handoff to
 * §8.
 *
 * Three things are new and all three are §7's: a `16/9` header image with
 * `radius.lg`, the disclosure `training.placeholder` — the key already existed
 * and nothing was rendering it, so the screen was silent about the fact that
 * PaXini's course has not arrived — and the commit pinned to the foot through
 * `Screen`'s footer, the same shape as §6.
 *
 * `HEADSET_COPY` and `HeadsetGuidance` stay. §7's layout block names
 * `training.body`, but the guidance IS this screen's body — it is the real
 * supplied content that APP-03 is about, and §7 also says the behaviour is
 * unchanged. Deleting it to match a layout sketch would delete the training.
 *
 * **Not built.** No video player: §0.5 rule 1, this screen scrolls. No quiz —
 * the exam is §8. No progress percentage through a document that has no
 * sections yet.
 */
export function Training() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
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
    <Screen
      title={tt('training.title')}
      footer={
        <>
          {done.isError ? <Failure error={done.error} text={tt('common.actionFailed')} /> : null}
          <Button
            disabled={done.isPending}
            label={tt(done.isPending ? 'common.saving' : 'training.done')}
            onPress={() => {
              if (submitting.current) return;
              submitting.current = true;
              done.mutate();
            }}
          />
        </>
      }
    >
      {/*
        An `aspectRatio` box with `resizeMode="cover"`, never a width/height
        pair — that pair is exactly how the previous build stretched things.
      */}
      <View
        style={{
          aspectRatio: 16 / 9,
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
          backgroundColor: theme.color.muted,
        }}
      >
        <Image
          source={header}
          resizeMode="cover"
          style={{ width: '100%', height: '100%' }}
          accessibilityRole="image"
          accessibilityLabel={tt('training.title')}
        />
      </View>
      <Body>{HEADSET_COPY.intro[locale]}</Body>
      <HeadsetGuidance />
      <StatePanel title={tt('state.unavailable')} text={tt('training.placeholder')} action={tt('common.back')} onPress={() => nav.back()} />
    </Screen>
  );
}
