import { useReducedMotion } from './ui/motion.ts';
import { Skeleton } from './ui/Skeleton.tsx';
import { PhantomPressable as Pressable } from './ui/PhantomPressable.tsx';
import { useContext, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  AppState,
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { isLowPowerModeEnabledAsync, addLowPowerModeListener } from 'expo-battery';
import { VideoView, useVideoPlayer } from 'expo-video';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { NativeTheme } from '@playerone/design/native';
import { useNav } from './nav.tsx';
import { useT } from './locale.tsx';
import type { MessageKey } from './i18n.ts';
import { useTheme } from './theme.tsx';



/** Initial native metrics also serve the existing non-hook layout helpers. */
export function topInset(fallback: number): number {
  return initialWindowMetrics?.insets.top ?? (Platform.OS === 'android' ? StatusBar.currentHeight ?? fallback : fallback);
}
export function bottomInset(floor: number): number {
  return Math.max(initialWindowMetrics?.insets.bottom ?? 0, floor);
}
/** Use live provider measurements when orientation or system bars change. */
export function useInsets() {
  return useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
}

export const face = (theme: NativeTheme): string =>
  Platform.OS === 'web' ? `Be Vietnam Pro, ${theme.font.sans}` : theme.font.sans;

/**
 * Does the collector have "remove animations" on? Every authored motion in
 * this app asks first and renders its end state when the answer is yes.
 *
 * One hook rather than a check per component: `isReduceMotionEnabled()` is a
 * promise and the change event needs unsubscribing, and getting either wrong
 * in six places is how one screen keeps moving after the setting is turned on.
 */
export { useReducedMotion } from './ui/motion.ts';

/** Dock content height; its measured value replaces this first-frame reserve. */
const barHeight = (theme: NativeTheme): number => theme.space[12] + theme.space[4];

let measuredTabHeight = 0;
const tabListeners = new Set<() => void>();
export function measureTabBar(height: number) {
  if (height === measuredTabHeight) return;
  measuredTabHeight = height;
  tabListeners.forEach((notify) => notify());
}
export function useTabBarReserve() {
  const theme = useTheme();
  useWindowDimensions();
  useSyncExternalStore(
    (notify) => { tabListeners.add(notify); return () => { tabListeners.delete(notify); }; },
    () => measuredTabHeight,
  );
  const insets = useInsets();
  return insets.bottom + theme.space[6] + (measuredTabHeight || barHeight(theme)) + theme.space[5];
}

export function Header({ title, right, onBack, progress }: { title: string; right?: ReactNode; onBack?: () => void; progress?: ReactNode }) {
  const theme = useTheme();
  const nav = useNav();
  const tt = useT();
  const insets = useInsets();
  const back = onBack ?? (nav.canGoBack ? nav.back : undefined);
  const heading = <Text accessibilityRole="header" style={{ ...theme.collector.type.h1, color: theme.color.foreground,
    fontFamily: face(theme), flexShrink: 1, flexGrow: 1 }}>{title}</Text>;
  return <View style={{ paddingTop: insets.top + theme.space[2], paddingBottom: theme.space[3], gap: theme.space[3] }}>
    {back ? <><View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={tt('common.back')} onPress={back}
        style={{ minWidth: 48, minHeight: 48, justifyContent: 'center' }}>
        <Text style={{ ...theme.collector.type.h2, color: theme.collector.ink }}>←</Text>
      </Pressable>{progress}{right}</View>{heading}</> :
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>{heading}{right}</View>}
  </View>;
}

/** A screen whose content is bounded: a form, a hub, one record's detail. */
export function Screen({
  title,
  right,
  onBack,
  progress,
  footer,
  refresh,
  children,
}: {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
  progress?: ReactNode;
  /**
   * A commit control pinned to the foot of the screen rather than sitting at
   * the end of the list (§6, §7, §8).
   *
   * It exists because at 320x640 six agreement rows plus an intro do not fit,
   * and a commit control a collector has to hunt for is the shape that
   * produces accidental non-consent. The footer measures itself and the scroll
   * content reserves exactly that height — the same discipline `measureTabBar`
   * uses, and for the same reason: a guessed reserve draws the last row of a
   * list under the control that acts on it.
   */
  footer?: ReactNode;
  refresh?: { refreshing: boolean; onRefresh: () => void };
  children: ReactNode;
}) {
  const theme = useTheme();
  const nav = useNav();
  const insets = useInsets();
  const reserve = useTabBarReserve();
  const [footerHeight, setFooterHeight] = useState(0);
  return (
    // `background` is the page — the warm paper everything above it stands on.
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: theme.color.background }}>
      <ScrollView
        refreshControl={refresh ? <RefreshControl {...refresh} /> : undefined}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.collector.gutter,
          paddingTop: 0,
          paddingBottom:
            theme.space[4] + footerHeight + (nav.isTabRoot ? reserve : Math.max(insets.bottom, theme.space[6])),
          gap: theme.space[3],
        }}
      >
        <Header title={title} right={right} onBack={onBack} progress={progress} />
        {children}
      </ScrollView>
      {footer === undefined ? null : (
        <View
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.color.background,
            // One hairline, and it is the only rule on a `Screen`: it is the
            // edge of a control strip over scrolling content, which is a
            // boundary rather than the decorative bar the header deliberately
            // does not draw.
            borderTopWidth: 1,
            borderTopColor: theme.color.border,
            padding: theme.space[4],
            paddingBottom: theme.space[4] + Math.max(insets.bottom, theme.space[6]),
            gap: theme.space[3],
          }}
        >
          {footer}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/**
 * A screen whose content is a collection that grows with the pilot: the task
 * hall, claimed tasks, episodes, income. `FlatList` rather than `.map()` inside
 * `Screen`, so 500 collectors' worth of rows do not all mount at once.
 *
 * Do not nest this inside `Screen` — a `FlatList` inside a `ScrollView` is
 * unvirtualized again, which is the bug this exists to avoid.
 */
