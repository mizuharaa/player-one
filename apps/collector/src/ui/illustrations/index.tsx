import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { face } from '../../ui.tsx';
import { useTheme } from '../../theme.tsx';

/**
 * The app's drawings, as one family.
 *
 * Work order §5: two-colour flat — plum fills, one sun accent, ink line at one
 * stroke weight — geometric and simple. The family rule is the whole point:
 * thirteen pictures drawn by thirteen different hands read as clip art, and
 * §2's anti-slop law names illustrations sharing one stroke weight as a
 * requirement rather than a preference. So there is one `Frame`, one `STROKE`,
 * and every drawing below is shapes inside that frame.
 *
 * **They are decorative and they say so.** Each one sits beside a headline
 * that carries the meaning in words, so `Frame` hides the whole subtree from
 * TalkBack. A drawing that announced "illustration" would add a stop to the
 * focus order and no information.
 *
 * ponytail: `react-native-svg` (already a dependency, DEVICE_DEPS.md) and no
 * PNGs. A flat two-colour shape at any size is what a vector is for, and an
 * exported raster would need three densities per drawing and would still be
 * the wrong ink in a future theme.
 */

/** One weight, every drawing. 64-unit viewBox, so 2 is a 3% line. */
const STROKE = 2;
const BOX = 64;

function Frame({ size, children }: { size: number; children: ReactNode }) {
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>{children}</Svg>
    </View>
  );
}

/** The three colours, read off `theme.collector` rather than written as hex. */
function usePalette() {
  const c = useTheme().collector;
  return { plum: c.plum, sun: c.sun, ink: c.ink, paper: c.paper, surface: c.surface };
}

export type IllustrationProps = { size?: number };

/* ── Onboarding, three cards (work order §4.1) ─────────────────────────── */

/** Card 1 — the work is listed, and you pick it. */
export function FindWork({ size = 160 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Rect x={6} y={10} width={34} height={26} rx={4} fill={plum} />
      <Rect x={6} y={10} width={34} height={26} rx={4} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Rect x={12} y={40} width={22} height={4} rx={2} fill={ink} />
      <Rect x={12} y={48} width={14} height={4} rx={2} fill={ink} opacity={0.4} />
      <Circle cx={44} cy={38} r={13} fill={sun} />
      <Circle cx={44} cy={38} r={13} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Line x1={53} y1={47} x2={60} y2={54} stroke={ink} strokeWidth={STROKE} strokeLinecap="round" />
    </Frame>
  );
}

/**
 * Card 2 — you wear the camera; the camera records.
 *
 * No button, no shutter, no red dot: the app never starts or stops a recording
 * (CLAUDE.md) and a drawing that implied otherwise would be teaching the wrong
 * thing on the second screen a collector ever sees.
 */
export function WearCamera({ size = 160 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Circle cx={32} cy={30} r={18} fill={plum} />
      <Circle cx={32} cy={30} r={18} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Rect x={10} y={22} width={44} height={9} rx={4.5} fill={sun} />
      <Rect x={10} y={22} width={44} height={9} rx={4.5} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Circle cx={44} cy={26.5} r={3} fill={ink} />
      <Path d="M20 52c3-6 7-9 12-9s9 3 12 9" stroke={ink} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
    </Frame>
  );
}

/** Card 3 — a reviewer judges the footage, and the platform pays. */
export function ReviewedThenPaid({ size = 160 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Rect x={8} y={38} width={48} height={8} rx={4} fill={plum} />
      <Rect x={8} y={38} width={48} height={8} rx={4} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Rect x={14} y={48} width={36} height={8} rx={4} fill={plum} opacity={0.5} />
      <Rect x={14} y={48} width={36} height={8} rx={4} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Circle cx={32} cy={20} r={14} fill={sun} />
      <Circle cx={32} cy={20} r={14} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Path d="M26 20l4 4 8-8" stroke={ink} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Frame>
  );
}

/* ── How to record, four steps (consumed by the collecting flow) ────────── */

/** Step 1 — charge the camera and the card is in it. */
export function HowCharge({ size = 120 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Rect x={8} y={20} width={40} height={24} rx={5} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Rect x={12} y={24} width={22} height={16} rx={3} fill={plum} />
      <Rect x={50} y={27} width={6} height={10} rx={2} fill={ink} />
      <Path d="M40 22l-6 10h5l-4 10 10-13h-5z" fill={sun} stroke={ink} strokeWidth={STROKE} strokeLinejoin="round" />
    </Frame>
  );
}

/** Step 2 — wear it level, lens forward. */
export function HowWear({ size = 120 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Circle cx={30} cy={34} r={16} fill={plum} />
      <Circle cx={30} cy={34} r={16} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Rect x={10} y={26} width={40} height={8} rx={4} fill={sun} />
      <Rect x={10} y={26} width={40} height={8} rx={4} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Line x1={52} y1={30} x2={60} y2={30} stroke={ink} strokeWidth={STROKE} strokeLinecap="round" />
    </Frame>
  );
}

