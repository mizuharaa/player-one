import { StatePanel } from '../ui/StatePanel.tsx';
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
  const tt = useT();
  const theme = useTheme();
  const { locale } = useLocale();
  return (
    <Screen title={tt('training.title')}>
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
