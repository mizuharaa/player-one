/**
 * Trúc.
 *
 * `trúc` is Vietnamese for bamboo and 竹 is the same plant in Chinese, so both
 * partners already have a word for him — the same test Cú the owl passed, and
 * the reason he is a panda and not a robot. He replaces her; the owl artwork is
 * gone and `Cu.tsx` is now an alias so nothing that still imports it breaks.
 *
 * He also does the job the owl did. A panda is the animal that sits still and
 * pays attention to one thing for a very long time, which is what a reviewer
 * does for eight hours; and bamboo is what a progress ring is drawn in here, so
 * the mascot and the measure share a colour and a name.
 *
 * **He is driven by the clock, not by a mood picker.** Upload centres run
 * shifts and reviewers work nights, so he reads `getHours()` through
 * `mascotStateAt` in the design package — the same function the collector app
 * calls, so the two surfaces are never in different states at the same moment.
 * Four states, no setting, no surprise. The state names are unchanged from the
 * owl, `nightOwl` included: `cú đêm` and 夜猫子 are the idioms the shift is
 * named after, and renaming a boundary breaks every stored preference for
 * nothing.
 *
 * **He never appears on the review screen.** Nothing cartoon goes next to
 * footage somebody is paid or not paid on. His homes are the shift gauge, the
 * empty state, the loading state, the sign-in panel and the guided tour.
 *
 * **Six fills, flat, no gradients**, listed in `FILL` below with what each one
 * is for. They are written as literals here and nowhere else in the console,
 * for the same reason the owl's were: this artwork ships again as an
 * `react-native-svg` component in the collector app, where `var()` does not
 * exist. Four of the six are values that also exist in `tokens.ts`
 * (`stage.ground`, `light.muted`, `bamboo[500]`, `bamboo[600]`) and are the
 * same colour on purpose — the panda is drawn out of the palette, not beside
 * it.
 *
 * Drawn from the turnaround sheet in `.impeccable/mascot/`: head wider than the
 * body, round solid ears, tilted eye patches, a small closed smile, black arms
 * and legs against a white face and belly, and a lime stalk held in one paw.
 */
import { mascotStateAt, type MascotState } from '@playerone/design/tokens';

/**
 * The whole palette. Six values, and each one is named by its job rather than
 * by its colour so that a seventh cannot be added without saying what it is
 * for.
 *
 * | Fill | Value | Job |
 * |---|---|---|
 * | `ink` | `#101215` | ears, eye patches, arms, legs, nose, mouth. Also `stage.ground` — the console has one dark and this is it. |
 * | `fur` | `#F4F3F1` | head and body. Also `light.muted`: a pure-white panda vanishes on the white page. |
 * | `light` | `#FFFFFF` | belly, muzzle, the eye whites, the catchlights, the moon. |
 * | `stalk` | `#9BD11C` | the bamboo he carries. `bamboo[500]`. |
 * | `leaf` | `#6E9A0F` | the leaves and the stalk's node lines. `bamboo[600]`. |
 * | `shadow` | `rgba(23,21,15,.09)` | the ellipse he stands on, and nothing else. |
 */
export const FILL = {
  ink: '#101215',
  fur: '#F4F3F1',
  light: '#FFFFFF',
  stalk: '#9BD11C',
  leaf: '#6E9A0F',
  shadow: 'rgba(23,21,15,.09)',
} as const;

export const MASCOT_LABEL: Record<MascotState, { en: string; zh: string; hours: string }> = {
  earlyBird: { en: 'Early bird', zh: '早班', hours: '05:00 – 09:00' },
  dayShift: { en: 'Day shift', zh: '白班', hours: '09:00 – 17:00' },
  goldenHour: { en: 'Golden hour', zh: '黄昏', hours: '17:00 – 22:00' },
  nightOwl: { en: 'Night owl', zh: '夜猫子', hours: '22:00 – 05:00' },
};

