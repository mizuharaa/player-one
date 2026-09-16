import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { DemoSkip } from '../ui/DemoSkip.tsx';
import { Failure, StatePanel } from '../ui/StatePanel.tsx';
import { Image, View } from 'react-native';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { HEADSET_COPY } from '../headset-guidance.ts';
import { HeadsetGuidance } from './SessionReminder.tsx';
import { Body, Screen } from '../ui.tsx';
import header from '../../assets/discover/work-wide.webp';

/** Supplied headset guidance remains readable; an unavailable course cannot be completed. */
export function Training() {
  const nav = useNav();
  const api = useApi();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const needsExam = profile.data?.examPassed === false;
  const tt = useT();
  const theme = useTheme();
  const { locale } = useLocale();
  return (
    <Screen title={tt('training.title')} right={<DemoSkip from="training" to="exam" onSkipped={() => nav.push({ name: 'exam' })} />}>
      {profile.isError ? <Failure error={profile.error} text={tt('common.loadFailed')} onRetry={() => void profile.refetch()} busy={profile.isFetching} /> : null}
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
      <StatePanel title={tt('state.unavailable')} text={tt('training.placeholder')} action={tt(needsExam ? 'exam.title' : 'common.back')} onPress={() => needsExam ? nav.push({ name: 'exam' }) : nav.back()} />
    </Screen>
  );
}
