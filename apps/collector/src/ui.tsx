import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeTheme } from '@playerone/design/native';
import { useNav } from './nav.tsx';
import { useT } from './locale.tsx';
import { useTheme } from './theme.tsx';

/**
 * The handful of pieces every screen is made of. All colour, spacing and
 * radius comes from the theme — nativeTheme(scheme) over packages/design
 * tokens — never from a literal in a screen file.
 *
 * The world these draw, committed 2026-09-07 (`DESIGN.md`): a lavender wash is
 * the page, surfaces above it are glass, the primary action is an ink pill and
 * lime is the one accent — progress, emphasis and the focus ring. Sun and tech
 * are the VNG and PaXini partner marks and appear nowhere in here; bamboo is
 * Trúc's own stalk and nothing else. Still no gradients.
 *
 * `background` is the page and `surface` is the raised step above it, which is
 * the reverse of what these components used to do. A control — a chip, a
 * field, an empty state — paints `surface`; a page paints `background`; a card
 * paints glass over whatever it is standing on.
 */

/**
 * The status-bar inset. `react-native-safe-area-context` is the real answer —
 * it also covers cutouts, the gesture bar and landscape side insets — but it
 * is a native module and nothing here can build one yet (DEVICE_DEPS.md).
 * `StatusBar.currentHeight` is RN core, is the actual measured inset on
 * Android, and is at least not a guess.
 *
 * ponytail: known ceiling — top inset only, Android only. Replace the whole
 * function with `useSafeAreaInsets()` at the first build that has native
 * modules, and verify edge-to-edge on a current Android target then.
 */
export function topInset(fallback: number): number {
  if (Platform.OS !== 'android') return fallback;
  return StatusBar.currentHeight ?? fallback;
}

/**
 * The gesture / navigation bar inset at the bottom, which the tab bar has to
 * clear or its labels sit under the system pill.
 *
 * There is no core API for it. `Dimensions.get('screen').height` counts the
 * whole display and `Dimensions.get('window').height` counts what the app was
 * given, so the difference is the system chrome the app does not own — status
 * bar plus navigation bar. Subtracting the status bar leaves the bottom one.
 * On a gesture-navigation phone that is about 24dp; on a three-button phone
 * about 48dp; and where the numbers disagree (a cutout, a foldable, a
 * simulator) the clamp keeps it inside a sane range instead of pushing the bar
 * off screen.
 *
 * ponytail: measured, not correct. `useSafeAreaInsets().bottom` from
 * `react-native-safe-area-context` is the real answer and needs a native
 * build; swap this whole function for it there, at the same time `topInset`
 * goes. Until then the floor below is what keeps a 48dp target off the pill.
 */
export function bottomInset(floor: number): number {
  if (Platform.OS !== 'android') return floor;
  const screen = Dimensions.get('screen').height;
  const win = Dimensions.get('window').height;
  const chrome = screen - win - (StatusBar.currentHeight ?? 0);
  if (!Number.isFinite(chrome) || chrome <= 0) return floor;
  return Math.min(Math.max(chrome, floor), floor * 3);
}

/**
 * The type face.
 *
 * `theme.font.sans` resolves to `'System'` because no font asset is linked
 * into a native build here (packages/design says so, and says which files to
 * link). Naming Be Vietnam Pro first and the theme's own face second is a
 * family list: React Native on Android cannot find the first name and falls
 * back to the second silently, which is the behaviour we want until the asset
 * is linked; the browser harness, where the woff2 IS loaded, renders the real
 * face and so the screenshots show the typography the design asks for.
 *
 * ponytail: one string, one place. When `react-native.config.js` links
 * `be-vietnam-pro-*.ttf`, `theme.font.sans` becomes `'Be Vietnam Pro'` in
 * packages/design and this helper collapses to it.
 */
export const face = (theme: NativeTheme): string => `Be Vietnam Pro, ${theme.font.sans}`;

