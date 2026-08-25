/**
 * The console's icons, drawn rather than imported.
 *
 * One grid (20×20), one stroke weight (1.9), round joins, `currentColor`
 * throughout — so an icon inherits the colour of whatever it sits in and the
 * set stays coherent when half of it appears on the light shell and half on the
 * dark stage. There is no icon library in the dependency list on purpose: this
 * surface needs about fifteen glyphs, several of which (a TF card, a stereo
 * lens pair, a handover) no library draws, and mixing an authored card icon
 * with a borrowed chevron is exactly how an icon set stops looking like one.
 *
 * The three verdict glyphs are the exception that proves the rule: they carry a
 * heavier stroke (2.4–2.6) because they are the only icons that must stay
 * legible at 13px inside a pill, and because they are load-bearing — a verdict
 * must never be signalled by colour alone.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.6 10 3l7 5.6V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z" />
  </Icon>
);

/** The counter: a card crossing a desk. */
export const IconCounter = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="11" height="8" rx="1.6" />
    <path d="M5.4 5V3.4M8.2 5V3.4M11 5V3.4" />
    <path d="M15.5 16.5h2M2.5 16.5h10" />
  </Icon>
);

/** Review: the stereo pair, watching. */
export const IconReview = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.2" cy="10" r="4.6" />
    <circle cx="12.8" cy="10" r="4.6" />
  </Icon>
);

export const IconEpisodes = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
    <path d="M8.2 8.3 12 10l-3.8 1.7z" />
  </Icon>
);

/** Settle: a bill line. */
export const IconSettle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 3.5h11v13l-2.2-1.4-2.15 1.4L9 15.1l-2.15 1.4L4.5 15z" />
    <path d="M7.6 7.6h4.8M7.6 10.8h3.2" />
  </Icon>
);

export const IconPipeline = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="4.2" cy="10" r="2.2" />
    <circle cx="15.8" cy="10" r="2.2" />
    <path d="M6.4 10h7.2" />
    <path d="M11.4 7.6 13.8 10l-2.4 2.4" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4.3l2.7 1.6" />
  </Icon>
);

/** Pace, as a bolt: verdicts per unit time. */
export const IconPace = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 2.5 5 11h4l-1 6.5L15 9h-4z" />
  </Icon>
);

export const IconLanguage = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.2" />
    <path d="M2.9 10h14.2M10 2.8c1.9 2 2.9 4.5 2.9 7.2s-1 5.2-2.9 7.2c-1.9-2-2.9-4.5-2.9-7.2s1-5.2 2.9-7.2z" />
  </Icon>
);

export const IconKeyboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="5.5" width="16" height="9" rx="1.8" />
    <path d="M5.5 8.5h.01M8.2 8.5h.01M10.9 8.5h.01M13.6 8.5h.01M6.8 11.5h6.4" />
  </Icon>
);

export const IconSignOut = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.6 3.5H4.8a1.3 1.3 0 0 0-1.3 1.3v10.4a1.3 1.3 0 0 0 1.3 1.3h2.8" />
    <path d="M12.4 13.2 15.6 10l-3.2-3.2M15.6 10H7.4" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.2 17.4 16H2.6z" />
    <path d="M10 8v3.2M10 13.6h.01" />
  </Icon>
);

export const IconArrow = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10h11.4M11.4 6 15.4 10l-4 4" />
  </Icon>
);

export const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16.4 8.4A6.6 6.6 0 1 0 16 13" />
    <path d="M16.8 4.2v4.4h-4.4" />
  </Icon>
);

/* ---------------------------------------------------------------------------
   The three verdicts. Heavier stroke, and each is a distinct *shape* — a check,
   a half-filled ring, a cross — so the outcome survives a monochrome print, a
   red/green colour deficiency, and a 13px pill.
   ------------------------------------------------------------------------- */

export const IconPass = ({ size = 17, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...rest}
  >
    <path d="M4 10.6 8.2 14.8 16 6.2" />
  </svg>
);

export const IconPartial = ({ size = 17, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    aria-hidden="true"
    {...rest}
  >
    <circle cx="10" cy="10" r="6.6" />
    <path d="M10 3.4a6.6 6.6 0 0 1 0 13.2z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconReject = ({ size = 17, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    aria-hidden="true"
    {...rest}
  >
    <path d="M5.6 5.6 14.4 14.4M14.4 5.6 5.6 14.4" />
  </svg>
);
