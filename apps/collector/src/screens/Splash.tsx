import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, Text, View } from 'react-native';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { bottomInset, face } from '../ui.tsx';
import wordmark from '../../assets/discover/playerone-wordmark.png';

/**
 * SPEC.md §1. The first thing a collector ever sees.
 *
 * **The clip is cut, and that was the plan.** §20.4's cut list puts the
 * pre-rendered `splash.mp4` first, "because it is the only item with a whole
 * build pipeline behind it" — a Playwright screencast of the console's
 * `AssemblyLogo` through ffmpeg, §20.2. What ships is §1's own reduced-motion
 * path, named there as the fallback and specified to the millisecond: the
 * static wordmark at final scale, held 400 ms, then the same cross-fade into
 * Welcome. Nobody is blocked and the app opens correctly. When the render
 * lands, this screen gains a `<Film>` in the same box — the component is
 * already in `ui.tsx` with §1's 400 ms first-frame gate, and the box below is
 * already the 62 % / 784x152 one the clip is authored for, which is the whole
 * reason that box is specified rather than chosen.
 *
 * **It does not wait on the session.** `CollectorSession` mounts underneath
 * and `restoreSession()` runs while this is on screen; this is an overlay with
 * a timer, not a gate in front of the app. A splash that awaited the network
 * would be a splash that is 1.6 s on a good connection and forever on a bad
 * one.
 *
 * **It unmounts.** §0.5 rule 5: a full-screen overlay left at `opacity: 0`
 * still eats every touch on Android, and that is the "nothing has
 * functionality" dead-button report. `onDone` removes it from the tree; it
 * never fades to nothing and stays.
 *
 * **The wordmark is the only thing in the box.** The caption and the partner
 * line are live `Text` underneath it, so they stay translatable and stay
 * legible at any font scale — a clip with baked text is a clip that cannot be
 * localised, which is the first of §1's four contractual properties of the
 * asset and the reason they are worth holding to now, before it exists.
 */

/** §1: the still holds this long before it hands over. */
const HOLD = 400;
/** §1: the handover, and one of §0.5's three named duration exceptions. */
const CROSSFADE = 600;
/** §1: "tappable to dismiss after 300 ms" — before that a stray tap is not an answer. */
const DISMISSIBLE = 300;

export function Splash({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const tt = useT();
  const shown = useRef(new Animated.Value(1)).current;
  const [dismissible, setDismissible] = useState(false);
  const leaving = useRef(false);

  useEffect(() => {
    const leave = () => {
      if (leaving.current) return;
      leaving.current = true;
      Animated.timing(shown, {
        toValue: 0,
        duration: CROSSFADE,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onDone();
      });
    };
    // Two timers, not a chain: the second is what ends the screen, and the
    // first only decides whether a tap counts before then.
    const open = setTimeout(() => setDismissible(true), DISMISSIBLE);
    const hold = setTimeout(leave, HOLD);
    return () => {
      clearTimeout(open);
      clearTimeout(hold);
    };
  }, [onDone, shown]);

  const skip = () => {
    if (!dismissible || leaving.current) return;
    leaving.current = true;
    onDone();
  };

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        opacity: shown,
        backgroundColor: theme.color.background,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tt('app.name')}
        onPress={skip}
        style={{
          flex: 1,
          paddingHorizontal: theme.space[5],
          paddingBottom: bottomInset(theme.space[8]),
        }}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.space[6],
          }}
        >
          {/*
            Never a width/height pair: the box is a percentage and a ratio, so
            it is the same box at 320 dp and at 412 dp — and it is the box the
            clip will be authored for (§1, property 3).

            The ratio is on the `View`, not on the `Image`. Measured on
            `playerone34`: an `<Image>` given both `width: '62%'` and
            `aspectRatio` ignored them and took the asset's intrinsic size.
          */}
          <View style={{ width: '62%', aspectRatio: 784 / 152 }}>
            <Image
              source={wordmark}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
              tintColor={theme.color.foreground}
              accessibilityRole="image"
              accessibilityLabel={tt('app.name')}
            />
          </View>
          <Text
            style={{
              color: theme.color.mutedForeground,
              fontFamily: face(theme),
              fontSize: theme.fontSize.sm,
              lineHeight: Math.round(theme.fontSize.sm * 1.4),
              textAlign: 'center',
            }}
          >
            {tt('splash.caption')}
          </Text>
        </View>
        <Text
          style={{
            color: theme.color.mutedForeground,
            fontFamily: face(theme),
            fontSize: theme.fontSize.xs,
            lineHeight: Math.round(theme.fontSize.xs * 1.4),
            textAlign: 'center',
          }}
        >
          {tt('splash.partners')}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