export function Panda({
  state,
  size = 96,
  className,
  label,
}: {
  /** Defaults to whatever the clock says, which is the intended use. */
  state?: MascotState;
  size?: number;
  className?: string;
  label?: string;
}) {
  const s = state ?? mascotStateAt();
  const night = s === 'nightOwl';
  /** How much of each eye the lid covers. Lids, not expressions. */
  const lid = s === 'earlyBird' ? 6.2 : s === 'goldenHour' ? 4.2 : 0;
  const awake = s === 'dayShift' || night;

  return (
    <svg
      viewBox="0 0 120 118"
      width={size}
      height={size * (118 / 120)}
      className={className}
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {label ? <title>{label}</title> : null}

      {/* Night gets a small moon, before the character so nothing overlaps him. */}
      {night ? (
        <>
          <path d="M104 20a10 10 0 1 1-8.4-9.9A8.2 8.2 0 0 0 104 20z" fill={FILL.light} />
          <circle cx="18" cy="14" r="1.6" fill={FILL.light} opacity=".7" />
          <circle cx="30" cy="7" r="1.1" fill={FILL.light} opacity=".5" />
        </>
      ) : null}

      <ellipse cx="60" cy="112" rx="29" ry="4" fill={FILL.shadow} />

      {/*
        Everything black, inside one group with a hairline of `fur` around it.
        A black-and-white character on a near-black card is a white head with
        no body: the ink shoulders, arms and legs measure under 1.2:1 against
        `dark.card` and simply vanish. The rim is 0.9px of a colour already in
        the palette, so the silhouette holds on both grounds and the artwork
        still has six fills.
      */}
      <g stroke={FILL.fur} strokeWidth="0.9">

      {/* Legs, then the body over them, so the joins need no drawing. */}
      <rect x="41" y="90" width="15" height="21" rx="7.5" fill={FILL.ink} />
      <rect x="64" y="90" width="15" height="21" rx="7.5" fill={FILL.ink} />

      {/* Arms. The early bird has one of them up, mid-stretch. */}
      {s === 'earlyBird' ? (
        <rect
          x="22"
          y="52"
          width="13"
          height="30"
          rx="6.5"
          fill={FILL.ink}
          transform="rotate(-34 28.5 67)"
        />
      ) : (
        <rect
          x="27"
          y="66"
          width="13"
          height="30"
          rx="6.5"
          fill={FILL.ink}
          transform="rotate(-9 33.5 81)"
        />
      )}
      <rect
        x="80"
        y="66"
        width="13"
        height="30"
        rx="6.5"
        fill={FILL.ink}
        transform="rotate(9 86.5 81)"
      />

      {/* Body: an ink shoulder mass with the white belly sitting inside it. */}
      <ellipse cx="60" cy="84" rx="27" ry="23" fill={FILL.ink} />
      <ellipse cx="60" cy="88" rx="19.5" ry="17.5" fill={FILL.light} />

      {/* Ears, behind the head, solid. */}
      <circle cx="35" cy="20" r="11" fill={FILL.ink} />
      <circle cx="85" cy="20" r="11" fill={FILL.ink} />

      {/* The head, wider than the body — the proportion the sheet is built on. */}
      <ellipse cx="60" cy="42" rx="32" ry="30" fill={FILL.fur} />

      {/* The eye patches, tilted outward. */}
      <ellipse cx="47" cy="41" rx="10.5" ry="12.5" fill={FILL.ink} transform="rotate(-16 47 41)" />
      <ellipse cx="73" cy="41" rx="10.5" ry="12.5" fill={FILL.ink} transform="rotate(16 73 41)" />

      {/* The eyes. Each is a white disc clipped by its own lid. */}
      <circle cx="48" cy="42" r="5.2" fill={FILL.light} />
      <circle cx="72" cy="42" r="5.2" fill={FILL.light} />
      <circle cx="48" cy="42.6" r="3.4" fill={FILL.ink} />
      <circle cx="72" cy="42.6" r="3.4" fill={FILL.ink} />
      {awake ? (
        <>
          <circle cx="46.6" cy="40.8" r="1.5" fill={FILL.light} />
          <circle cx="70.6" cy="40.8" r="1.5" fill={FILL.light} />
        </>
      ) : null}
      {lid > 0 ? (
        <>
          <rect x="42.8" y={36.8} width="10.4" height={lid} fill={FILL.ink} />
          <rect x="66.8" y={36.8} width="10.4" height={lid} fill={FILL.ink} />
        </>
      ) : null}

      </g>

      {/* Muzzle, nose, and the closed smile from the sheet. */}
      <ellipse cx="60" cy="57" rx="13" ry="9.5" fill={FILL.light} />
      <path d="M56.4 52.6h7.2a2.6 2.6 0 0 1-2.1 3.6h-3a2.6 2.6 0 0 1-2.1-3.6z" fill={FILL.ink} />
      <path
        d="M60 56.6v2.2M60 58.8a3.4 3.4 0 0 1-3.6 1.4M60 58.8a3.4 3.4 0 0 0 3.6 1.4"
        stroke={FILL.ink}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />

      {/*
        The bamboo, in the right paw. The early bird holds a short shoot
        instead of a full stalk — the same joke the owl's coffee cup was, made
        out of the same plant the ramp is named after.
      */}
      {s === 'earlyBird' ? (
        <g>
          <rect x="83" y="62" width="7" height="20" rx="3.5" fill={FILL.stalk} />
          <path d="M83 71h7" stroke={FILL.leaf} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M86.5 62c5-2 9-1 10.5.6-2.6 2.4-7.4 2.6-10.5-.6z" fill={FILL.stalk} />
          <path d="M87 62.4c3.4-.7 6.6-.4 9 .6" stroke={FILL.leaf} strokeWidth="1.2" fill="none" />
        </g>
      ) : (
        <g>
          <rect x="83" y="34" width="7" height="62" rx="3.5" fill={FILL.stalk} />
          <path
            d="M83 52h7M83 72h7"
            stroke={FILL.leaf}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path d="M86.5 40c5.5-3.4 11-2.8 13 0-3.2 3.4-9 3.6-13 0z" fill={FILL.stalk} />
          <path d="M86.5 36c-5 -3 -9.5 -2.6 -11.5 0 2.8 3 7.8 3 11.5 0z" fill={FILL.stalk} />
          <path
            d="M87 40.4c4-1.4 8-1.2 10.6 0M86 36.4c-3.4-1.2-6.8-1-9 0"
            stroke={FILL.leaf}
            strokeWidth="1.2"
            fill="none"
          />
        </g>
      )}
      {/* The paw closes over the stalk, so it is held rather than floating. */}
      <circle cx="86.5" cy="80" r="7.5" fill={FILL.ink} />
    </svg>
  );
}

export { mascotStateAt };
export type { MascotState };
