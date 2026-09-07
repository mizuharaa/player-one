import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from './theme.tsx';

/**
 * The app's icons, authored out of Views.
 *
 * No icon library ships here. Half of these — a bound camera, an episode
 * awaiting a human — no library draws anyway, and mixing an authored mark with
 * a borrowed chevron is how an icon set stops looking like one. The console
 * makes the same argument for the same reason (`components/icons.tsx`); it can
 * use SVG paths and this app cannot, so these are rectangles and circles on a
 * 20-unit grid, at one stroke weight, in `currentColor` style: the caller
 * passes the colour, always from the theme.
 *
 * They are decorations beside a label, never the only carrier of meaning: every
 * one of them sits under its own word in the tab bar.
 */

const UNIT = 20;

function useGrid(size: number, color: string) {
  const k = size / UNIT;
  const p = (v: number) => v * k;
  const bar = (x: number, y: number, w: number, h: number, r = 1) => ({
    position: 'absolute' as const,
    left: p(x),
    top: p(y),
    width: p(w),
    height: p(h),
    borderRadius: p(r),
    backgroundColor: color,
  });
  return { p, bar };
}

function Frame({ size, children }: { size: number; children: ReactNode }) {
  return <View style={{ width: size, height: size }}>{children}</View>;
}

/**
 * A roof over a doorway.
 *
 * The roof is a real triangle — three transparent borders and one coloured
 * one, the only way React Native core draws a non-rectangle. A rotated square
 * was the first version and read as an arch, because the body rectangle hides
 * exactly the half of it that says "roof".
 */
export function GlyphHome({ size = 22, color }: { size?: number; color: string }) {
  const { p, bar } = useGrid(size, color);
  return (
    <Frame size={size}>
      <View
        style={{
          position: 'absolute',
          left: p(1.5),
          top: p(3),
          width: 0,
          height: 0,
          borderLeftWidth: p(8.5),
          borderRightWidth: p(8.5),
          borderBottomWidth: p(7),
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: 'transparent',
          borderBottomColor: color,
        }}
      />
      <View style={bar(4, 10, 12, 7, 1)} />
      <View style={bar(8.4, 12.5, 3.2, 4.5, 0.6)} />
    </Frame>
  );
}

/** A list: three rules, the first one long. */
export function GlyphTasks({ size = 22, color }: { size?: number; color: string }) {
  const { bar } = useGrid(size, color);
  return (
    <Frame size={size}>
      <View style={bar(3, 4.5, 14, 2.2, 1.1)} />
      <View style={bar(3, 9, 14, 2.2, 1.1)} />
      <View style={bar(3, 13.5, 9, 2.2, 1.1)} />
    </Frame>
  );
}

/** A ring with a dot: a session is a binding, not a record button. */
export function GlyphSession({ size = 22, color }: { size?: number; color: string }) {
  const { p, bar } = useGrid(size, color);
  return (
    <Frame size={size}>
      <View
        style={[
          bar(2.5, 2.5, 15, 15, 7.5),
          { backgroundColor: 'transparent', borderWidth: p(1.9), borderColor: color },
        ]}
      />
      <View style={bar(7.5, 7.5, 5, 5, 2.5)} />
    </Frame>
  );
}

/** An arrow out of a tray. */
export function GlyphUploads({ size = 22, color }: { size?: number; color: string }) {
  const { bar } = useGrid(size, color);
  return (
    <Frame size={size}>
      {/* The shaft. */}
      <View style={bar(8.9, 3, 2.2, 9.5, 1.1)} />
      {/* Two arms of the head, each rotated about its own centre — no
          `transformOrigin`, which React Native only learned recently and
          react-native-web does not map. */}
      <View style={[bar(5.15, 4.4, 5.7, 2.2, 1.1), { transform: [{ rotate: '-45deg' }] }]} />
      <View style={[bar(9.15, 4.4, 5.7, 2.2, 1.1), { transform: [{ rotate: '45deg' }] }]} />
      {/* The tray it leaves. */}
      <View style={bar(3, 14.8, 14, 2.2, 1.1)} />
      <View style={bar(3, 11.5, 2.2, 4, 1.1)} />
      <View style={bar(14.8, 11.5, 2.2, 4, 1.1)} />
    </Frame>
  );
}

/** Three columns of a chart: the income line, per episode. */
export function GlyphIncome({ size = 22, color }: { size?: number; color: string }) {
  const { bar } = useGrid(size, color);
  return (
    <Frame size={size}>
      <View style={bar(3, 11, 3.4, 6, 1.2)} />
      <View style={bar(8.3, 7, 3.4, 10, 1.2)} />
      <View style={bar(13.6, 3, 3.4, 14, 1.2)} />
    </Frame>
  );
}

/**
 * A play triangle, for the landing's video slot.
 *
 * A triangle in React Native is a View with three transparent borders and one
 * coloured one — the same trick the web has used since before CSS could draw
 * shapes, and the only one RN core offers.
 */
export function GlyphPlay({ size = 28, color }: { size?: number; color: string }) {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderTopWidth: size / 2,
        borderBottomWidth: size / 2,
        borderLeftWidth: size * 0.86,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderRightColor: 'transparent',
        borderLeftColor: color,
      }}
    />
  );
}

/** A hairline rule, used to separate a group from what follows it. */
export function Rule() {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.color.border }} />;
}
