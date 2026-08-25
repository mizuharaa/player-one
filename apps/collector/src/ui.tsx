import type { ReactNode } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StatusBar, Text, TextInput, View } from 'react-native';
import { useNav } from './nav.tsx';
import { useT } from './locale.tsx';
import { useTheme } from './theme.tsx';

/**
 * The handful of pieces every screen is made of. All colour, spacing and
 * radius comes from the theme — nativeTheme(scheme) over packages/design
 * tokens — never from a literal in a screen file.
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
function topInset(fallback: number): number {
  if (Platform.OS !== 'android') return fallback;
  return StatusBar.currentHeight ?? fallback;
}

function Header({ title }: { title: string }) {
  const theme = useTheme();
  const nav = useNav();
  const tt = useT();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: theme.space[4],
        paddingTop: topInset(theme.space[6]) + theme.space[3],
        paddingBottom: theme.space[3],
        backgroundColor: theme.color.background,
        borderBottomWidth: 1,
        borderBottomColor: theme.color.border,
      }}
    >
      {nav.canGoBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tt('common.back')}
          onPress={nav.back}
          hitSlop={theme.space[2]}
        >
          <Text style={{ color: theme.color.tech[500], fontSize: theme.fontSize.base }}>
            ← {tt('common.back')}
          </Text>
        </Pressable>
      ) : null}
      <Text
        accessibilityRole="header"
        style={{
          color: theme.color.foreground,
          fontSize: theme.fontSize.lg,
          fontWeight: theme.fontWeight.bold,
          flexShrink: 1,
        }}
      >
        {title}
      </Text>
    </View>
  );
}

/** A screen whose content is bounded: a form, a hub, one record's detail. */
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <Header title={title} />
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[3] }}>
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
  data,
  keyOf,
  renderItem,
  header,
  footer,
  empty,
}: {
  title: string;
  data: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <Header title={title} />
      <FlatList
        data={data as T[]}
        keyExtractor={keyOf}
        renderItem={({ item }) => <>{renderItem(item)}</>}
        ListHeaderComponent={header === undefined ? null : <>{header}</>}
        ListFooterComponent={footer === undefined ? null : <>{footer}</>}
        ListEmptyComponent={empty === undefined ? null : <>{empty}</>}
        contentContainerStyle={{ padding: theme.space[4], gap: theme.space[3] }}
      />
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.card,
        borderColor: theme.color.border,
        borderWidth: 1,
        borderRadius: theme.radius.base,
        padding: theme.space[4],
        gap: theme.space[2],
        elevation: theme.elevation.raised,
      }}
    >
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
    >
      <Card>{children}</Card>
    </Pressable>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: theme.color.foreground,
        fontSize: theme.fontSize.md,
        fontWeight: theme.fontWeight.semibold,
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
        fontSize: theme.fontSize.base,
        lineHeight: theme.fontSize.base * 1.5,
      }}
    >
      {children}
    </Text>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[3] }}>
      <Text style={{ color: theme.color.mutedForeground, fontSize: theme.fontSize.sm }}>{label}</Text>
      <Text
        style={{ color: theme.color.foreground, fontSize: theme.fontSize.sm, flexShrink: 1 }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  kind = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'ghost';
}) {
  const theme = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: disabled
          ? theme.color.muted
          : primary
            ? theme.color.sun[500]
            : theme.color.background,
        borderWidth: primary ? 0 : 1,
        borderColor: theme.color.borderStrong,
        borderRadius: theme.radius.sm,
        paddingVertical: theme.space[3],
        paddingHorizontal: theme.space[4],
        alignItems: 'center',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          // The primary fill is `sun[500]` and the sun ramp does NOT invert
          // between schemes, so the ink on it cannot come from the scheme
          // either. It used to: `background` is white in light mode, and white
          // on #FF7A1A is 2.61:1 — the app's most-tapped control failing AA on
          // the default theme. `stage.ground` is the one dark ink the tokens
          // define identically in both schemes; on sun[500] it measures 7.19:1.
          // Disabled text stays faint (2.62:1) — WCAG 1.4.3 exempts inactive
          // controls, and dimming is how "you cannot press this" is read.
          color: disabled
            ? theme.color.faintForeground
            : primary
              ? theme.color.stage.ground
              : theme.color.foreground,
          fontSize: theme.fontSize.base,
          fontWeight: theme.fontWeight.semibold,
        }}
      >
        {label}
      </Text>
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
        backgroundColor: selected ? theme.color.tech[100] : theme.color.background,
        borderWidth: 1,
        borderColor: selected ? theme.color.tech[500] : theme.color.borderStrong,
        borderRadius: theme.radius.pill,
        paddingVertical: theme.space[2],
        paddingHorizontal: theme.space[4],
      }}
    >
      <Text style={{ color: theme.color.foreground, fontSize: theme.fontSize.sm }}>
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
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[1] }}>
      <Text style={{ color: theme.color.mutedForeground, fontSize: theme.fontSize.sm }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        accessibilityLabel={label}
        style={{
          backgroundColor: theme.color.background,
          borderColor: theme.color.borderStrong,
          borderWidth: 1,
          borderRadius: theme.radius.sm,
          paddingVertical: theme.space[2],
          paddingHorizontal: theme.space[3],
          color: theme.color.foreground,
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
          fontSize: theme.fontSize.xs,
          fontWeight: theme.fontWeight.semibold,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** The machine telling the collector something: tech blue, per the token contract. */
export function Note({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View
      // Notes carry the gates and the failures — "no exam pass, no claim",
      // "bind a device first", a rejected upload's reason. They appear after
      // an action, so a screen reader has to be told to read them.
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: theme.color.tech[50],
        borderRadius: theme.radius.sm,
        padding: theme.space[3],
      }}
    >
      <Text style={{ color: theme.color.tech[700], fontSize: theme.fontSize.sm }}>{text}</Text>
    </View>
  );
}
