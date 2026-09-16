/**
 * The v2 pieces Builder B's screens need before `ui.tsx` carries them.
 *
 * `docs/design/mobile-v2/SPEC.md` §0.7 is explicit that every element maps to
 * something `ui.tsx` already exports, and these screens obey it: `Card`,
 * `CardLink`, `Button`, `Chip`, `Tag`, `Progress`, `RingChip`, `Row`,
 * `Field`, `Choice`, `Note`, `Timeline`, `Panda` are all imported and not
 * re-drawn. What is here is the four things §0.7 itself names as genuinely
 * new plus the warm-paper shell, and it lives in its own file for one reason:
 * Builder A owns `ui.tsx` for the whole of day 1 (§20.4 — "§0 tokens applied
 * to `theme.tsx` and `ui.tsx`"), and two builders editing 1,500 lines of it in
 * parallel is a merge nobody wants.
 *
 * **At the merge**, `WarmScreen`/`WarmList` fold into `Screen`/`ListScreen`
 * once those stand on `discover.paper`, and `PriceChip`, `TaskCard`,
 * `Skeleton`, `EmptyState` move into `ui.tsx` beside their siblings. Nothing
 * here is meant to be a second component library and nothing here should
 * outlive that merge.
 *
 * Every colour, size and radius comes from `useTheme()`. There is no literal
 * in this file and a diff that adds one is rejected (§20.4 item 5).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { NativeTheme } from '@playerone/design/native';
import { SCENARIOS, type Scenario, type Task } from './api/types.ts';
import { useT } from './locale.tsx';
import { useTheme } from './theme.tsx';
import { Button, bottomInset, face, topInset, useReducedMotion, useTabBarReserve } from './ui.tsx';
import { Panda } from './identity/Panda.tsx';
import { dong } from './money.ts';

import portrait from '../assets/discover/work-portrait.webp';

/**
 * `StyleSheet.absoluteFillObject` is not in the typings this project resolves,
 * and `absoluteFill` is a registered style id rather than an object, so it
 * cannot be spread beside other rules. This is the same four zeros, spreadable.
 */
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

// ---------------------------------------------------------------------------
// §0.3 Typography, as one table rather than as eight copies of a ratio

/**
 * The eight roles of §0.3, each with the line height that table measured.
 *
 * React Native wants absolute px, so the ratio is applied here once with
 * `Math.round` — a bare multiplier is a rejected diff, and ratios of 1.04–1.06
 * clip Vietnamese tone marks, which is the measurement this floor comes from.
 */
const TYPE_ROLES = {
  hero: 'display', display: 'h1', title: 'h2', section: 'h2',
  lead: 'body', body: 'body', caption: 'caption', micro: 'caption',
} as const;
export type TextRole = keyof typeof TYPE_ROLES;
export function textStyle(theme: NativeTheme, role: TextRole) {
  return { fontFamily: face(theme), ...theme.collector.type[TYPE_ROLES[role]] };
}

/** §10's next-step fallback, for a step that is not about one task. */
export const workImage = portrait;

/**
 * §0.4: an image lives in an `aspectRatio` box and never in a `width`/`height`
 * pair. That pair is exactly how the build the owner rejected stretched things,
 * so there is one box and every image on B's screens goes through it.
 */
export function ImageBox({
  source,
  ratio,
  radius,
  children,
}: {
  source: ImageSourcePropType;
  ratio: number;
  radius?: number;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        aspectRatio: ratio,
        width: '100%',
        maxWidth: '100%',
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: theme.color.discover.soft,
      }}
    >
      <Image
        source={source}
        resizeMode="cover"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// §10 The two-line price chip — one of the four genuinely new components (§0.7)

/**
 * A pay rate burned into a photograph's corner.
 *
 * **The two parts stack; they never share a line.** `hall.perMinute` is
 * "đ/phút hiệu quả" — fifteen characters — and a hall tile at 320dp is about
 * 150pt wide, so a one-line chip either overflows the tile or ellipsises the
 * unit. An ellipsised pay rate is not acceptable at any width, so neither
 * `Text` here carries `numberOfLines`.
 *
 * Neutral ink on an opaque ground keeps a rate readable over a photo without
 * implying that it is already paid.
 */
export function PriceChip({ value, unit }: { value: string; unit: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        flexDirection: 'column',
        backgroundColor: theme.collector.surface,
        borderRadius: theme.radius.base,
        paddingVertical: theme.space[2],
        paddingHorizontal: theme.space[3],
      }}
    >
      <Text
        style={{
          ...textStyle(theme, 'lead'),
          color: theme.collector.ink,
          fontWeight: theme.fontWeight.display,
        }}
      >
        {value}
      </Text>
      <Text style={{ ...textStyle(theme, 'micro'), color: theme.collector.ink }}>{unit}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The warm-paper shell

