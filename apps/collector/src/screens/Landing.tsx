import { BrandSlot } from '../shell/BrandSlot.tsx';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Text, View } from 'react-native';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Button, Film, LegalLine, Scrim, face, useInsets, useReducedMotion } from '../ui.tsx';
import film from '../../assets/hero/login.mp4';
import poster from '../../assets/hero/login-poster.jpg';

/** Non-scrolling welcome: one decoder, poster beneath it, scrim over both. */
const SCRIM_STOPS = [
  [0, 0.35],
  [0.55, 0.6],
  [1, 0.88],
] as const;

/** §2: the entrance rises 16 dp, and the three groups are 80 ms apart. */
const RISE = 16;
const STAGGER = 80;

/** Whether a support desk is named on this build. Unchanged from before. */
const env = typeof process === 'undefined' ? undefined : process.env;
const LANDING_CENTRE_CODE = env?.['LANDING_CENTRE_CODE'] ?? '';

/**
 * One group of the entrance. `opacity` and `translateY` only, native driver —
 * §0.5 rule 4, which is also why `react-native-reanimated` is not a dependency
 * (§20.1). Reduced motion renders at the final position on first paint; it
 * does not play a shorter version of the same thing.
 */
function Rise({ step, children }: { step: number; children: React.ReactNode }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: theme.duration.slow,
      delay: step * STAGGER,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [progress, reduced, step, theme.duration.slow]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  const theme = useTheme();
  const insets = useInsets();
  const tt = useT();
  /** The support-desk explanation, which is what `landing.register` opens. */
  const [explaining, setExplaining] = useState(false);
  /** The ink the scrim was measured against. Fixed: the film is not themed. */
  const onFilm = theme.color.discover.surface;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <Film
        source={film}
        poster={poster}
        label={tt('landing.videoLabel')}
        contentFit="cover"
        fade={theme.duration.slow * 2}
      />
      <Scrim stops={SCRIM_STOPS} />

      <View
        style={{
          flex: 1,
          justifyContent: 'space-between',
          padding: theme.space[5],
        }}
      >
        <View style={{ alignItems: 'center', paddingTop: insets.top + theme.space[4], gap: theme.space[3] }}>
          {/*
            The ratio lives on a wrapper `View` and the `Image` fills it.
            §0.4's rule is "every image lives in an `aspectRatio` box", and on
            Android that is load-bearing rather than stylistic: measured on
            `playerone34`, an `<Image>` carrying `width: '46%'` and
            `aspectRatio` *itself* ignored both and laid out at the asset's
            intrinsic 1568 dp, which put three letters of the wordmark across
            the whole screen. A `View` has no intrinsic size to fall back to,
            so the box is the box.
          */}
          <BrandSlot color={onFilm} />
          {LANDING_CENTRE_CODE === '' ? null : (
            <Text
              style={{
                color: onFilm,
                fontFamily: face(theme),
                fontSize: theme.fontSize.xs,
                lineHeight: Math.round(theme.fontSize.xs * 1.4),
              }}
            >
              {tt('landing.centre')} · {LANDING_CENTRE_CODE}
            </Text>
          )}
        </View>

        <View style={{ gap: theme.space[4] }}>
          <Rise step={0}>
            {/*
              Two lines of one heading, not two headings: it is one sentence
              and a screen reader should read it as one.

              `fontSize.2xl`, not 3xl. Measured in the mock: 3xl fits about
              sixteen Vietnamese characters on a 390 dp line and
              "Sống như mọi ngày." is eighteen, so it wrapped mid-sentence.
              3xl is reserved for the money figure, which is short by
              construction (§0.3).
            */}
            <Text
              accessibilityRole="header"
              style={{
                color: onFilm,
                fontFamily: face(theme),
                fontSize: theme.fontSize['2xl'],
                // 1.18, absolute. A bare multiplier is a rejected diff and a
                // ratio near 1.05 clips Vietnamese tone marks outright (§0.3).
                lineHeight: Math.ceil(theme.fontSize['2xl'] * 1.3),
                fontWeight: theme.fontWeight.display,
                letterSpacing: -0.5,
              }}
            >
              {tt('landing.slogan1')}
              {'\n'}
              {tt('landing.slogan2')}
            </Text>
          </Rise>

          <Rise step={1}>
            {/* The payoff, as a lead rather than a wrapped third display line. */}
            <Text
              style={{
                color: onFilm,
                fontFamily: face(theme),
                fontSize: theme.fontSize.md,
                lineHeight: Math.round(theme.fontSize.md * 1.4),
              }}
            >
              {tt('landing.slogan3')}
            </Text>
          </Rise>

          <Rise step={2}>
            <View style={{ gap: theme.space[3] }}>
              <Button label={tt('landing.signIn')} onDark onPress={onSignIn} />
              {/*
                Outlined, not a bare ghost: on footage an unbordered label is
                a word floating on a photograph, and the mock's approved
                artboard carries the outline. It is still not a second primary
                — `Button` gives `onDark` secondaries a 1.5 dp stage-ink edge
                and no fill, where the primary above is a solid light pill.
              */}
              <Button
                label={tt('landing.register')}
                variant="secondary"
                onDark
                accessibilityHint={tt('landing.registerNote')}
                onPress={() => setExplaining(true)}
              />
              {/*
                What the register control opens. Not a form: accounts are
                opened at a support desk and this sentence is the whole of
                what this screen can do about it (§2, "Not built"). It is
                plain text on the scrim rather than a `Note` box, because a
                warm panel here would be a second surface on top of the one
                photograph this screen is made of.
              */}
              {explaining ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={{
                    color: onFilm,
                    fontFamily: face(theme),
                    fontSize: theme.fontSize.xs,
                    lineHeight: Math.round(theme.fontSize.xs * 1.4),
                  }}
                >
                  {tt('landing.registerNote')}
                </Text>
              ) : null}
              {/*
                Below the CTAs here, and between the field and the CTA on
                sign-in. That is positional and not arbitrary: on a welcome
                screen the links are reference, and on a screen where pressing
                the button IS the consent they sit where the consent is given.
              */}
              <LegalLine onDark />
            </View>
          </Rise>
        </View>
      </View>
    </View>
  );
}