export function ListScreen<T>({
  title,
  right,
  data,
  keyOf,
  renderItem,
  header,
  footer,
  empty,
  refresh,
}: {
  title: string;
  right?: ReactNode;
  data: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  refresh?: { refreshing: boolean; onRefresh: () => void };
}) {
  const theme = useTheme();
  const nav = useNav();
  const insets = useInsets();
  const reserve = useTabBarReserve();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <FlatList
        refreshing={refresh?.refreshing}
        onRefresh={refresh?.onRefresh}
        keyboardShouldPersistTaps="handled"
        data={data as T[]}
        keyExtractor={keyOf}
        // Views and not fragments: `VirtualizedList` clones each of these with
        // an `onLayout`, and a fragment cannot take one — which React reports
        // as an invalid-prop error on every render.
        renderItem={({ item }) => <View>{renderItem(item)}</View>}
        ListHeaderComponent={<View style={{ gap: theme.space[3] }}><Header title={title} right={right} />{header}</View>}
        ListFooterComponent={footer === undefined ? null : <View>{footer}</View>}
        ListEmptyComponent={empty === undefined ? null : <View>{empty}</View>}
        contentContainerStyle={{
          padding: theme.collector.gutter,
          paddingTop: 0,
          paddingBottom: theme.space[4] + (nav.isTabRoot ? reserve : Math.max(insets.bottom, theme.space[6])),
          gap: theme.space[3],
        }}
      />
    </View>
  );
}


export function Frost({ fill }: { fill: number }) {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.card, opacity: fill }]}
    />
  );
}

/** The box a card is, minus its fill — shared by `Card` and `CardLink`. */
const cardBox = (theme: NativeTheme) => ({
  backgroundColor: theme.collector.surface,
  borderColor: theme.color.border,
  borderWidth: 1,
  borderRadius: theme.radius.lg,
  padding: theme.space[4],
  gap: theme.space[2],
  // The frost layer is absolutely positioned and has to be cut to the radius.
  overflow: 'hidden' as const,
});

export function Card({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={cardBox(theme)}>
      {children}
    </View>
  );
}


export function GlassBar({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        minHeight: barHeight(theme),
        borderWidth: 1,
        borderColor: theme.color.border,
        borderRadius: theme.radius.pill,
        paddingTop: theme.space[3],
        paddingBottom: theme.space[2],
        paddingHorizontal: theme.space[2],
        overflow: 'hidden',
        // ponytail: elevation only. `nativeTheme()` exports depth as Material
        // elevation levels and no shadow offsets — `shadow`/`shadowDark` in
        // tokens.ts are CSS strings and are not carried across, deliberately
        // (`native.ts`, "Shadows"). So Android draws a real shadow here and
        // react-native-web draws none; the hairline border is what holds the
        // pill's edge in the harness. Give this a `shadow*` token and it can
        // have one in both.
        elevation: theme.elevation.floating,
      }}
    >
      <Frost fill={theme.glass.bar.fill} />
      {children}
    </View>
  );
}

/**
 * A card that is also a tap target. The plain `<Pressable><Card>…` it replaces
 * announced nothing at all to TalkBack: no role, no name, so the whole card
 * read out as its raw text with no hint that it could be opened. Every list
 * card in the app goes through here so that name is not optional.
 */
export function CardLink({
  label,
  hint,
  onPress,
  children,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({
        ...cardBox(theme),
        // Pressed, the glass clears and the muted fill under it shows through.
        // A denser frost would have been the prettier idea and is not a press:
        // measured, 0.62 and 0.78 of white over the lavender page are #F8F9FC
        // and #FBFBFD, which nobody's thumb can tell apart.
        backgroundColor: pressed ? theme.color.muted : theme.collector.surface,
        borderColor: pressed ? theme.color.borderStrong : theme.color.border,
      })}
    >
      {({ pressed }) => (
        <>

          {children}
        </>
      )}
    </Pressable>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: theme.color.foreground,
        fontFamily: face(theme),
        ...theme.collector.type.h2,
        letterSpacing: -0.2,
      }}
    >
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: muted ? theme.color.mutedForeground : theme.color.foreground,
        fontFamily: face(theme),
        fontSize: theme.fontSize.base,
        lineHeight: theme.fontSize.base * 1.5,
      }}
    >
      {children}
    </Text>
  );
}