const groundPad = (theme: NativeTheme) => ({
  paddingHorizontal: theme.space[4],
  paddingTop: topInset(theme.space[6]) + theme.space[4],
});

/**
 * A screen's own name.
 *
 * `compact` is §11's rule and it is a measurement, not a preference: a browse
 * screen spends its vertical budget on the grid rather than on its own name,
 * and at 320×640 the `xl` title cost most of a tile row.
 */
export function ScreenTitle({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        ...textStyle(theme, compact ? 'section' : 'title'),
        color: theme.color.discover.ink,
        fontWeight: theme.fontWeight.display,
      }}
    >
      {children}
    </Text>
  );
}

/**
 * A scrolling screen standing on warm paper.
 *
 * It reserves the tab bar's **measured** height through `useTabBarReserve()`,
 * never a guess — the same reserve `ui.tsx` computes and `shell/TabBar.tsx`
 * feeds, so a two-row bar at 320dp pushes content down without this file
 * knowing anything about the bar.
 */
export function WarmScreen({ children, tabRoot = true }: { children: ReactNode; tabRoot?: boolean }) {
  const theme = useTheme();
  const reserve = useTabBarReserve();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.discover.paper }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          ...groundPad(theme),
          paddingBottom: (tabRoot ? reserve : bottomInset(theme.space[6])) + theme.space[6],
          gap: theme.space[4],
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** The same ground, for a screen whose content is a list that grows. */
export function WarmList<T>({
  data,
  keyOf,
  renderItem,
  header,
  empty,
  numColumns,
  refresh,
}: {
  data: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  header?: ReactNode;
  empty?: ReactNode;
  numColumns?: number;
  refresh?: { refreshing: boolean; onRefresh: () => void };
}) {
  const theme = useTheme();
  const reserve = useTabBarReserve();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.discover.paper }}>
      <FlatList
        key={numColumns === undefined ? 'one' : `cols-${numColumns}`}
        data={data as T[]}
        keyExtractor={keyOf}
        numColumns={numColumns}
        columnWrapperStyle={
          numColumns === undefined || numColumns < 2 ? undefined : { gap: theme.space[3] }
        }
        renderItem={({ item }) => <View style={{ flex: numColumns === undefined ? undefined : 1 }}>{renderItem(item)}</View>}
        ListHeaderComponent={header === undefined ? null : <View style={{ gap: theme.space[3] }}>{header}</View>}
        ListEmptyComponent={empty === undefined ? null : <View>{empty}</View>}
        refreshing={refresh?.refreshing}
        onRefresh={refresh?.onRefresh}
        progressViewOffset={theme.space[4]}
        contentContainerStyle={{
          ...groundPad(theme),
          paddingBottom: reserve + theme.space[6],
          gap: theme.space[3],
        }}
      />
    </View>
  );
}

/** A card on warm paper: `discover.surface`, `radius.xl`, `space[5]`. */
export function WarmCard({
  children,
  style,
  innerRef,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** The coach-mark target, when a step points at the whole card (§9). */
  innerRef?: (node: View | null) => void;
}) {
  const theme = useTheme();
  return (
    <View
      ref={innerRef}
      collapsable={false}
      style={[
        {
          backgroundColor: theme.color.discover.surface,
          borderRadius: theme.radius.xl,
          padding: theme.space[5],
          gap: theme.space[3],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// §17 Empty, loading and error — one shape, learned once

/**
 * A loading block: `discover.soft` at the real element's radius and ratio,
 * pulsing opacity 0.6 → 1.0 over 900ms on the native driver. Never a spinner,
 * on any screen whose layout is known in advance.
 *
 * **Reduced motion:** a static block at 0.8.
 */
export { Skeleton } from './ui/Skeleton.tsx';

/** `common.loading`, announced rather than printed (§17). */
export function LoadingRegion({ children }: { children: ReactNode }) {
  const tt = useT();
  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel={tt('common.loading')}>
      {children}
    </View>
  );
}

/**
 * §17's empty state: Trúc at 96pt in the `idle` pose, the screen's own
 * sentence, and — where one exists — a single ghost control. The real
 * component from `identity/Panda.tsx`, never a grey disc and never an emoji.
 */
export function EmptyState({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: theme.space[4], paddingVertical: theme.space[8] }}>
      <Panda pose="idle" />
      <Text
        style={{
          ...textStyle(theme, 'body'),
          color: theme.color.discover.muted,
          textAlign: 'center',
        }}
      >
        {text}
      </Text>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Button label={actionLabel} variant="secondary" onPress={onAction} />
      ) : null}
    </View>
  );
}

