import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Animated,
  Easing,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import poster from '../../assets/landing-poster.jpg';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Button, bottomInset, face, topInset, useReducedMotion } from '../ui.tsx';

/**
 * What the app is before there is a session: the film, three sentences, and
 * the way in.
 *
 * **The buttons are visible and tappable the moment this screen appears**, at
 * every viewport, with no scroll, no swipe and no animation in the way. They
 * sit in a stationary block below the scroll view rather than inside it, which
 * is why they never move: a landing whose sign-in has to be scrolled to is a
 * landing that has become a wall. Everything above them is progressive
 * enhancement on a screen that already works without it.
 *
 * **The film plays first and fills the screen.** Under it a flat ink scrim at
 * 62% — measured, not chosen: `stage.ground` at 0.62 over the worst pixel the
 * footage contains (`YMAX` is 255 on both the poster and the video, so the
 * worst case is pure white) composites to a relative luminance of 0.1496, and
 * white type on that is **5.26:1**. The floor for 4.5:1 is 0.58; 0.62 is that
 * floor with a margin, and the scrim only ever deepens as the beats advance,
 * never lightens. No gradient fade — one flat field, the way the token
 * contract asks.
 *
 * **Three beats, one per scroll step.** The slogans are pinned in the middle
 * of the film and driven by the scroll offset rather than carried by it: each
 * rises and fades as the next arrives, staggered, so exactly one sentence is
 * being read at a time. Under "remove animations" the scroll view is gone
 * entirely and all three are stacked and still, which is the same content in
 * one frame.
 */

/**
 * Where the demo film lives, read the way `api/config.ts` reads its values —
 * Metro and Vite both inline `process.env.X` at build time, so this is a
 * deployment knob and there is nothing to parse at runtime.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;
const env = typeof process === 'undefined' ? undefined : process?.env;
const LANDING_VIDEO_URL = env?.['LANDING_VIDEO_URL'] ?? '';
/**
 * The counter that opened this collector's account, when the build knows one.
 * It is printed and never invented — and there is deliberately no unit price
 * beside it: no API is reachable before sign-in, and a rate on a landing that
 * the server did not send would be a number the app made up.
 */
const LANDING_CENTRE_CODE = env?.['LANDING_CENTRE_CODE'] ?? '';

/**
 * A DOM `<video>`, typed as a component so this file needs no DOM lib.
 *
 * `react-native-web` renders through React DOM, so a host string is a real
 * element there. On a phone it is never constructed: the branch below is
 * behind `Platform.OS === 'web'`.
 */
const WebVideo = 'video' as unknown as ComponentType<Record<string, unknown>>;

/**
 * The film, full-bleed, behind everything.
 *
 * ponytail: this is the seam. React Native core has no `<Video>` — `expo-video`
 * and `react-native-video` are both native modules and nothing native builds
 * here (DEVICE_DEPS.md) — so on a phone this renders the poster frame, which
 * is the honest still of the same film rather than a black panel with a play
 * mark that would do nothing. Replace this component's native branch with
 * `<VideoView>` at the first native build; nothing else on this screen changes.
 * In the browser harness `react-native-web` is React DOM, so the real file
 * plays there: muted, looped, `playsInline`, poster first.
 */