/**
 * Does the collector have "remove animations" on? Every authored motion in
 * this app asks first and renders its end state when the answer is yes.
 *
 * One hook rather than a check per component: `isReduceMotionEnabled()` is a
 * promise and the change event needs unsubscribing, and getting either wrong
 * in six places is how one screen keeps moving after the setting is turned on.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (live) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** The floating bar's own height: one 48dp row plus the pill's padding. */
const barHeight = (theme: NativeTheme): number =>
  theme.space[12] + theme.space[3] + theme.space[2];

/**
 * How much room scrolling content must leave under the tab bar.
 *
 * The bar floats now, so this is three things and not one: the gesture-bar
 * inset it is lifted by, the pill itself, and `space[5]` — the amount the
 * raised session button hangs above the pill, which is also the gap the last
 * row of content needs so it does not sit under the glass.
 */
export const tabBarHeight = (theme: NativeTheme): number =>
  bottomInset(theme.space[6]) + barHeight(theme) + theme.space[5];

function Header({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: ReactNode;
  /** Overrides the stack's own Back — the sign-in screen is not a route. */
  onBack?: () => void;
}) {
  const theme = useTheme();
  const nav = useNav();
  const tt = useT();
  const back = onBack ?? (nav.canGoBack ? nav.back : undefined);
  return (
    <View
      style={{
        paddingHorizontal: theme.space[4],
        paddingTop: topInset(theme.space[6]) + theme.space[2],
        paddingBottom: theme.space[3],
        // No rule under it. The page and its header are one lavender ground
        // now, and a hairline across a continuous wash draws a bar where the
        // world has none — the surfaces that float on it are what carry edges.
        backgroundColor: theme.color.background,
        gap: theme.space[1],
      }}
    >
      {back !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tt('common.back')}
          onPress={back}
          hitSlop={theme.space[3]}
          style={{ alignSelf: 'flex-start', minHeight: theme.space[6], justifyContent: 'center' }}
        >
          {/* Ink, not tech blue: tech is PaXini's mark now and is not a link
              colour anywhere in this app. */}
          <Text
            style={{
              color: theme.color.foreground,
              fontFamily: face(theme),
              fontSize: theme.fontSize.sm,
              fontWeight: theme.fontWeight.medium,
            }}
          >
            ← {tt('common.back')}
          </Text>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Text
          accessibilityRole="header"
          style={{
            color: theme.color.foreground,
            fontFamily: face(theme),
            fontSize: theme.fontSize.xl,
            fontWeight: theme.fontWeight.bold,
            letterSpacing: -0.5,
            flexShrink: 1,
            flexGrow: 1,
          }}
        >
          {title}
        </Text>
        {right}
      </View>
    </View>
  );
}

/** A screen whose content is bounded: a form, a hub, one record's detail. */
export function Screen({
  title,
  right,
  onBack,
  children,
}: {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const nav = useNav();
  return (
    // `background` is the page — the lavender wash the glass above it needs.
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <Header title={title} right={right} onBack={onBack} />
      <ScrollView
        contentContainerStyle={{
          padding: theme.space[4],
          paddingBottom: theme.space[4] + (nav.isTabRoot ? tabBarHeight(theme) : 0),
          gap: theme.space[3],
        }}
      >
        {children}
      </ScrollView>
    </View>
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
}: {
  title: string;
  right?: ReactNode;
  data: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
}) {
  const theme = useTheme();
  const nav = useNav();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <Header title={title} right={right} />
      <FlatList
        data={data as T[]}
        keyExtractor={keyOf}
        // Views and not fragments: `VirtualizedList` clones each of these with
        // an `onLayout`, and a fragment cannot take one — which React reports
        // as an invalid-prop error on every render.
        renderItem={({ item }) => <View>{renderItem(item)}</View>}
        ListHeaderComponent={header === undefined ? null : <View>{header}</View>}
        ListFooterComponent={footer === undefined ? null : <View>{footer}</View>}
        ListEmptyComponent={empty === undefined ? null : <View>{empty}</View>}
        contentContainerStyle={{
          padding: theme.space[4],
          paddingBottom: theme.space[4] + (nav.isTabRoot ? tabBarHeight(theme) : 0),
          gap: theme.space[3],
        }}
      />
    </View>
  );
}

