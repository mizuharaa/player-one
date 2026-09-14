import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Text, View } from 'react-native';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Button, Film, LegalLine, Scrim, face, topInset, useReducedMotion } from '../ui.tsx';
import film from '../../assets/discover/pov-portrait.mp4';
import poster from '../../assets/discover/pov-portrait.webp';
import wordmark from '../../assets/discover/playerone-wordmark.png';

/**
 * SPEC.md §2 — Welcome. The product in one screen, before anyone signs in.
 *
 * The file keeps its old name because `App.tsx` and the harness both reach for
 * it by that name and the screen is still the app's front door; the screen it
 * holds is new. What was here before was a ported desktop landing: eight
 * scroll sections, a collector wall, a likeness sheet. The owner rejected it
 * on the emulator ("nothing is responsive… text and images stretched… navbar
 * not needed on the landing"), and this is the replacement — one screen, one
 * decision, no navbar.
 *
 * **It does not scroll, and that is what buys it the film.** §0.5 rule 1: a
 * `VideoView` mounts only on a screen that does not scroll. The previous lane
 * measured a playing 720p film against a ten-second scroll at 38 % janky
 * frames where the same page without it was 4 %; decoding is the cost, and it
 * is only a cost while something else wants the frame budget. Nothing here
 * scrolls and nothing else is on screen, so this is the one place besides the
 * splash where the film is free. There is no second video in the app.
 *
 * **The scrim does the reading, not a faded film.** The film plays at full
 * opacity under §2's measured three-stop scrim. Measured rather than chosen:
 * the drafted .35/.82 put the headline band at 3.02:1 and failed AA; the
 * shipped .60/.88 reads 5.24:1 at the same probe, with the worst frame at 8 s
 * where the camera pans onto a sunlit wall. A new film re-runs that
 * measurement — see `Scrim` in `ui.tsx`.
 *
 * **When the film fails, the poster is the screen.** One state, not three:
 * reduced motion, a decode error and §1's expired 400 ms first-frame gate all
 * land on `pov-portrait.webp` in the same box under the same scrim. `Film`
 * holds that rule so this screen does not have to branch.
 *
 * **No account is created here.** `landing.register` opens the support-desk
 * explanation, because that is where accounts are opened (`landing.registerNote`);
 * it is not a form and there is no third path.
 */

/**
 * §2's measured stops: transparent, .60 at 55 %, .88 at the foot.
 *
 * They live beside the screen that owns the film rather than inside `Scrim`,
 * because they are a property of `pov-portrait.mp4` and not of the component.
 */
const SCRIM_STOPS = [
  [0, 0],
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
        <View style={{ alignItems: 'center', paddingTop: topInset(theme.space[6]) + theme.space[4], gap: theme.space[3] }}>
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
          <View style={{ width: '46%', aspectRatio: 784 / 152 }}>
            <Image
              source={wordmark}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
              tintColor={onFilm}
              accessibilityRole="image"
              accessibilityLabel={tt('app.name')}
            />
          </View>
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
                lineHeight: Math.round(theme.fontSize['2xl'] * 1.18),
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