export function Amount({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return <View style={{ gap: theme.space[1] }}>
    <Text style={{ color: theme.color.foreground, fontFamily: face(theme), ...theme.collector.type.money, fontVariant: ['tabular-nums'] }}>{value}</Text>
    <Body muted>{label}</Body>
  </View>;
}

/** Secondary destinations have a full-width touch region. */
export function NavRow({ label, subtitle, icon, onPress }: { label: string; subtitle?: string; icon?: ReactNode; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${label}. ${subtitle}` : label} onPress={onPress}
    style={({ pressed }) => ({ minHeight: theme.space[12], paddingVertical: theme.space[4], flexDirection: 'row', alignItems: 'center', gap: theme.space[3], borderBottomWidth: 1, borderBottomColor: theme.color.border, backgroundColor: pressed ? theme.collector.surface : undefined })}>
    {icon}
    <View style={{ flex: 1, gap: theme.space[1] }}>
      <Text style={{ ...theme.collector.type.body, color: theme.color.foreground, fontFamily: face(theme) }}>{label}</Text>
      {subtitle ? <Text style={{ ...theme.collector.type.caption, color: theme.color.mutedForeground, fontFamily: face(theme) }}>{subtitle}</Text> : null}
    </View>
    <Text importantForAccessibility="no" style={{ color: theme.color.mutedForeground, ...theme.collector.type.h2 }}>›</Text>
  </Pressable>;
}

export function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.2;
  return (
    <View
      style={{
        flexDirection: stacked ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: stacked ? 'stretch' : 'baseline',
        gap: stacked ? theme.space[1] : theme.space[3],
      }}
    >
      <Text
        style={{
          color: theme.color.mutedForeground,
          fontFamily: face(theme),
          fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
          flexShrink: 1,
          flexBasis: stacked ? undefined : '45%',
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: theme.color.foreground,
          fontFamily: face(theme),
          fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
          fontWeight: theme.fontWeight.medium,
          fontVariant: ['tabular-nums'],
          flexShrink: 1,
          textAlign: stacked ? 'left' : 'right',
          flexBasis: stacked ? undefined : '55%',
        }}
      >
        {value}
      </Text>
    </View>
  );
}


export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'affirmative' | 'destructive';

export function Button({ label, onPress, disabled = false, busy = false, variant = 'primary', onDark = false, accessibilityHint }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean;
  variant?: ButtonVariant; onDark?: boolean; accessibilityHint?: string;
}) {
  const theme = useTheme();
  const c = theme.collector;
  const [focused, setFocused] = useState(false);
  const blocked = disabled || busy;
  const outline = onDark ? c.glow : c.plum;
  const fill = variant === 'primary' ? c.sun : variant === 'affirmative' ? c.green : variant === 'destructive' ? c.red : undefined;
  const ink = variant === 'destructive' ? c.surface : fill ? c.night : outline;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint}
    accessibilityState={{ disabled: blocked, busy }} aria-busy={busy} disabled={blocked} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => ({ backgroundColor: fill, borderWidth: 2,
      borderColor: focused || variant === 'secondary' ? outline : 'transparent',
      borderRadius: c.radius.pill, paddingHorizontal: c.gutter, paddingVertical: theme.space[3],
      minHeight: theme.space[12], minWidth: theme.space[12], maxWidth: '100%',
      flexDirection: 'row', gap: theme.space[2], alignItems: 'center', justifyContent: 'center',
      opacity: blocked ? 0.6 : pressed ? 0.85 : 1 })}>
    {busy ? <ActivityIndicator color={ink} /> : null}
    <Text style={{ ...c.type.body, color: ink, fontFamily: face(theme), fontWeight: '600', textAlign: 'center', flexShrink: 1 }}>{label}</Text>
  </Pressable>;
}


export function Chip({
  label,
  onPress,
  selected = false,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const body = (
    <Text
      style={{
        color: selected ? theme.collector.paper : theme.collector.ink,
        fontFamily: face(theme),
        fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
        fontWeight: theme.fontWeight.medium,
      }}
    >
      {label}
    </Text>
  );
  const box = {
    backgroundColor: selected ? theme.collector.night : theme.collector.surface,
    borderWidth: selected ? 0 : 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2],
    maxWidth: '100%' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };
  if (onPress === undefined) {
    return <View style={{ ...box, paddingVertical: theme.space[1] }}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={theme.space[2]}
      style={({ pressed }) => ({
        ...box,
        minHeight: theme.space[12],
        minWidth: theme.space[12],
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {body}
    </Pressable>
  );
}

/**
 * The one ink block a screen is allowed, and only where a figure carries its
 * own sentence and its own action.
 *
 * Not a hero-metric template: `value` is a figure the server sent, `unit`
 * names what it counts, `sentence` says what it means, and `children` is the
 * action it leads to. A block with no sentence and no action is a big number
 * for decoration and does not belong on any screen here.
 */
export function FeatureBlock({
  value,
  unit,
  label,
  sentence,
  children,
}: {
  value: string;
  unit?: string;
  label: string;
  sentence?: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.stage.ground,
        borderRadius: theme.radius.base,
        padding: theme.space[4],
        gap: theme.space[2],
      }}
    >
      <Text
        style={{
          color: theme.color.stage.mid,
          fontFamily: face(theme),
          fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
        }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: theme.space[2] }}>
        <Text
          style={{
            color: theme.color.stage.fg,
            fontFamily: face(theme),
            fontSize: theme.fontSize['2xl'],
            lineHeight: Math.ceil(theme.fontSize['2xl'] * 1.3),
            fontWeight: theme.fontWeight.display,
            fontVariant: ['tabular-nums'],
            letterSpacing: -1,
            flexShrink: 1,
          }}
        >
          {value}
        </Text>
        {unit === undefined ? null : (
          <Text
            style={{
              color: theme.color.stage.mid,
              fontFamily: face(theme),
              fontSize: theme.fontSize.base,
            lineHeight: Math.ceil(theme.fontSize.base * 1.3),
            }}
          >
            {unit}
          </Text>
        )}
      </View>
      {sentence === undefined ? null : (
        <Text
          style={{
            color: theme.color.stage.mid,
            fontFamily: face(theme),
            fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,

          }}
        >
          {sentence}
        </Text>
      )}
      {children}
    </View>
  );
}


export function Hatch({ text }: { text: string }) {
  const theme = useTheme();
  return <View style={{ padding: theme.space[6], gap: theme.space[3], alignItems: 'center' }}>
    <Text style={{ ...theme.collector.type.body, color: theme.color.mutedForeground, fontFamily: face(theme), textAlign: 'center' }}>{text}</Text>
  </View>;
}

/**
 * The episode ring, at chip size, in the header.
 *
 * It used to be the hero of this screen — a 160dp ring with a six-row legend —
 * and the task-first decision demoted it: the collector opens the app to find
 * work, and how many episodes have been reviewed is a fact they glance at, not
 * the thing they came for. What survives is the fact and the shape: a small
 * lime arc filled to the reviewed fraction, the count and its caption beside
 * it, and one tap to the full list where every episode still carries its own
 * state (APP-24). The arc was bamboo until 2026-09-07; progress is lime now
 * and bamboo is only the stalk Trúc carries. Measured, `lime[600]` reads
 * 3.44:1 on the muted track in light and 3.41:1 in dark, over 1.4.11's 3:1.
 *
 * **`ring` is optional and that is the whole point.** While `api.episodes()`
 * is loading or has failed there is no fraction to draw, so nothing is drawn
 * and the label says which it is. A grey ring at zero would be a measured
 * count the server never gave.
 *
 * SVG-free, like the ring it replaces: each segment is a chord — `stroke`
 * thick radially, one arc-length long tangentially — rotated into place and
 * then pushed out along its own axis. The 30° gap at the top is deliberate;
 * a closed ring reads as a pie chart of a whole and this is a fraction of a
 * list that is still growing, so the track carries the same gap.
 */
export function RingChip({
  ring,
  label,
  face: ringFace,
  onPress,
}: {
  /** Both counts are rows the server returned; the app sums nothing. */
  ring?: { filled: number; total: number };
  label: string;
  /**
   * SPEC §10: the two counts printed inside the arc — `8/13`. Both are rows
   * the server returned and the app divides them only to draw the sweep,
   * which is allowed because a count is neither a currency nor a duration.
   * Never a money fraction: a ring reading 62% beside a money figure gets read
   * as "62% of your pay", which is not a sentence anyone can defend.
   */
  face?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  /**
   * 20dp with nothing in it, 40dp when it carries `face`. Measured on the
   * emulator at 390×844: `8/13` at `fontSize.sm` inside the 20dp ring painted
   * straight over the arc, because the ring was drawn for a chip that had its
   * label beside it and never inside.
   */
  const size = ringFace === undefined ? theme.space[5] : theme.space[10];
  const stroke = theme.space[0.5];
  const segments = 24;
  const sweep = 330;
  const segLen = (Math.PI * (size - stroke) * (sweep / segments)) / 360 + 1;
  const fraction =
    ring === undefined || ring.total <= 0
      ? 0
      : Math.min(1, Math.max(0, ring.filled / ring.total));
  const lit = Math.round(fraction * segments);

  const seat = (i: number) => ({
    position: 'absolute' as const,
    width: segLen,
    height: stroke,
    transform: [
      { rotate: `${180 + (360 - sweep) / 2 + (i + 0.5) * (sweep / segments)}deg` },
      { translateY: (size - stroke) / 2 },
    ],
  });

  const body = (
    <>
      {ring === undefined ? null : (
        <View
          importantForAccessibility="no-hide-descendants"
          style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
        >
          {Array.from({ length: segments }, (_, i) => (
            <View key={`t${i}`} style={[seat(i), { backgroundColor: theme.color.muted }]} />
          ))}
          {Array.from({ length: lit }, (_, i) => (
            <View key={i} style={[seat(i), { backgroundColor: theme.collector.plum }]} />
          ))}
          {ringFace === undefined ? null : (
            <Text
              numberOfLines={1}
              style={{
                color: theme.color.foreground,
                fontFamily: face(theme),
                fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
                fontWeight: theme.fontWeight.bold,
                fontVariant: ['tabular-nums'],
              }}
            >
              {ringFace}
            </Text>
          )}
        </View>
      )}
      <Text
        numberOfLines={1}
        style={{
          color: theme.color.foreground,
          fontFamily: face(theme),
          fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
          fontWeight: theme.fontWeight.medium,
        }}
      >
        {label}
      </Text>
    </>
  );

  const box = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space[2],
    borderWidth: 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space[3],
    minHeight: theme.space[10],
  };

  if (onPress === undefined) return <View style={box}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={theme.space[2]}
      style={({ pressed }) => ({ ...box, opacity: pressed ? 0.85 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/**
 * One option in a set of them — a claimed task, a bound device, a yes/no
 * declaration. Selection is announced (`accessibilityState.selected`) and also
 * drawn as a tick, because "selected" was previously carried by fill and
 * border colour alone and a collector who cannot separate those two colours
 * could not tell which answer they had given on APP-17b.
 */
export function Choice({
  label,
  selected,
  onPress,
  describedBy,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Prefixed to the spoken name when the visible label is not self-describing. */
  describedBy?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={describedBy === undefined ? label : `${describedBy}: ${label}`}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={{
        maxWidth: '100%',
        flexShrink: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        // Lime, not tech: tech is PaXini's mark now. `lime[500]` is a fill and
        // only a fill, so the label on it is the fixed near-black ink the
        // token was measured against — 13.94:1, and it does not move with the
        // scheme because `lime` does not either.
        backgroundColor: selected ? theme.collector.glow : theme.color.surface,
        borderWidth: 1,
        borderColor: selected ? theme.collector.plum : theme.color.borderStrong,
        borderRadius: theme.radius.pill,
        paddingVertical: theme.space[2],
        paddingHorizontal: theme.space[4],
        minHeight: theme.space[12],
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: selected ? theme.color.stage.ground : theme.color.foreground,
          fontFamily: face(theme),
          fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
          fontWeight: selected ? theme.fontWeight.semibold : theme.fontWeight.regular,
          flexShrink: 1,
        }}
      >
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  labelHidden = false,
  value,
  onChangeText,
  secure = false,
  keyboardType,
  editable = true,
}: {
  label: string;
  /**
   * The input is one control inside a labelled group, and the group's label is
   * drawn by the caller.
   *
   * The name still reaches TalkBack — this hides the printed word, never the
   * accessible one. It exists because sign-in's number sits in a row after the
   * country picker: with the label inside the field, it printed 80.17dp right
   * of the margin every other element on that screen is flush with, with
   * nothing at all above the `+84` box. A label belongs over the whole control
   * it names, and the control there is the pair.
   */
  labelHidden?: boolean;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  editable?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: theme.space[1] }}>
      {labelHidden ? null : (
        <Text
          style={{
            color: theme.color.mutedForeground,
            fontFamily: face(theme),
            fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
          }}
        >
          {label}
        </Text>
      )}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        editable={editable}
        accessibilityLabel={label}
        placeholderTextColor={theme.color.faintForeground}
        style={{
          backgroundColor: theme.color.surface,
          // The focus ring is `lime[600]`, as everywhere else in this system.
          // It is drawn as a second border colour rather than an outline
          // because RN has no outline; the width does not change, so nothing
          // reflows.
          borderColor: focused ? theme.collector.plum : theme.color.borderStrong,
          borderWidth: focused ? 2 : 1,
          borderRadius: theme.radius.sm,
          paddingVertical: theme.space[3] - (focused ? 1 : 0),
          paddingHorizontal: theme.space[3] - (focused ? 1 : 0),
          minHeight: theme.space[12],
          color: theme.color.foreground,
          fontFamily: face(theme),
          fontSize: theme.fontSize.base,
            lineHeight: Math.ceil(theme.fontSize.base * 1.3),
        }}
      />
    </View>
  );
}

/**
 * A status pill. Callers pass theme colours, never literals.
 *
 * `mark` is a glyph printed before the label, and it exists for one rule:
 * `DESIGN.md`, "never colour alone — every verdict carries a shape too, because
 * red/green colour blindness is common and this axis decides whether somebody
 * is paid". A pill whose only difference from the pill above it is a hue is a
 * verdict a colour-blind collector cannot read. It is drawn in the same ink as
 * the label and is not spoken: the label already says the state in words, and
 * TalkBack reading "check mark Duyệt đạt" adds nothing.
 *
 * A pill that is not a verdict takes no mark. That the two marked pills on
 * Uploads are exactly the two that decide money is the point, not an
 * inconsistency.
 */
export function Tag({ label, fg, bg, mark }: { label: string; fg: string; bg: string; mark?: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[1],
        backgroundColor: bg,
        borderRadius: theme.radius.pill,
        paddingVertical: theme.space[1],
        paddingHorizontal: theme.space[3],
        alignSelf: 'flex-start',
        maxWidth: '100%',
      }}
    >
      {mark === undefined ? null : (
        <Text
          importantForAccessibility="no"
          style={{ color: fg, fontFamily: face(theme), fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight, fontWeight: theme.fontWeight.semibold }}
        >
          {mark}
        </Text>
      )}
      <Text
        style={{
          color: fg,
          fontFamily: face(theme),
          fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
          fontWeight: theme.fontWeight.semibold,
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * How far along something measured is: a task's claimed minutes, a session's
 * files hashed, a delivery's files sent.
 *
 * The bar is `lime[600]` on the muted track, which is the one job `DESIGN.md`
 * gives that step — "500 fills, 600 strokes, 600 is also progress and the focus
 * ring" — and it is the screen's one lime moment. It is determinate and it does
 * not animate: a bar that eases to a figure is showing a number nobody measured
 * yet, and motion here conveys state or it is not there.
 *
 * **The figure is never the bar alone.** `label` and `value` print above it
 * through `Row`, so the fraction is readable digit for digit and the bar is the
 * shape of it — the same argument `RingChip` makes for the episode ring, and the
 * reason a 6dp band is not left to carry a quantity on its own. `value` is a
 * string because its unit belongs to the caller: minutes on a task, a file count
 * on a delivery.
 */
export function Progress({ label, value, fraction }: { label: string; value: string; fraction: number }) {
  const theme = useTheme();
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return (
    <View style={{ gap: theme.space[2] }}>
      <Row label={label} value={value} />
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
        style={{
          height: theme.space[1.5],
          borderRadius: theme.space[1],
          backgroundColor: theme.color.muted,
          overflow: 'hidden',
        }}
      >
        <View style={{ width: `${clamped * 100}%`, height: '100%', backgroundColor: theme.collector.sun }} />
      </View>
    </View>
  );
}

/**
 * A query is in flight.
 *
 * One component rather than `<Body muted>{tt('common.loading')}</Body>` written
 * out on eight screens, for the reason the sentence needed to be one and was
 * not: it appears *after* something — a mount, a retry, a tab switch — so a
 * screen reader has to be told to read it, the way `Note` is. Every one of
 * those eight copies was silent to TalkBack.
 */
export function Loading({ kind = 'rows' }: { kind?: 'rows' | 'number' | 'body' }) {
  const tt = useT();
  return <View accessibilityLiveRegion="polite" accessibilityLabel={tt('common.loading')} accessibilityState={{ busy: true }} style={{ gap: 12 }}>
    {kind === 'body' ? <Skeleton ratio={4 / 3} /> : null}
    <Skeleton lines={kind === 'number' ? 3 : 2} />
    {kind !== 'number' ? <><Skeleton lines={2} /><Skeleton lines={2} /></> : null}
  </View>;
}


export function Note({ text, tone = 'info', onRetry, busy = false }: {
  text: string; tone?: 'info' | 'error' | 'pending'; onRetry?: () => void; busy?: boolean;
}) {
  const theme = useTheme();
  const tt = useT();
  const c = theme.collector;
  const ink = tone === 'error' ? c.redInk : tone === 'pending' ? c.amberInk : c.ink;
  const fill = tone === 'error' ? c.redBg : tone === 'pending' ? c.amberBg : c.surface;
  return <View accessibilityLiveRegion="polite" style={{ backgroundColor: fill, borderRadius: c.radius.card, padding: c.cardPad, gap: theme.space[3] }}>
    <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
      <Text importantForAccessibility="no" style={{ ...c.type.body, color: ink }}>{tone === 'error' ? '!' : tone === 'pending' ? '…' : 'i'}</Text>
      <Text style={{ ...c.type.body, color: ink, fontFamily: face(theme), flex: 1 }}>{text}</Text>
    </View>
    {onRetry ? <Button label={tt('common.retry')} variant="secondary" busy={busy} onPress={onRetry} /> : null}
  </View>;
}

/**
 * The lifecycle of one thing, as steps down the page — Wise's pattern, with
 * the same rule about weight: only a step that has actually happened is bold,
 * and a step that is still an estimate stays regular and says so.
 *
 * The marker is a shape as well as a colour (a filled disc with a tick for
 * done, a hollow ring for not yet), because this column ends in whether
 * somebody was paid.
 */
export function Timeline({
  steps,
}: {
  steps: { key: string; label: string; done: boolean; current?: boolean; note?: string }[];
}) {
  const theme = useTheme();
  const last = steps.length - 1;
  return (
    <View>
      {steps.map((step, i) => (
        <View key={step.key} style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <View style={{ alignItems: 'center', width: theme.space[6] }}>
            <View
              style={{
                width: theme.space[6],
                height: theme.space[6],
                borderRadius: theme.collector.radius.pill,
                borderWidth: step.done || step.current ? 0 : 1,
                borderColor: theme.color.borderStrong,
                backgroundColor: step.current ? theme.collector.plum : step.done ? theme.color.foreground : theme.color.background,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {step.done ? (
                <Text
                  style={{
                    color: theme.color.background,
                    fontFamily: face(theme),
                    fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,

                  }}
                >
                  ✓
                </Text>
              ) : null}
            </View>
            {i === last ? null : (
              <View
                style={{
                  width: 1,
                  flexGrow: 1,
                  minHeight: theme.space[4],
                  backgroundColor: theme.color.border,
                }}
              />
            )}
          </View>
          <View style={{ flexShrink: 1, paddingBottom: i === last ? 0 : theme.space[3] }}>
            <Text
              style={{
                color: step.done || step.current ? theme.color.foreground : theme.color.mutedForeground,
                fontFamily: face(theme),
                ...theme.collector.type.body,
                fontWeight: step.done || step.current ? theme.fontWeight.semibold : theme.fontWeight.regular,
              }}
            >
              {step.label}
            </Text>
            {step.note === undefined ? null : (
              <Text
                style={{
                  color: theme.color.mutedForeground,
                  fontFamily: face(theme),
                  fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,

                }}
              >
                {step.note}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The two documents, under the primary action.
 *
 * Lifted out of the sign-in screen when the landing needed the same line:
 * one implementation, so the two screens cannot drift into two treatments
 * of the same legal notice.
 *
 * ponytail: the targets are placeholders. There is no privacy policy URL and no
 * data-collection notice URL to open yet — when there is, it arrives the way
 * `LANDING_VIDEO_URL` does, as a build-time value, and `onPress` becomes
 * `Linking.openURL`. They are real controls with a role and a name now so the
 * line is reachable and announced rather than a pair of grey words.
 */
/**
 * `onDark` puts this over the hero film (§2), where the ink it normally takes
 * is invisible. `stage.fg` is the neutral the scrim was measured against, and
 * §2's measurement puts the policy band at 9.79:1 — the most legible of the
 * three text bands on that screen, which is the right way round for the line
 * nobody is looking for.
 */
export function LegalLine({ onDark = false }: { onDark?: boolean } = {}) {
  const theme = useTheme();
  const insets = useInsets();
  const [documentKey, setDocumentKey] = useState<MessageKey | null>(null);
  const tt = useT();
  const ink = onDark ? theme.color.stage.fg : theme.color.foreground;
  const link = (key: MessageKey) => (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={tt(key)}
      onPress={() => setDocumentKey(key)}
      style={{ minHeight: 48, minWidth: 48, justifyContent: 'center' }}
    >
      <Text
        style={{
          // Ink, not tech blue. Tech is PaXini's mark now and `DESIGN.md` says
          // it is never a link; the underline and the `link` role are what
          // make these two words a control, and they were already carrying it.
          // `faintForeground` is the separator beside them, so ink is also
          // what makes the link the more prominent of the two. Measured:
          // 15.78:1 light, 16.12:1 dark, on the page it is drawn on.
          color: ink,
          fontFamily: face(theme),
          fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
          textDecorationLine: 'underline',
        }}
      >
        {tt(key)}
      </Text>
    </Pressable>
  );
  return (
    <><View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space[2],
      }}
    >
      {link('legal.privacy')}
      <Text
        style={{
          color: onDark ? theme.color.stage.mid : theme.color.faintForeground,
          fontFamily: face(theme),
          fontSize: theme.collector.type.caption.fontSize,
          lineHeight: theme.collector.type.caption.lineHeight,
        }}
      >
        ·
      </Text>
      {link('legal.dataNotice')}
    </View>
      <Modal visible={documentKey !== null} animationType="none" onRequestClose={() => setDocumentKey(null)}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: theme.collector.paper,
          paddingHorizontal: theme.collector.gutter, paddingTop: insets.top + theme.space[6],
          paddingBottom: insets.bottom + theme.space[6], gap: theme.space[4] }}>
          <Button label={tt('common.close')} variant="secondary" onPress={() => setDocumentKey(null)} />
          <Title>{documentKey === null ? '' : tt(documentKey)}</Title>
          <Body>{tt('legal.notPublished')}</Body>
        </ScrollView>
      </Modal>
    </>
  );
}

/** Film and code inputs share the same kit as the collector screens. */

/**
 * `#RRGGBB` as its three channels, so a scrim can be written at an alpha
 * without a literal colour anywhere in a screen file.
 *
 * React Native has no `color-mix()` and no CSS gradient, so the one place a
 * token has to be taken apart is here — once, on a value that came from
 * `theme`, rather than at a call site where it would be a hex in a diff.
 */
const channels = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/** Linear interpolation between the stops, which are sorted by position. */
function alphaAt(at: number, stops: readonly (readonly [number, number])[]): number {
  let previous = stops[0] ?? ([0, 0] as const);
  for (const stop of stops) {
    if (at <= stop[0]) {
      const span = stop[0] - previous[0];
      const t = span === 0 ? 0 : (at - previous[0]) / span;
      return previous[1] + (stop[1] - previous[1]) * t;
    }
    previous = stop;
  }
  return previous[1];
}

/**
 * The measured scrim over the hero film (§2), as a stack of flat bands.
 *
 * There is no gradient in React Native core, and §20.1 refuses both modules
 * that would give it one — `expo-linear-gradient` and `react-native-svg` — for
 * a decoration. Forty `flex: 1` bands of one token at rising alpha is the
 * whole of it: no dependency, no fixed heights, and it stretches to any box it
 * is put in. The alpha step between neighbours at the steepest part of the
 * ramp is about 0.016, which is under the 1/255 an 8-bit display can resolve,
 * so there is no visible banding to trade against the forty views.
 *
 * The stops are §2's **measured** ones and they belong to the caller, because
 * they belong to the clip: transparent, then .60 at 55 %, then .88 at 100 %
 * was measured over `pov-portrait.mp4` sampled at 1 fps and cropped to what a
 * 390 dp phone shows, and it puts the headline band at 5.24:1 where the
 * drafted .35/.82 read 3.02:1 and failed AA. **A new film is a new worst
 * frame and re-runs that measurement.**
 *
 * The colour is `discover.ink`, which IS rgb(53,39,31) — the scrim darkens
 * toward the app's own ink rather than toward black, so the bottom of the hero
 * and the top of the next screen are the same warmth.
 */
const SCRIM_BANDS = 40;
export function Scrim({ stops }: { stops: readonly (readonly [number, number])[] }) {
  const theme = useTheme();
  const [r, g, b] = channels(theme.collector.night);
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      {Array.from({ length: SCRIM_BANDS }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            backgroundColor: `rgba(${r},${g},${b},${alphaAt((i + 0.5) / SCRIM_BANDS, stops).toFixed(3)})`,
          }}
        />
      ))}
    </View>
  );
}