/**
 * The glass, as the one thing it actually is.
 *
 * `theme.color.card` laid over whatever the surface is standing on, at
 * `theme.glass.*.fill`. In the light scheme `card` is white, so this is
 * literally the "white overlay" the token describes; in dark it is the
 * scheme's own raised near-black, because a 62% white film over a near-black
 * page is a hole punched into daylight rather than a pane of glass.
 *
 * `theme.glass.*.blur` is deliberately not consumed. React Native has no
 * backdrop blur without a native module and this repo adds none
 * (DEVICE_DEPS.md); what reads as glass is the ground showing through and
 * varying, and the blur only softens it. That is the honest translation the
 * token's own comment asks for.
 *
 * A layer rather than an `rgba()` string, for two reasons: the alpha belongs
 * to the fill and not to the content, so `opacity` on the container — which
 * would fade the type with it — is wrong; and mixing a colour in a `.tsx` is
 * how a value that the console cannot have gets invented. The parent clips it,
 * so the parent owns `borderRadius` and `overflow: 'hidden'`, and the parent
 * must draw it before whatever sits on top of it.
 *
 * Exported because Home's hero is a photograph with a glass strip under it,
 * which is neither a `Card` nor a `GlassBar` but is made of the same material.
 */
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
      <Frost fill={theme.glass.card.fill} />
      {children}
    </View>
  );
}

