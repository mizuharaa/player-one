import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Film } from '../identity/Film.tsx';
import { useT } from '../locale.tsx';
import { useAppActive, useReducedMotion } from '../motion.ts';
import { useTheme } from '../theme.tsx';
import { Button } from '../ui.tsx';

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
 *
 * Ported from the web-harness build on 2026-09-11 for the first native build:
 * the film is `expo-video` (see `identity/Film.tsx`), the insets are real
 * (`react-native-safe-area-context`) instead of a status-bar guess, and the
 * legal line is a plain notice rather than links that went nowhere.
 */

/**
 * The counter that opened this collector's account, when the build knows one.
 * It is printed and never invented — and there is deliberately no unit price
 * beside it: no API is reachable before sign-in, and a rate on a landing that
 * the server did not send would be a number the app made up.
 *
 * Expo inlines only `EXPO_PUBLIC_*` reads at build time, so the knob is
 * `EXPO_PUBLIC_CENTRE_CODE`; `env.js` bridges it onto this legacy name the same
 * way it does for the API origin. Unset, the line is simply not drawn.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;
const env = typeof process === 'undefined' ? undefined : process?.env;
const LANDING_CENTRE_CODE = env?.['LANDING_CENTRE_CODE'] ?? '';

/** The mark's disc, in device pixels. Two of these overlapping by half. */
const MARK = 14;

/**
 * Own provider, so this screen measures its insets even before the shell has
 * one. It seeds from `initialWindowMetrics` (launch-time window insets, which
 * take precedence over a parent provider's), so the first frame is drawn rather
 * than waiting for the native inset event — the buttons are promised on that
 * frame. Nested inside the shell's provider that seed is identical at launch;
 * after a rotation the first frame may be one inset event behind, then corrects.
 */
export function Landing(props: { onSignIn: () => void }) {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <LandingBody {...props} />
    </SafeAreaProvider>
  );
}

