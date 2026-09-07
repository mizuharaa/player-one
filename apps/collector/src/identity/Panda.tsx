import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { mascotStateAt, type MascotState } from '@playerone/design/tokens';
import { useTheme } from '../theme.tsx';
import { useReducedMotion } from '../ui.tsx';

/**
 * Trúc, the panda, drawn in React Native core Views.
 *
 * The console draws him in SVG (`apps/console/src/components/identity/Panda.tsx`)
 * and that artwork is the reference this one reproduces: head wider than the
 * body, round solid ears, tilted eye patches, a small closed smile, black arms
 * and legs against a white face and belly, and a bamboo stalk in one paw.
 *
 * **There is no SVG here and there cannot be.** `react-native-svg` is a native
 * module and nothing native builds on this machine (DEVICE_DEPS.md), so every
 * shape below is a `View`: a circle is a View whose `borderRadius` is half its
 * side, an ear is a circle, an eye patch is a stadium rotated outward, the
 * stalk is a rounded rect. There is no image asset either — this app ships no
 * bitmaps, so a panda that only exists as a PNG is a panda that does not exist.
 *
 * **Every fill comes from the theme.** The console lists six literal hex
 * values because its SVG cannot read a CSS variable; here `useTheme()` works,
 * so the same six are `stage.ground`, `muted`, `background`, `bamboo[500]`,
 * `bamboo[600]` and a border for the ground shadow. A literal in this file
 * would be the same rejected diff it is in a screen.
 *
 * **He is driven by the clock, not by a mood picker** — `mascotStateAt` from
 * packages/design, the same function the console calls, so the two surfaces
 * are never in different states at the same moment.
 *
 * **He is never a control.** Tapping him reacts; it never navigates, never
 * submits, and never starts an upload. The tap is the whole of the "gamified
 * feel" the brief asked for: no coins, no XP, no streak, no badge.
 */

export type Pose = 'idle' | 'wave' | 'point';

/** The drawing is authored on this square and scaled from it. */
const UNIT = 120;