function Film({ label, still }: { label: string; still: boolean }) {
  // "Remove animations" stops the film too, not only the beats: a looping
  // 11-second clip is the largest moving thing on this screen.
  if (!still && Platform.OS === 'web' && LANDING_VIDEO_URL !== '') {
    return (
      <WebVideo
        src={LANDING_VIDEO_URL}
        poster={poster as unknown as string}
        muted
        autoPlay
        loop
        playsInline
        aria-label={label}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    );
  }
  return (
    <Image
      accessibilityRole="image"
      accessibilityLabel={label}
      source={poster}
      resizeMode="cover"
      style={StyleSheet.absoluteFill}
    />
  );
}

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  const theme = useTheme();
  const tt = useT();
  const reduced = useReducedMotion();
  /**
   * How tall the scroll view actually is, measured rather than assumed. The
   * window's height was the first answer and it overshot by the mark and the
   * button block — about 300dp of scrolling past the last beat, which reads as
   * a screen that has stopped responding.
   */
  const [viewport, setViewport] = useState(0);

  const slogans = [tt('landing.slogan1'), tt('landing.slogan2'), tt('landing.slogan3')];

  /** The one-shot entrance for the first beat: 0 before, 1 after. */
  const enter = useRef(new Animated.Value(0)).current;
  /** The scroll offset the beats are scrubbed by. */
  const offset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: theme.duration.slow * 2,
      easing: Easing.bezier(0.22, 0.61, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [enter, reduced, theme.duration.slow]);

  /**
   * One beat's worth of scroll. Two of them put the third slogan on screen,
   * and the scroll view is given exactly that much room beyond its measured
   * height — so there is something to scroll on every phone in the pilot's
   * range, including the 640dp end where nothing else overflows, and nothing
   * left to scroll once the third sentence has arrived.
   */
  const beat = theme.space[20] * 3;

  /** The film pulls back a little and the scrim deepens as the beats pass. */
  const filmScale = offset.interpolate({
    inputRange: [0, beat * 2],
    outputRange: [1, 1.06],
    extrapolate: 'clamp',
  });
  const scrim = offset.interpolate({
    inputRange: [0, beat * 2],
    outputRange: [0.62, 0.78],
    extrapolate: 'clamp',
  });

  const sloganStyle = {
    color: theme.color.stage.fg,
    fontFamily: face(theme),
    fontSize: theme.fontSize['2xl'],
    lineHeight: theme.fontSize['2xl'] * 1.15,
    fontWeight: theme.fontWeight.display,
    letterSpacing: -1,
  } as const;

  /**
   * Beat `i` owns the offsets around `i * beat`: it rises from below, holds,
   * and rises out as the next one arrives. `translateY` and `opacity` only,
   * both native-driven, so a beat costs no layout.
   */
  const beatStyle = (i: number) => {
    const at = i * beat;
    return {
      // A beat holds for the middle half of its window and fades over a
      // quarter at each end, so beat `i` has reached zero exactly where beat
      // `i + 1` starts to arrive. Overlapping fades were the first version and
      // two sentences of different line counts were on screen at once, one of
      // them a ghost under the other — which reads as a rendering fault, not
      // as a transition.
      opacity:
        i === 0
          ? Animated.multiply(
              enter,
              offset.interpolate({
                inputRange: [at, at + beat * 0.25, at + beat * 0.5],
                outputRange: [1, 1, 0],
                extrapolate: 'clamp',
              }),
            )
          : offset.interpolate({
              inputRange: [
                at - beat * 0.5,
                at - beat * 0.25,
                at + beat * 0.25,
                at + beat * 0.5,
              ],
              outputRange: [0, 1, 1, 0],
              extrapolate: 'clamp',
            }),
      transform: [
        {
          translateY: offset.interpolate({
            inputRange: [at - beat, at, at + beat],
            outputRange: [theme.space[8], 0, -theme.space[8]],
            extrapolate: 'clamp',
          }),
        },
      ],
    };
  };

  const mark = (
    <View
      style={{
        paddingHorizontal: theme.space[5],
        paddingTop: topInset(theme.space[6]) + theme.space[4],
        gap: theme.space[1],
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: theme.color.stage.fg,
          fontFamily: face(theme),
          fontSize: theme.fontSize.base,
          fontWeight: theme.fontWeight.bold,
          letterSpacing: 0.6,
        }}
      >
        {tt('app.name')}
      </Text>
      {/* All that is left of the counter slip: one mono line under the mark,
          and only when the build was given a counter to print. No unit price —
          see LANDING_CENTRE_CODE above. */}
      {LANDING_CENTRE_CODE === '' ? null : (
        <Text
          style={{
            color: theme.color.stage.mid,
            fontFamily: theme.font.mono,
            fontSize: theme.fontSize.xs,
            letterSpacing: 1,
          }}
        >
          {tt('landing.centre')} · {LANDING_CENTRE_CODE}
        </Text>
      )}
    </View>
  );

  const sheet = (
    <View
      style={{
        paddingHorizontal: theme.space[5],
        paddingBottom: theme.space[5] + bottomInset(theme.space[6]),
        gap: theme.space[3],
      }}
    >
      {/* The other half of the counter slip: one dotted seam across the foot of
          the film, where the stub would tear. */}
      <View
        style={{
          borderTopWidth: 1,
          borderStyle: 'dashed',
          borderColor: theme.color.stage.mid,
          marginBottom: theme.space[2],
        }}
      />
      <Button label={tt('landing.signIn')} onPress={onSignIn} />
      <Button
        label={tt('landing.register')}
        variant="secondary"
        onDark
        accessibilityHint={tt('landing.registerNote')}
        onPress={onSignIn}
      />
      {/*
        Registering and signing in are the same door, because a collector
        account is opened by a person at a counter and not by this app. One
        plain sentence is cheaper than a form that would fail. It is drawn in
        `stage.fg` and not a muted grey: `stage.mid` on the scrimmed film
        measures 2.21:1 and this sentence is the one that explains the button
        above it.
      */}
      <Text
        style={{
          color: theme.color.stage.fg,
          fontFamily: face(theme),
          fontSize: theme.fontSize.xs,
          lineHeight: theme.fontSize.xs * 1.5,
        }}
      >
        {tt('landing.registerNote')}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.stage.ground }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          reduced ? {} : { transform: [{ scale: filmScale }] },
        ]}
      >
        <Film label={tt('landing.videoLabel')} still={reduced} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.color.stage.ground, opacity: reduced ? 0.62 : scrim },
        ]}
      />

      {mark}

      {reduced ? (
        // The static frame: the same three sentences, all readable, no scroll.
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: theme.space[5], gap: theme.space[3] }}>
          {slogans.map((line) => (
            <Text key={line} style={sloganStyle}>
              {line}
            </Text>
          ))}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Pinned, not carried: the beats sit still in the middle of the film
              and the offset scrubs them. A slogan inside the scroll content
              would move twice — once with the content and once with its own
              animation — which reads as a stutter, not a beat. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {slogans.map((line, i) => (
              <Animated.View
                key={line}
                style={{
                  ...StyleSheet.absoluteFillObject,
                  justifyContent: 'center',
                  paddingHorizontal: theme.space[5],
                  ...beatStyle(i),
                }}
              >
                <Text style={sloganStyle}>{line}</Text>
              </Animated.View>
            ))}
          </View>
          <Animated.ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            // Exactly two beats of room beyond the viewport, so the third
            // sentence is always reachable and the scroll ends where it does.
            onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
            contentContainerStyle={{ height: viewport + beat * 2 }}
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: offset } } }], {
              useNativeDriver: true,
            })}
          />
        </View>
      )}

      {sheet}
    </View>
  );
}