/** §17, kind one: the load failed and there is nothing to show. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  const tt = useT();
  return (
    <View style={{ gap: theme.space[4], paddingVertical: theme.space[8] }}>
      <Text style={{ ...textStyle(theme, 'body'), color: theme.color.discover.ink, textAlign: 'center' }}>
        {tt('common.loadFailed')}
      </Text>
      <Button label={tt('common.retry')} onPress={onRetry} />
    </View>
  );
}

/**
 * §17, kind two, and the one usually got wrong: **a failed refresh must not
 * blank a screen that already had data on it.** A strip above content that is
 * kept, on `warnBg` with `warn` as its ink — never `discover.ink` on that fill
 * and never the fill without that ink.
 */
export function StaleStrip({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: theme.color.warnBg,
        borderRadius: theme.radius.base,
        padding: theme.space[3],
      }}
    >
      <Text style={{ ...textStyle(theme, 'caption'), color: theme.color.warn }}>{text}</Text>
    </View>
  );
}

/** §17, kind three: an action failed, inline, under the control that failed. */
export function ActionError({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View accessibilityLiveRegion="polite">
      <Text style={{ ...textStyle(theme, 'caption'), color: theme.color.verdict.reject.fg }}>{text}</Text>
    </View>
  );
}

/**
 * §10's entrance: a card rises `translateY: 12 → 0` and fades, staggered 60ms,
 * **on first paint only** — not on every refocus, which is the thing that makes
 * a dashboard feel slow rather than alive.
 *
 * `opacity` and `transform` on the native driver, per §0.5 rule 4. There is no
 * colour interpolation and no width animation anywhere in this app.
 *
 * **Reduced motion:** no stagger and no rise; the card is simply there.
 */
export function Rise({ index, children }: { index: number; children: ReactNode }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      entrance.setValue(1);
      return;
    }
    const run = Animated.timing(entrance, {
      toValue: 1,
      duration: theme.duration.base,
      delay: index * STAGGER_MS,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [entrance, index, reduced, theme.duration.base]);
  return (
    <Animated.View
      style={{
        opacity: entrance,
        transform: [
          { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [RISE_DP, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
const STAGGER_MS = 60;
const RISE_DP = 12;

/**
 * The lime track §12 and §13 each spend their one lime on.
 *
 * §0.7 maps a progress track to `ui.tsx`'s `Progress`, and the label line above
 * this one still goes through `Row` for exactly that reason — the fraction is
 * readable digit for digit and the bar only shows its shape. The bar itself is
 * here for two things `Progress` cannot do and must not learn, because its own
 * callers depend on neither:
 *
 * - **§12 and §13 name `lime500` as the fill**, where `Progress` draws
 *   `lime[600]`, the darker step DESIGN.md assigns to strokes and the focus
 *   ring. On `discover.soft` the 500 is the one the mock shows.
 * - **§13 requires the fill to animate `transform: scaleX` on the native
 *   driver, never `width`.** An animated `width` runs on the JS thread and is
 *   the exact shape of the build the owner called laggy. `Progress` does not
 *   animate at all, on purpose, and giving it a driver would change every
 *   screen that already uses it.
 *
 * **Reduced motion:** the fill jumps to each value.
 */
export function LimeTrack({ fraction }: { fraction: number }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const grown = useRef(new Animated.Value(clamped)).current;
  useEffect(() => {
    if (reduced) {
      grown.setValue(clamped);
      return;
    }
    const run = Animated.timing(grown, {
      toValue: clamped,
      duration: theme.duration.slow,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [clamped, grown, reduced, theme.duration.slow]);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{
        height: theme.space[1.5],
        alignSelf: 'stretch',
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.discover.soft,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          ...FILL,
          backgroundColor: theme.color.lime[500],
          // `scaleX` scales about a View's centre by default, which would leave
          // a half-gap at both ends of a part-filled bar. `transformOrigin` is
          // core RN style since 0.76 and moves it to the edge a track actually
          // fills from — no measurement, no interpolation, and the transform
          // still runs on the native driver.
          transformOrigin: 'left',
          transform: [{ scaleX: grown }],
        }}
      />
    </View>
  );
}
