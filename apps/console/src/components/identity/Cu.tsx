/**
 * Cú.
 *
 * `Cú` is Vietnamese for owl, and `cú đêm` — "night owl" — is a real Vietnamese
 * idiom for someone who stays up late. Chinese has the same idiom, 夜猫子. Both
 * partners already have a word for her, which is why she is an owl and not a
 * dog, a hedgehog or a robot.
 *
 * She also does the job. An owl has two big round forward-facing eyes; so does
 * the Ego headset; so does the mark. And an owl *watches*, which is literally
 * the work. The identity closes on itself.
 *
 * **She is driven by the clock, not by a mood picker.** Upload centres run
 * shifts and reviewers work nights, so she reads `getHours()` through
 * `cuStateAt` in the design package — the same function the collector app
 * calls, so the two surfaces are never in different states at the same moment.
 * Four states, no setting, no surprise.
 *
 * **She never appears on the review screen.** Nothing cartoon goes next to
 * footage somebody is paid or not paid on. Her homes are the shift gauge, the
 * empty state, the loading state, and the moment the queue reaches zero.
 *
 * Flat SVG, five fills, no gradients on the character, under 3 KB per state, so
 * the same artwork ships as an `react-native-svg` component in the app.
 */
import { cuStateAt, type CuState } from '@playerone/design/tokens';

/** Body, belly, ears — the palette that changes between day and night. */
const COATS: Record<CuState, { coat: string; belly: string; ring: string; iris: string }> = {
  earlyBird: { coat: '#E9E3DA', belly: '#FAF6F0', ring: '#E9E3DA', iris: '#1B6EF3' },
  dayShift: { coat: '#E9E3DA', belly: '#FAF6F0', ring: '#E9E3DA', iris: '#1B6EF3' },
  goldenHour: { coat: '#E4DCD2', belly: '#FAF6F0', ring: '#E4DCD2', iris: '#0F55CC' },
  nightOwl: { coat: '#3B4152', belly: '#4C5468', ring: '#3B4152', iris: '#4A85F8' },
};

export const CU_LABEL: Record<CuState, { en: string; zh: string; hours: string }> = {
  earlyBird: { en: 'Early bird', zh: '早班', hours: '05:00 – 09:00' },
  dayShift: { en: 'Day shift', zh: '白班', hours: '09:00 – 17:00' },
  goldenHour: { en: 'Golden hour', zh: '黄昏', hours: '17:00 – 22:00' },
  nightOwl: { en: 'Night owl', zh: '夜猫子', hours: '22:00 – 05:00' },
};

export function Cu({
  state,
  size = 96,
  className,
  label,
}: {
  /** Defaults to whatever the clock says, which is the intended use. */
  state?: CuState;
  size?: number;
  className?: string;
  label?: string;
}) {
  const s = state ?? cuStateAt();
  const c = COATS[s];
  const night = s === 'nightOwl';

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

      {/* Night sky, before the bird, so nothing overlaps her. */}
      {night ? (
        <>
          <path d="M100 22a11 11 0 11-9-11 9 9 0 009 11z" fill="#FFC9A5" />
          <circle cx="20" cy="18" r="1.7" fill="#fff" opacity=".8" />
          <circle cx="34" cy="10" r="1.2" fill="#fff" opacity=".6" />
          <circle cx="108" cy="52" r="1.4" fill="#fff" opacity=".55" />
        </>
      ) : null}

      {/* Golden hour gets a low sun instead of a moon. */}
      {s === 'goldenHour' ? <circle cx="99" cy="30" r="9" fill="#FFC9A5" /> : null}

      <ellipse
        cx="60"
        cy="110"
        rx="27"
        ry="4.5"
        fill={night ? 'rgba(0,0,0,.34)' : 'rgba(23,21,15,.09)'}
      />

      <path
        d="M60 14c22 0 34 18 34 44 0 28-15 44-34 44s-34-16-34-44c0-26 12-44 34-44z"
        fill={c.coat}
      />
      <path
        d="M60 46c14 0 22 13 22 30 0 18-10 26-22 26s-22-8-22-26c0-17 8-30 22-30z"
        fill={c.belly}
      />

      {/* Ear tufts. */}
      <path d="M28 26l12 12-16 4z" fill={c.coat} />
      <path d="M92 26L80 38l16 4z" fill={c.coat} />

      {/* The eyes — the same two circles as the mark and the headset. */}
      <circle cx="45" cy="50" r={night ? 15 : 14} fill={night ? '#EFF3F8' : '#FAF6F0'} />
      <circle cx="75" cy="50" r={night ? 15 : 14} fill={night ? '#EFF3F8' : '#FAF6F0'} />
      <circle cx="45" cy="50" r={night ? 10 : s === 'earlyBird' ? 8.5 : 9} fill={c.iris} />
      <circle cx="75" cy="50" r={night ? 10 : s === 'earlyBird' ? 8.5 : 9} fill={c.iris} />
      <circle
        cx="45"
        cy={s === 'goldenHour' ? 51 : 50}
        r={night ? 5 : s === 'earlyBird' ? 4 : 4.4}
        fill="#0E1013"
      />
      <circle
        cx="75"
        cy={s === 'goldenHour' ? 51 : 50}
        r={night ? 5 : s === 'earlyBird' ? 4 : 4.4}
        fill="#0E1013"
      />

      {/* Awake and alert: a catchlight. Night is the widest awake she gets. */}
      {s === 'dayShift' || night ? (
        <>
          <circle cx={night ? 48 : 47.6} cy={night ? 46.6 : 47} r={night ? 2.4 : 2.1} fill="#fff" />
          <circle cx={night ? 78 : 77.6} cy={night ? 46.6 : 47} r={night ? 2.4 : 2.1} fill="#fff" />
        </>
      ) : null}

      {/* Early bird is barely open; golden hour is drooping. Lids, not expressions. */}
      {s === 'earlyBird' ? (
        <>
          <path d="M31 44a14 14 0 0128 0z" fill={c.ring} />
          <path d="M61 44a14 14 0 0128 0z" fill={c.ring} />
        </>
      ) : null}
      {s === 'goldenHour' ? (
        <>
          <path d="M34 46a12 12 0 0122 0z" fill={c.ring} />
          <path d="M64 46a12 12 0 0122 0z" fill={c.ring} />
        </>
      ) : null}

      {/* Beak: the sun. The one place the brand orange touches her. */}
      <path d={night ? 'M60 61l-7 8h14z' : 'M60 60l-7 8h14z'} fill="#FF7A1A" />
      <path d="M50 96l-4 7h8zM70 96l4 7h-8z" fill={night ? '#E8620A' : '#FF9450'} />

      {/* Early bird holds a cup; day shift stretches a wing. */}
      {s === 'earlyBird' ? (
        <g>
          <rect x="86" y="64" width="17" height="15" rx="3" fill="#fff" stroke="#E8620A" strokeWidth="2" />
          <path d="M103 68h4a3 3 0 010 6h-4" fill="none" stroke="#E8620A" strokeWidth="2" />
          <path
            d="M90 60c0-3 3-3 3-6M96 60c0-3 3-3 3-6"
            stroke="#E8620A"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            opacity=".7"
          />
        </g>
      ) : null}
      {s === 'dayShift' ? (
        <path
          d="M26 62q-8 6 -2 14"
          stroke={c.coat}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

export { cuStateAt };
export type { CuState };