/**
 * The floating navigation bar's surface, and the only place in this app where
 * the ground behind glass genuinely varies.
 *
 * It takes `glass.bar.fill` rather than `glass.card.fill` for the reason the
 * token has two weights at all: a card sits on the page and knows what is
 * behind it, and this passes over whatever is being scrolled. Measured at the
 * two extremes of what can pass under it in the light scheme — a near-black
 * photograph composites the bar to #C7C7C7, a white one to #FFFFFF — where
 * `foreground` reads 10.78:1 and 18.23:1.
 *
 * It lives here and not in `shell/TabBar.tsx` because the frost layer is
 * private to this file, and because the bar's height is the number
 * `tabBarHeight` has to agree with.
 */
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
        backgroundColor: pressed ? theme.color.muted : undefined,
        borderColor: pressed ? theme.color.borderStrong : theme.color.border,
      })}
    >
      {({ pressed }) => (
        <>
          {pressed ? null : <Frost fill={theme.glass.card.fill} />}
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
        fontSize: theme.fontSize.md,
        fontWeight: theme.fontWeight.semibold,
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

/**
 * A label/value line. `value` sits in tabular figures so a column of them —
 * sizes on Uploads, minutes and amounts on Income — lines up digit for digit.
 */
export function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: theme.space[3],
      }}
    >
      <Text
        style={{
          color: theme.color.mutedForeground,
          fontFamily: face(theme),
          fontSize: theme.fontSize.sm,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: theme.color.foreground,
          fontFamily: face(theme),
          fontSize: theme.fontSize.sm,
          fontWeight: theme.fontWeight.medium,
          fontVariant: ['tabular-nums'],
          flexShrink: 1,
          textAlign: 'right',
        }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * The one button.
 *
 * Three variants, every state declared rather than left to whatever a
 * `Pressable` does by default: default, pressed, disabled and focused all pick
 * their own colours here, and no screen writes a button style of its own.
 * Shadcn's anatomy in React Native terms — the variant decides the surface and
 * the height, and it is a prop rather than a copy of the component.
 *
 * The metrics are the welcome-screen standard (Substack, Noom, NordVPN on
 * Mobbin): full width of whatever column it is in, 56dp tall, pill radius, a
 * 17sp semibold label. Stacked pairs sit 12dp apart, which is the column's
 * gap and not this component's business.
 *
 * - **primary** — the **ink pill**: `action` fill, `actionInk` label, both of
 *   which invert with the scheme. It is not sun any more and sun is not an
 *   action colour anywhere in this app. Muted fill with faint ink when
 *   disabled. One per screen; it is the thing the screen is for.
 * - **secondary** — a **glass pill**: the same frost a card is made of, with a
 *   hairline edge and ink type, so the alternative reads as genuinely
 *   available rather than as a demotion. On footage (`onDark`) it stays a
 *   white outline with no frost — a 62% white film over a recording is a
 *   white blink, not glass.
 * - **ghost** — the word alone, for a way out: cancel, later, close. 48dp
 *   rather than 56 because it is not a commitment, and 48 is Android's floor
 *   for a target.
 *
 * The focus ring is drawn as a border colour on a border that is always there,
 * so gaining focus never reflows the row. React Native has no outline and no
 * `:focus-visible`; `onFocus`/`onBlur` is what the platform gives.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function Button({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  onDark = false,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  /** Sitting on footage or on the ink block: the outline and the type go white. */
  onDark?: boolean;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  // The ink the outline and the ghost label are drawn in. `stage.fg` and
  // `stage.ground` are the two neutrals the tokens define identically in both
  // schemes, which is what a control over footage needs: the video does not
  // get lighter because the phone is in dark mode.
  const ink = onDark ? theme.color.stage.fg : theme.color.foreground;
  const primary = variant === 'primary';
  const secondary = variant === 'secondary';
  /**
   * The ring is `lime[600]` — the focus ring the world committed, and the same
   * step `packages/design/src/tokens.ts` resolves `ring.light` to. Measured on
   * every ground it can land on here: 3.71:1 on the light page, 4.39:1 on the
   * dark one, 4.26:1 and 3.67:1 on the two ink pills, all over SC 1.4.11's
   * 3:1. On footage it stays the stage ink, because the film behind it is not
   * a ground this file can measure.
   */
  const ring = onDark ? theme.color.stage.fg : theme.color.lime[600];

  /**
   * The frost weight the secondary is filled with, or `undefined` where the
   * control paints its own opaque fill instead. `null` means no glass at all.
   */
  const frost = secondary && !onDark && !disabled ? theme.glass.card.fill : null;

  const surface = (pressed: boolean): string | undefined => {
    if (primary) {
      if (disabled) return theme.color.muted;
      return theme.color.action;
    }
    if (!pressed || disabled) return undefined;
    // `muted` is a pale lavender tint and flashing it over footage would be a
    // white blink; `stage.panel` is the same step of the ink scale.
    return onDark ? theme.color.stage.panel : theme.color.muted;
  };

  const labelColor = disabled
    ? // WCAG 1.4.3 exempts inactive controls, and dimming is how "you cannot
      // press this" is read. On footage there is no faint neutral that stays
      // legible, so a disabled control there dims the stage ink instead.
      onDark
      ? theme.color.stage.mid
      : theme.color.faintForeground
    : // `actionInk` is the pair of `action` and both invert with the scheme, so
      // the label can never be the 2.61:1 white-on-sun this control shipped as
      // once. Measured now: 15.78:1 light, 16.12:1 dark.
      primary
      ? theme.color.actionInk
      : ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: surface(pressed),
        // Constant width, colour-only change: a ring that appears by growing
        // the border pushes every sibling in the row by 2dp.
        borderWidth: secondary ? 1.5 : 2,
        borderColor: focused
          ? ring
          : secondary
            ? disabled
              ? theme.color.borderStrong
              : onDark
                ? ink
                : // A glass pill takes the system's hairline, not a full-weight
                  // ink outline: the frost is what makes it a surface and an
                  // ink edge around it reads as a second primary.
                  theme.color.borderStrong
            : 'transparent',
        borderRadius: theme.radius.pill,
        paddingHorizontal: theme.space[5],
        minHeight: variant === 'ghost' ? theme.space[12] : theme.space[12] + theme.space[2],
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        opacity: pressed && primary ? 0.85 : 1,
      })}
    >
      {({ pressed }) => (
        <>
          {frost === null || pressed ? null : <Frost fill={frost} />}
          <Text
            numberOfLines={1}
            style={{
              color: labelColor,
              fontFamily: face(theme),
              fontSize: theme.fontSize.md,
              fontWeight: theme.fontWeight.semibold,
            }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * A small pill. Static by default; give it `onPress` and it becomes a control
 * with a 48dp target and a `selected` state.
 *
 * `selected` is the ink pill, the same mark the primary button and the active
 * tab carry: it is where the collector's action is. Unselected sits on
 * `surface`, the raised step, because the page is the lavender wash now and a
 * chip painted in the page colour is a chip with only a border. Nothing
 * decorative is a chip.
 */
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
        color: selected ? theme.color.actionInk : theme.color.foreground,
        fontFamily: face(theme),
        fontSize: theme.fontSize.sm,
        fontWeight: theme.fontWeight.medium,
      }}
    >
      {label}
    </Text>
  );
  const box = {
    backgroundColor: selected ? theme.color.action : theme.color.surface,
    borderWidth: selected ? 0 : 1,
    borderColor: theme.color.borderStrong,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space[3],
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
        minHeight: theme.space[10],
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
          fontSize: theme.fontSize.sm,
        }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
        <Text
          style={{
            color: theme.color.stage.fg,
            fontFamily: face(theme),
            fontSize: theme.fontSize['2xl'],
            fontWeight: theme.fontWeight.display,
            fontVariant: ['tabular-nums'],
            letterSpacing: -1,
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
            fontSize: theme.fontSize.sm,
            lineHeight: theme.fontSize.sm * 1.5,
          }}
        >
          {sentence}
        </Text>
      )}
      {children}
    </View>
  );
}