/** The poster paints immediately; a slow decoder may arrive later. Errors
 * remove the decoder, including errors after playback has already started. */
function GatedFilm({
  source,
  label,
  contentFit,
  fade,
  onFail,
}: {
  source: string | number;
  label: string;
  contentFit: 'cover' | 'contain';
  fade: number;
  onFail: () => void;
}) {
  const player = useVideoPlayer(source, (p) => {
    p.muted = true;
    p.loop = true;
    p.play();
  });
  const shown = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let done = false;
    const arrive = () => {
      if (done) return;
      done = true;
      Animated.timing(shown, { toValue: 1, duration: fade, useNativeDriver: true }).start();
    };
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') arrive();
      if (status === 'error') onFail();
    });
    if (player.status === 'readyToPlay') arrive();
    if (player.status === 'error') onFail();
    return () => sub.remove();
  }, [player, fade, shown, onFail]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown }]}>
      <VideoView
        player={player}
        contentFit={contentFit}
        nativeControls={false}
        accessibilityLabel={label}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export function Film({
  source,
  poster,
  label,
  contentFit = 'cover',
  fade,
  active = true,
}: {
  active?: boolean;
  source: string | number;
  poster: ImageSourcePropType;
  label: string;
  contentFit?: 'cover' | 'contain';
  fade: number;
}) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  const [lowPower, setLowPower] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    void isLowPowerModeEnabledAsync().then(value => { if (mounted) setLowPower(value); }).catch(() => { if (mounted) setLowPower(false); });
    const power = Platform.OS === 'web' ? null : addLowPowerModeListener(event => setLowPower(event.lowPowerMode));
    const state = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => { mounted = false; power?.remove(); state.remove(); };
  }, []);
  const live = active && foreground && !reduced && !lowPower && !failed;
  return (
    <>
      <Image
        source={poster}
        resizeMode={contentFit}
        accessibilityRole="image"
        accessibilityLabel={label}
        style={StyleSheet.absoluteFill}
      />
      {live ? (
        <GatedFilm source={source} label={label} contentFit={contentFit} fade={fade} onFail={fail} />
      ) : null}
    </>
  );
}