/** Step 3 — the camera's own buttons start and stop it. Ours never do. */
export function HowPressDevice({ size = 120 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Rect x={10} y={22} width={44} height={20} rx={6} fill={plum} />
      <Rect x={10} y={22} width={44} height={20} rx={6} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Circle cx={24} cy={32} r={5} fill={sun} />
      <Circle cx={24} cy={32} r={5} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Path d="M40 46c0-6 3-9 6-9s6 3 6 9" stroke={ink} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
      <Line x1={40} y1={32} x2={46} y2={32} stroke={ink} strokeWidth={STROKE} strokeLinecap="round" />
    </Frame>
  );
}

/** Step 4 — the card goes to the desk, and nothing is deleted. */
export function HowHandOver({ size = 120 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Rect x={16} y={12} width={26} height={20} rx={3} fill={plum} />
      <Rect x={16} y={12} width={26} height={20} rx={3} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Rect x={22} y={12} width={6} height={7} rx={1} fill={sun} />
      <Path d="M12 44c6-6 12-6 20-6h14" stroke={ink} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
      <Path d="M40 38l6 6-6 6" stroke={ink} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Frame>
  );
}

/* ── Empty states, four (copy `08-empty-states`) ────────────────────────── */

/** No task matches the filters, or the hall itself is empty. */
export function EmptyTasks({ size = 120 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Rect x={8} y={14} width={22} height={18} rx={3} fill={plum} />
      <Rect x={8} y={14} width={22} height={18} rx={3} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Rect x={34} y={14} width={22} height={18} rx={3} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Rect x={8} y={38} width={22} height={18} rx={3} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Circle cx={45} cy={47} r={9} fill={sun} />
      <Circle cx={45} cy={47} r={9} stroke={ink} strokeWidth={STROKE} fill="none" />
    </Frame>
  );
}

/** No session yet. */
export function EmptySessions({ size = 120 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Circle cx={32} cy={32} r={20} fill={plum} />
      <Circle cx={32} cy={32} r={20} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Line x1={32} y1={32} x2={32} y2={20} stroke={ink} strokeWidth={STROKE} strokeLinecap="round" />
      <Line x1={32} y1={32} x2={42} y2={36} stroke={ink} strokeWidth={STROKE} strokeLinecap="round" />
      <Circle cx={32} cy={32} r={3} fill={sun} />
    </Frame>
  );
}

/** Nothing waiting to be delivered. */
export function EmptyUploads({ size = 120 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Rect x={12} y={30} width={40} height={24} rx={4} fill={plum} />
      <Rect x={12} y={30} width={40} height={24} rx={4} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Rect x={26} y={30} width={12} height={8} rx={2} fill={sun} />
      <Path d="M32 24V8m-7 7l7-7 7 7" stroke={ink} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Frame>
  );
}

/** No money in this cycle yet. */
export function EmptyIncome({ size = 120 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Rect x={8} y={20} width={48} height={30} rx={5} fill={plum} />
      <Rect x={8} y={20} width={48} height={30} rx={5} stroke={ink} strokeWidth={STROKE} fill="none" />
      <Path d="M8 28h40a4 4 0 014 4v6a4 4 0 01-4 4H8" stroke={ink} strokeWidth={STROKE} fill="none" />
      <Circle cx={44} cy={35} r={5} fill={sun} />
      <Circle cx={44} cy={35} r={5} stroke={ink} strokeWidth={STROKE} fill="none" />
    </Frame>
  );
}

/* ── Two marks that are not scenes ──────────────────────────────────────── */

/**
 * The default avatar: initials on plum, inside a sun ring (klarna-316/317).
 *
 * Not a photograph and not a placeholder person. A picker from the gallery is
 * post-demo (work order §1, "Not built"), so this IS the collector's picture
 * everywhere the app shows one, and it has to stay legible at dock size.
 *
 * `initials` is derived by the caller from the name the server sent; an empty
 * name gives an empty circle rather than a guessed letter.
 */
export function AvatarMark({ initials, size = 72 }: { initials: string; size?: number }) {
  const theme = useTheme();
  const { plum, sun, surface } = usePalette();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: plum,
        borderWidth: Math.max(2, size / 24),
        borderColor: sun,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: surface,
          fontFamily: face(theme),
          // Scales with the circle, not with the collector's font setting: this
          // is a mark at a fixed size, and one that grew would break the dock.
          fontSize: size * 0.36,
          lineHeight: size * 0.46,
          fontWeight: theme.fontWeight.display,
        }}
        allowFontScaling={false}
      >
        {initials}
      </Text>
    </View>
  );
}

/** Something is broken and the sentence beside it says what. */
export function ErrorMark({ size = 120 }: IllustrationProps) {
  const { plum, sun, ink } = usePalette();
  return (
    <Frame size={size}>
      <Circle cx={32} cy={32} r={20} fill={plum} opacity={0.25} />
      <Circle cx={32} cy={32} r={20} stroke={ink} strokeWidth={STROKE} strokeDasharray="6 5" fill="none" />
      <Path d="M32 16l16 28H16z" fill={sun} stroke={ink} strokeWidth={STROKE} strokeLinejoin="round" />
      <Line x1={32} y1={27} x2={32} y2={35} stroke={ink} strokeWidth={STROKE} strokeLinecap="round" />
      <Circle cx={32} cy={39.5} r={1.6} fill={ink} />
    </Frame>
  );
}

/** The collector's initials, for `AvatarMark`. At most two, upper case. */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => [...part][0] ?? '')
    .join('')
    .toLocaleUpperCase();