/**
 * The empty state. Diagonal hatching rather than an illustration or a shrug:
 * it says "this area exists and has nothing in it yet" without pretending
 * something failed, and it is built from Views because no image asset ships in
 * this app.
 */
export function Hatch({ text }: { text: string }) {
  const theme = useTheme();
  const stripes = 14;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.color.border,
        borderRadius: theme.radius.lg,
        // `surface`, not `background`: the page IS `background` now, and an
        // empty state painted in the page colour is a border round nothing.
        backgroundColor: theme.color.surface,
        overflow: 'hidden',
        padding: theme.space[6],
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: theme.space[20],
      }}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {Array.from({ length: stripes }, (_, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              top: -theme.space[20],
              left: i * theme.space[8] - theme.space[16],
              width: 1,
              height: theme.space[20] * 3,
              backgroundColor: theme.color.border,
              transform: [{ rotate: '35deg' }],
            }}
          />
        ))}
      </View>
      <View
        style={{
          backgroundColor: theme.color.surface,
          paddingHorizontal: theme.space[3],
          paddingVertical: theme.space[2],
        }}
      >
        <Text
          style={{
            color: theme.color.mutedForeground,
            fontFamily: face(theme),
            fontSize: theme.fontSize.sm,
            textAlign: 'center',
          }}
        >
          {text}
        </Text>
      </View>
    </View>
  );
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
  onPress,
}: {
  /** Both counts are rows the server returned; the app sums nothing. */
  ring?: { filled: number; total: number };
  label: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const size = theme.space[5];
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
            <View key={i} style={[seat(i), { backgroundColor: theme.color.lime[600] }]} />
          ))}
        </View>
      )}
      <Text
        numberOfLines={1}
        style={{
          color: theme.color.foreground,
          fontFamily: face(theme),
          fontSize: theme.fontSize.sm,
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
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Prefixed to the spoken name when the visible label is not self-describing. */
  describedBy?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={describedBy === undefined ? label : `${describedBy}: ${label}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        // Lime, not tech: tech is PaXini's mark now. `lime[500]` is a fill and
        // only a fill, so the label on it is the fixed near-black ink the
        // token was measured against — 13.94:1, and it does not move with the
        // scheme because `lime` does not either.
        backgroundColor: selected ? theme.color.lime[500] : theme.color.surface,
        borderWidth: 1,
        borderColor: selected ? theme.color.lime[600] : theme.color.borderStrong,
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
          fontSize: theme.fontSize.sm,
          fontWeight: selected ? theme.fontWeight.semibold : theme.fontWeight.regular,
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
  value,
  onChangeText,
  secure = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: theme.space[1] }}>
      <Text
        style={{
          color: theme.color.mutedForeground,
          fontFamily: face(theme),
          fontSize: theme.fontSize.sm,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        accessibilityLabel={label}
        placeholderTextColor={theme.color.faintForeground}
        style={{
          backgroundColor: theme.color.surface,
          // The focus ring is `lime[600]`, as everywhere else in this system.
          // It is drawn as a second border colour rather than an outline
          // because RN has no outline; the width does not change, so nothing
          // reflows.
          borderColor: focused ? theme.color.lime[600] : theme.color.borderStrong,
          borderWidth: focused ? 2 : 1,
          borderRadius: theme.radius.sm,
          paddingVertical: theme.space[3] - (focused ? 1 : 0),
          paddingHorizontal: theme.space[3] - (focused ? 1 : 0),
          minHeight: theme.space[12],
          color: theme.color.foreground,
          fontFamily: face(theme),
          fontSize: theme.fontSize.base,
        }}
      />
    </View>
  );
}

/** A status pill. Callers pass theme colours, never literals. */
export function Tag({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: theme.radius.pill,
        paddingVertical: theme.space[1],
        paddingHorizontal: theme.space[3],
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          color: fg,
          fontFamily: face(theme),
          fontSize: theme.fontSize.xs,
          fontWeight: theme.fontWeight.semibold,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * The machine telling the collector something.
 *
 * It was a tech-blue tint, and tech is PaXini's partner mark now — not a
 * system colour and not a notice colour. So the notice is drawn in the
 * neutral one step off the page: `muted`, which inverts with the scheme the
 * way the tint it replaces did. Measured, `foreground` on it reads 14.66:1 in
 * light and 12.54:1 in dark. Nothing about which sentences go in here changed
 * — it still carries the gates and the failures, and it still announces.
 */
export function Note({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View
      // Notes carry the gates and the failures — "no exam pass, no claim",
      // "bind a device first", a rejected upload's reason. They appear after
      // an action, so a screen reader has to be told to read them.
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: theme.color.muted,
        borderRadius: theme.radius.base,
        padding: theme.space[3],
      }}
    >
      <Text
        style={{
          color: theme.color.foreground,
          fontFamily: face(theme),
          fontSize: theme.fontSize.sm,
          lineHeight: theme.fontSize.sm * 1.5,
        }}
      >
        {text}
      </Text>
    </View>
  );
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
  steps: { key: string; label: string; done: boolean; note?: string }[];
}) {
  const theme = useTheme();
  const last = steps.length - 1;
  return (
    <View>
      {steps.map((step, i) => (
        <View key={step.key} style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <View style={{ alignItems: 'center', width: theme.space[4] }}>
            <View
              style={{
                width: theme.space[4],
                height: theme.space[4],
                borderRadius: theme.space[2],
                borderWidth: step.done ? 0 : 1,
                borderColor: theme.color.borderStrong,
                backgroundColor: step.done ? theme.color.foreground : theme.color.background,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {step.done ? (
                <Text
                  style={{
                    color: theme.color.background,
                    fontFamily: face(theme),
                    fontSize: theme.fontSize.xs,
                    lineHeight: theme.fontSize.xs + 2,
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
                color: step.done ? theme.color.foreground : theme.color.mutedForeground,
                fontFamily: face(theme),
                fontSize: theme.fontSize.base,
                fontWeight: step.done ? theme.fontWeight.semibold : theme.fontWeight.regular,
              }}
            >
              {step.label}
            </Text>
            {step.note === undefined ? null : (
              <Text
                style={{
                  color: theme.color.mutedForeground,
                  fontFamily: face(theme),
                  fontSize: theme.fontSize.sm,
                  lineHeight: theme.fontSize.sm * 1.5,
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