export function Panda({
  size = 96,
  pose = 'idle',
  state,
  onPress,
  label,
}: {
  size?: number;
  pose?: Pose;
  /** Defaults to whatever the clock says, which is the intended use. */
  state?: MascotState;
  /** Present makes him tappable; the reaction is squash-and-stretch and a grin. */
  onPress?: () => void;
  /** Spoken name. Without one he is decorative and hidden from TalkBack. */
  label?: string;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const s = state ?? mascotStateAt();
  const k = size / UNIT;

  /** Breathing: the whole character, a couple of percent, forever. */
  const breath = useRef(new Animated.Value(0)).current;
  /** Blink: the lids' vertical scale, 0 open, 1 shut. */
  const blink = useRef(new Animated.Value(0)).current;
  /** Tap: one squash-and-stretch. */
  const squash = useRef(new Animated.Value(0)).current;
  /** Wave: the left arm's extra rotation, used by the landing hero. */
  const wave = useRef(new Animated.Value(0)).current;
  const [happy, setHappy] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduced]);

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(3400),
        Animated.timing(blink, { toValue: 1, duration: 70, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 0, duration: 90, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink, reduced]);

  useEffect(() => {
    if (reduced || pose !== 'wave') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wave, {
          toValue: 1,
          duration: 340,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(wave, {
          toValue: 0,
          duration: 340,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      { iterations: 3 },
    );
    loop.start();
    return () => loop.stop();
  }, [wave, reduced, pose]);

  const react = () => {
    onPress?.();
    setHappy(true);
    setTimeout(() => setHappy(false), 1400);
    if (reduced) return;
    Animated.sequence([
      Animated.timing(squash, {
        toValue: 1,
        duration: 110,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(squash, {
        toValue: -1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(squash, { toValue: 0, friction: 4, useNativeDriver: true }),
    ]).start();
  };

  const ink = theme.color.stage.ground;
  const fur = theme.color.muted;
  const lightFill = theme.color.background;

  /** How much of each eye the lid covers, before a blink is added to it. */
  const lidRest = s === 'earlyBird' ? 0.5 : s === 'goldenHour' ? 0.34 : 0;
  const awake = s === 'dayShift' || s === 'nightOwl';
  /** The mid-stretch arm the early bird holds up, and the wave, share a socket. */
  const armUp = s === 'earlyBird' || pose === 'wave' || pose === 'point';

  /** Authored coordinates → device pixels. */
  const p = (v: number) => v * k;
  const box = (x: number, y: number, w: number, h: number, r: number, fill: string) => ({
    position: 'absolute' as const,
    left: p(x),
    top: p(y),
    width: p(w),
    height: p(h),
    borderRadius: p(r),
    backgroundColor: fill,
  });

  const armRotation = wave.interpolate({
    inputRange: [0, 1],
    outputRange: pose === 'point' ? ['-52deg', '-52deg'] : ['-34deg', '-72deg'],
  });

  return (
    <Pressable
      accessible={label !== undefined}
      accessibilityRole={label === undefined ? undefined : 'image'}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
      disabled={onPress === undefined}
      onPress={react}
      style={{ width: size, height: size * (118 / UNIT) }}
    >
      <Animated.View
        style={{
          width: size,
          height: size * (118 / UNIT),
          transform: [
            {
              scaleY: Animated.add(
                breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.022] }),
                squash.interpolate({ inputRange: [-1, 1], outputRange: [0.12, -0.12] }),
              ),
            },
            {
              scaleX: squash.interpolate({ inputRange: [-1, 1], outputRange: [0.92, 1.1] }),
            },
          ],
        }}
      >
        {/* Night gets a moon, drawn before him so nothing overlaps. */}
        {s === 'nightOwl' ? (
          <>
            <View style={box(92, 8, 18, 18, 9, fur)} />
            <View style={box(86, 4, 16, 16, 8, theme.color.surface)} />
          </>
        ) : null}

        {/* The ground shadow. */}
        <View style={box(31, 106, 58, 7, 3.5, theme.color.border)} />

        {/* Legs, then the body over them, so the joins need no drawing. */}
        <View style={box(41, 90, 15, 21, 7.5, ink)} />
        <View style={box(64, 90, 15, 21, 7.5, ink)} />

        {/* The left arm. Down at rest; up for the early bird, the wave and the
            pointing pose, which is the one the guide uses. */}
        <Animated.View
          style={[
            box(armUp ? 22 : 27, armUp ? 52 : 66, 13, 30, 6.5, ink),
            {
              transform: armUp
                ? [{ rotate: armRotation }]
                : [{ rotate: '-9deg' }],
            },
          ]}
        />
        {/* The right arm holds the stalk and does not move. */}
        <View style={[box(80, 66, 13, 30, 6.5, ink), { transform: [{ rotate: '9deg' }] }]} />

        {/* Body: an ink shoulder mass with the white belly sitting inside it. */}
        <View style={box(33, 61, 54, 46, 23, ink)} />
        <View style={box(40, 70, 40, 36, 18, lightFill)} />

        {/* Ears, behind the head, solid. */}
        <View style={box(24, 9, 22, 22, 11, ink)} />
        <View style={box(74, 9, 22, 22, 11, ink)} />

        {/* The head, wider than the body — the proportion the sheet is built on. */}
        <View style={box(28, 12, 64, 60, 30, fur)} />

        {/* The eye patches, tilted outward. */}
        <View
          style={[box(37, 29, 21, 25, 10.5, ink), { transform: [{ rotate: '-16deg' }] }]}
        />
        <View
          style={[box(62, 29, 21, 25, 10.5, ink), { transform: [{ rotate: '16deg' }] }]}
        />

        {/* The eyes: a white disc, a pupil, a catchlight when he is awake. */}
        <View style={box(42.8, 36.8, 10.4, 10.4, 5.2, lightFill)} />
        <View style={box(66.8, 36.8, 10.4, 10.4, 5.2, lightFill)} />
        <View style={box(44.6, 39.2, 6.8, 6.8, 3.4, ink)} />
        <View style={box(68.6, 39.2, 6.8, 6.8, 3.4, ink)} />
        {awake && !happy ? (
          <>
            <View style={box(45.1, 39.3, 3, 3, 1.5, lightFill)} />
            <View style={box(69.1, 39.3, 3, 3, 1.5, lightFill)} />
          </>
        ) : null}

        {/* The lids. Scaled from the top edge, so a blink shuts downward and
            the clock's resting lid and the blink add up rather than fight. */}
        {[42.8, 66.8].map((x) => (
          <Animated.View
            key={x}
            style={[
              box(x, 36.8, 10.4, 10.4, 5.2, ink),
              {
                transform: [
                  { translateY: -p(5.2) },
                  {
                    scaleY: blink.interpolate({
                      inputRange: [0, 1],
                      outputRange: [happy ? 0.55 : lidRest, 1],
                    }),
                  },
                  { translateY: p(5.2) },
                ],
              },
            ]}
          />
        ))}

        {/* Muzzle, nose, and the closed smile from the sheet. A grin when he
            has just been tapped: the same two strokes, further apart. */}
        <View style={box(47, 47.5, 26, 19, 9.5, lightFill)} />
        <View style={box(56, 52, 8, 5, 2.5, ink)} />
        <View
          style={[
            box(54.4, happy ? 60 : 58.4, 7, 1.6, 0.8, ink),
            { transform: [{ rotate: happy ? '26deg' : '18deg' }] },
          ]}
        />
        <View
          style={[
            box(58.6, happy ? 60 : 58.4, 7, 1.6, 0.8, ink),
            { transform: [{ rotate: happy ? '-26deg' : '-18deg' }] },
          ]}
        />

        {/* The bamboo, in the right paw. The early bird holds a short shoot. */}
        {s === 'earlyBird' ? (
          <>
            <View style={box(83, 62, 7, 20, 3.5, theme.color.bamboo[500])} />
            <View style={box(83, 70.4, 7, 1.4, 0.7, theme.color.bamboo[600])} />
            <View
              style={[
                box(86, 57, 12, 6, 3, theme.color.bamboo[500]),
                { transform: [{ rotate: '-18deg' }] },
              ]}
            />
          </>
        ) : (
          <>
            <View style={box(83, 34, 7, 62, 3.5, theme.color.bamboo[500])} />
            <View style={box(83, 51.3, 7, 1.4, 0.7, theme.color.bamboo[600])} />
            <View style={box(83, 71.3, 7, 1.4, 0.7, theme.color.bamboo[600])} />
            <View
              style={[
                box(86, 37, 14, 7, 3.5, theme.color.bamboo[500]),
                { transform: [{ rotate: '-20deg' }] },
              ]}
            />
            <View
              style={[
                box(75, 33, 12, 6, 3, theme.color.bamboo[500]),
                { transform: [{ rotate: '18deg' }] },
              ]}
            />
          </>
        )}

        {/* The paw closes over the stalk, so it is held rather than floating. */}
        <View style={box(79, 72.5, 15, 15, 7.5, ink)} />
      </Animated.View>
    </Pressable>
  );
}

/**
 * The panda at an absolute point on the screen, pointing.
 *
 * The coach-mark guide measures its target with `measureInWindow` and puts him
 * beside it. He is placed by his own top-left corner, so a caller that wants
 * him centred on something does that arithmetic; the guide does.
 *
 * He is decorative here on purpose — the guide card next to him carries the
 * sentence, and a screen reader that read the panda as well would say the same
 * step twice.
 */
export function PandaPointer({
  x,
  y,
  size = 72,
  flip = false,
}: {
  x: number;
  y: number;
  size?: number;
  /** Face the other way, when the target sits on the left of the screen. */
  flip?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: [{ scaleX: flip ? -1 : 1 }],
      }}
    >
      <Panda size={size} pose="point" />
    </View>
  );
}