/**
 * The code row (§4): six boxes, one input.
 *
 * The boxes are presentation. A single hidden `TextInput` owns the value, so
 * there is one thing to manage rather than six, and paste, autofill and
 * `oneTimeCode` all work the way the platform already makes them work — six
 * linked inputs get none of that and get a focus-stealing bug each.
 *
 * It is hidden by being transparent and exactly the size of the row, **not**
 * by being an overlay that appears: a tap anywhere on the row lands on the
 * input itself and focuses it, with no second pressable forwarding focus and
 * nothing that can end up at `opacity: 0` and still eating touches (§0.5
 * rule 5, the dead-button bug).
 *
 * `flex: 1` boxes with an `aspectRatio` is the whole responsive story — 44x59
 * at 320 dp, 60x80 at 412 dp, and not one dimension written down.
 *
 * `errorAt` is a counter rather than a boolean, because the same wrong code
 * twice has to shake twice; a boolean that is already true does not change and
 * nothing runs. Reduced motion gets no shake — the error sentence the caller
 * renders is the whole signal then.
 */
export function CodeBoxes({
  length = 6,
  value,
  onChangeText,
  label,
  checking = false,
  errorAt = 0,
  editable = true,
}: {
  length?: number;
  value: string;
  onChangeText: (next: string) => void;
  label: string;
  /** The wait renders inside the last box, never as an overlay (§17). */
  checking?: boolean;
  errorAt?: number;
  editable?: boolean;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const sway = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (errorAt === 0 || reduced) return;
    sway.setValue(0);
    Animated.timing(sway, {
      toValue: 1,
      duration: theme.duration.slow,
      useNativeDriver: true,
    }).start();
  }, [errorAt, reduced, sway, theme.duration.slow]);

  useEffect(() => {
    if (!checking || reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: theme.duration.base, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: theme.duration.base, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [checking, reduced, pulse, theme.duration.base]);

  const dot = theme.space[2];
  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        gap: theme.space[2],
        transform: [
          {
            translateX: sway.interpolate({
              inputRange: [0, 0.15, 0.4, 0.65, 0.85, 1],
              outputRange: [0, -6, 6, -6, 6, 0],
            }),
          },
        ],
      }}
    >
      {Array.from({ length }, (_, i) => {
        const filled = i < value.length;
        const last = i === length - 1;
        return (
          <View
            key={i}
            importantForAccessibility="no-hide-descendants"
            style={{
              flex: 1,
              aspectRatio: 3 / 4,
              borderRadius: theme.radius.base,
              borderWidth: filled ? 2 : 1,
              borderColor: filled ? theme.color.action : theme.color.border,
              backgroundColor: theme.color.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {checking && last ? (
              <Animated.View
                style={{
                  width: dot,
                  height: dot,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.foreground,
                  opacity: pulse,
                }}
              />
            ) : (
              <Text
                style={{
                  color: theme.color.foreground,
                  fontFamily: face(theme),
                  ...theme.collector.type.h1,
                  fontWeight: theme.fontWeight.display,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {value[i] ?? ''}
              </Text>
            )}
          </View>
        );
      })}
      <TextInput
        value={value}
        onChangeText={(next) => onChangeText(next.replace(/[^0-9]/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        editable={editable}
        caretHidden
        autoFocus
        accessibilityLabel={label}
        style={[
          StyleSheet.absoluteFill,
          // Transparent, not invisible: it is the tap target for the whole
          // row and it never stops being one.
          { opacity: 0, color: 'transparent' },
        ]}
      />
    </Animated.View>
  );
}