function LandingBody({ onSignIn }: { onSignIn: () => void }) {
  const theme = useTheme();
  const tt = useT();
  const insets = useSafeAreaInsets();
  /** `null` until the system answers; unknown is treated as "no motion yet". */
  const reduced = useReducedMotion() !== false;
  const active = useAppActive();
  /** The film and the beats both stop when the person cannot see them. */
  const still = reduced || !active;
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
    color: theme.color.stage.over,
    fontFamily: theme.font.sans,
    fontSize: theme.fontSize['2xl'],
    lineHeight: theme.fontSize['2xl'] * 1.15,
    fontWeight: theme.fontWeight.display,
    letterSpacing: -1,
  } as const;

  /**
   * Beat `i` owns the offsets around `i * beat`: it rises from below, holds,
   * and rises out as the next one arrives. `translateY` and `opacity` only,
   * both native-driven, so a beat costs no layout. A beat holds for the middle
   * half of its window and fades over a quarter at each end, so beat `i` has
   * reached zero exactly where beat `i + 1` starts to arrive — overlapping
   * fades put two sentences of different line counts on screen at once, one a
   * ghost under the other, which reads as a rendering fault.
   */
  const beatStyle = (i: number) => {
    const at = i * beat;
    return {
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
              inputRange: [at - beat * 0.5, at - beat * 0.25, at + beat * 0.25, at + beat * 0.5],
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
        paddingTop: insets.top + theme.space[4],
        gap: theme.space[1],
      }}
    >
      {/*
        The mark and the word, the way the console's sign-in carries them: two
        overlapping discs — sun and tech, the one place the partners' colours
        still appear in this app — and the word beside them. Two Views rather
        than an SVG, because that is all the mark is.
      */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', width: MARK * 1.5 }}>
          <View style={{ width: MARK, height: MARK, borderRadius: MARK, backgroundColor: theme.color.sun[500] }} />
          <View
            style={{
              width: MARK,
              height: MARK,
              borderRadius: MARK,
              backgroundColor: theme.color.tech[500],
              marginLeft: -MARK / 2,
            }}
          />
        </View>
        <Text
          accessibilityRole="header"
          style={{
            color: theme.color.stage.over,
            fontFamily: theme.font.sans,
            fontSize: theme.fontSize.base,
            fontWeight: theme.fontWeight.bold,
            letterSpacing: 0.6,
          }}
        >
          {tt('app.name')}
        </Text>
      </View>
      {/* One mono line under the mark, only when the build was given a counter
          to print. No unit price — see LANDING_CENTRE_CODE above. */}
      {LANDING_CENTRE_CODE === '' ? null : (
        <Text
          style={{
            color: theme.color.stage.over,
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

  /**
   * The sheet: the actions rise off the film on the same ground the rest of the
   * app stands on — a lavender sheet with a rounded top edge, carrying the
   * furniture the console's mobile sign-in carries. The dashed seam inside its
   * top edge is the counter slip's tear line, the one thing on this screen
   * that says an account is opened by a person at a counter, which is the fact
   * the register button depends on. Ink on lavender, not `stage.over` on film:
   * nothing in this block sits on the footage.
   */
  const sheet = (
    <View
      style={{
        backgroundColor: theme.color.background,
        borderTopLeftRadius: theme.radius.xl,
        borderTopRightRadius: theme.radius.xl,
        paddingHorizontal: theme.space[5],
        paddingTop: theme.space[5],
        paddingBottom: theme.space[4] + Math.max(insets.bottom, theme.space[5]),
        gap: theme.space[3],
      }}
    >
      <View
        style={{
          borderTopWidth: 1,
          borderStyle: 'dashed',
          borderColor: theme.color.border,
          marginBottom: theme.space[1],
        }}
      />

      <Text
        style={{
          color: theme.color.foreground,
          fontFamily: theme.font.sans,
          fontSize: theme.fontSize.lg,
          fontWeight: theme.fontWeight.bold,
          letterSpacing: -0.4,
        }}
      >
        {tt('landing.sheetTitle')}
      </Text>
      <Text
        style={{
          color: theme.color.mutedForeground,
          fontFamily: theme.font.sans,
          fontSize: theme.fontSize.sm,
          lineHeight: theme.fontSize.sm * 1.5,
          marginTop: -theme.space[1],
        }}
      >
        {tt('landing.registerNote')}
      </Text>

      <Button label={tt('landing.signIn')} onPress={onSignIn} />
      <Button label={tt('landing.register')} kind="ghost" onPress={onSignIn} />

      {/*
        The legal line, as a plain notice. The harness build drew two underlined
        "links" whose `onPress` did nothing; a control that goes nowhere is a
        promise the app cannot keep, so until a real URL exists these are the
        two document names, in muted ink, and nothing is tappable.
      */}
      <Text
        style={{
          color: theme.color.mutedForeground,
          fontFamily: theme.font.sans,
          fontSize: theme.fontSize.xs,
          lineHeight: theme.fontSize.xs * 1.6,
        }}
      >
        {tt('legal.dataNotice')} · {tt('legal.privacy')}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.stage.ground, overflow: 'hidden' }}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          /*
           * Clipped, because the film grows. The scale runs 1 → 1.06 as the
           * hero collapses, and on a 390px screen that is 413.4px of video
           * with nothing holding it; the scroll that reveals the form must
           * never become a scroll in two axes.
           */
          { overflow: 'hidden' },
          reduced ? {} : { transform: [{ scale: filmScale }] },
        ]}
      >
        <Film label={tt('landing.videoLabel')} still={still} />
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
              would move twice, which reads as a stutter, not a beat. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {slogans.map((line, i) => (
              <Animated.View
                key={line}
                style={[
                  StyleSheet.absoluteFill,
                  { justifyContent: 'center', paddingHorizontal: theme.space[5] },
                  beatStyle(i),
                ]}
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
