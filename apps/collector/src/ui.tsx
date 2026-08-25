import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNav } from './nav.tsx';
import { useT } from './locale.tsx';
import { useTheme } from './theme.tsx';

/**
 * The handful of pieces every screen is made of. All colour, spacing and
 * radius comes from the theme — nativeTheme(scheme) over packages/design
 * tokens — never from a literal in a screen file.
 */

export function Screen({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  const nav = useNav();
  const tt = useT();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          paddingHorizontal: theme.space[4],
          paddingTop: theme.space[12],
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
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[3] }}>
        {children}
      </ScrollView>
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
          color: disabled
            ? theme.color.faintForeground
            : primary
              ? theme.color.background
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
