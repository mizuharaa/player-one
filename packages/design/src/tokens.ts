/**
 * PlayerOne's design tokens, and the only place their values exist.
 *
 * These are consumed by three codebases that cannot share a rendering model:
 * the back-office console (React 19, CSS custom properties), the Path C
 * upload-centre client (Electron, the same CSS), and the collector app
 * (React Native 0.82, plain JS objects — no CSS engine, no `var()`). So the
 * values live here as data and each surface derives its own form:
 * `toCss()` for the web, the exported objects themselves for React Native.
 *
 * Four constraints, each one a decision rather than taste:
 *
 * **Two brands, two jobs.** VNG's sun and PaXini's tech blue are not
 * interchangeable accents. Sun means *action and progress* — a button that
 * does something, a gauge filling toward a shift target. Tech means *data and
 * system* — links, references, anything the machine is telling you. Nothing
 * decorative uses either. The product owner stated the two colour worlds; the
 * hex values are this system's own choice, because no formal VNG or PaXini
 * brand guideline exists (confirmed, not assumed — do not go hunting for an
 * official palette).
 *
 * **The three verdicts are never orange.** `pass`, `partial` and `reject`
 * decide whether a collector is paid, so they own their own hues and are used
 * for nothing else. Partial is violet rather than the obvious amber precisely
 * because amber sits next to the sun ramp and a reviewer must never read a
 * verdict as a brand colour. Every verdict also carries a *shape* at the
 * component level, because red/green colour blindness is common and this axis
 * decides money.
 *
 * **The stage is not the dark theme.** `stage.*` is the near-black surround
 * the review player sits in, and it exists in *both* themes. Reviewers judge
 * `VQ-DARK` and `VQ-OVEREXPOSED`, so pixels adjacent to footage must not
 * shift that judgement — but that argument applies to the region around the
 * video, not to the whole back office. Light shell, dark theatre.
 *
 * **Both faces are self-hosted.** Upload centres sit on a LAN and the counter
 * workflow has to keep working with the link down. A webfont from a CDN would
 * make typography depend on the internet being up, which is the dependency the
 * rest of the system refuses. They arrive through `@fontsource-variable/*` and
 * are bundled, never fetched.
 */

/** VNG's sun. Actions, brand, progress. Never a verdict, never a surface. */
export const sun = {
  50: '#FFF4EC',
  100: '#FFE4D1',
  200: '#FFC9A5',
  300: '#FFAD78',
  400: '#FF9450',
  500: '#FF7A1A',
  600: '#E8620A',
  700: '#B94A05',
} as const;

/** PaXini's tech blue. Data, links, system, anything the machine reports. */
export const tech = {
  50: '#EBF2FF',
  100: '#D6E4FF',
  200: '#A9C6FF',
  300: '#7BA6FD',
  400: '#4A85F8',
  500: '#1B6EF3',
  600: '#0F55CC',
  700: '#0B3F99',
} as const;

/**
 * §6.9's three outcomes, and nothing else ever.
 *
 * Each carries a `bg` for fills that keeps its `fg` legible — a pill that sets
 * only its background is the usual way a status colour ends up unreadable in
 * one of the three states.
 */
export const verdict = {
  pass: { fg: '#12A150', bg: '#E8F8EE', bgDark: '#0D2A1A' },
  partial: { fg: '#7C5CFC', bg: '#F0EDFF', bgDark: '#1E1840' },
  reject: { fg: '#E5484D', bg: '#FDECEC', bgDark: '#331416' },
} as const;

export type VerdictName = keyof typeof verdict;

/**
 * Badge weight, and the only third colour family this system has.
 *
 * `docs/reputation.md` gives every badge one of three weights and the collector
 * app has to show which. Nothing already here can carry that axis: the sun ramp
 * means *action*, and a gold badge is not an action — it unlocks nothing, by
 * design — so painting a badge in the brand would promise a privilege that does
 * not exist. The verdicts are worse: they decide money and appear on verdicts
 * and nowhere else.
 *
 * Three constraints shaped the values:
 *
 * **One value each, not a light/dark pair.** These are fills on a shape — the
 * badge seal — and never a text colour. Non-text contrast needs 3:1, which all
 * three clear against every ground in both themes (worst case 3.10, against
 * `light.muted`; the incumbent `verdict.pass` scores 3.04 there). No single hue
 * can clear the 4.5:1 *text* floor against `#FFFFFF` and `#181B1F` at the same
 * time, which is why the neutrals carry a pair and these deliberately do not.
 *
 * **Never a fill on a control.** One glowing element per viewport is the sun's,
 * and a seal that reads as a button is a badge promising an unlock.
 *
 * **Colour is never the only signal.** `silver` and `gold` sit within 0.005 of
 * each other in relative luminance and are the same shape in greyscale, so the
 * weight is written as a word beside the seal as well.
 */
export const medal = {
  bronze: '#A9743F',
  silver: '#828A94',
  gold: '#A8862A',
} as const;

export type MedalWeight = keyof typeof medal;

/**
 * The theatre. Present in both themes, because it is about the footage and not
 * about the operator's ambient light.
 */
export const stage = {
  ground: '#101215',
  panel: '#191C21',
  line: '#2A2F36',
  fg: '#ECEEF1',
  mid: '#9AA1AC',
} as const;

/** Light is the shell's default: staffed upload centres are lit rooms. */
export const light = {
  background: '#FFFFFF',
  surface: '#FBFAF9',
  card: '#FFFFFF',
  muted: '#F4F3F1',
  border: '#E7E4E0',
  borderStrong: '#D5D1CC',
  foreground: '#17150F',
  mutedForeground: '#6E6A62',
  faintForeground: '#9C978E',
} as const;

/**
 * Dark, for reviewers working nights and for the Electron client on a dim
 * counter. Only the neutrals and the two lowest brand steps move — the brand
 * ramps and the verdicts hold their hue in both themes so a green pill means
 * the same thing whatever the room is doing.
 */
export const dark = {
  background: '#0E1013',
  surface: '#131619',
  card: '#181B1F',
  muted: '#1F2328',
  border: '#2A2F35',
  borderStrong: '#3A4048',
  foreground: '#ECEEF1',
  mutedForeground: '#9BA2AB',
  faintForeground: '#6C737C',
} as const;

/** The two brand steps that must invert, or a tint becomes a glare. */
export const darkBrandTints = {
  sun50: '#2A1608',
  sun100: '#3D2009',
  tech50: '#0C1A33',
  tech100: '#123061',
} as const;

/**
 * A fixed rem scale, not fluid. Operators view at a consistent DPI on fixed
 * machines, and a clamp-sized heading that shrinks inside a rail looks worse
 * rather than better. Ratio is ~1.2, which is tight on purpose: this surface
 * has far more type elements than a brand page and exaggerated contrast reads
 * as noise.
 */
export const fontSize = {
  xs: '0.75rem',
  sm: '0.8125rem',
  base: '0.9375rem',
  md: '1.0625rem',
  lg: '1.3125rem',
  xl: '1.625rem',
  '2xl': '2.0625rem',
  '3xl': '2.625rem',
  display: '3.5rem',
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  display: 800,
} as const;

/** A 4px base. Every gap in the console is a step on it. */
export const space = {
  0.5: '2px',
  1: '4px',
  1.5: '6px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
} as const;

export const radius = {
  sm: '8px',
  base: '12px',
  lg: '18px',
  xl: '26px',
  pill: '999px',
} as const;

/**
 * Shadows carry an offset and a soft blur — a zero-offset coloured halo is
 * decoration, not depth. `sun` is the one exception and is reserved for the
 * primary action, which is the only element allowed to glow.
 */
export const shadow = {
  sm: '0 1px 2px rgba(23,21,15,.06)',
  base: '0 4px 16px rgba(23,21,15,.07), 0 1px 3px rgba(23,21,15,.05)',
  lg: '0 18px 48px rgba(23,21,15,.13), 0 4px 12px rgba(23,21,15,.06)',
  sun: '0 8px 24px rgba(255,122,26,.32)',
} as const;

export const shadowDark = {
  sm: '0 1px 2px rgba(0,0,0,.4)',
  base: '0 4px 16px rgba(0,0,0,.5), 0 1px 3px rgba(0,0,0,.4)',
  lg: '0 18px 48px rgba(0,0,0,.6)',
  sun: '0 8px 24px rgba(255,122,26,.32)',
} as const;

/**
 * `Noto Sans SC` and `Microsoft YaHei` sit in the stack ahead of the generic
 * fallback because LOC-02 puts this console in front of Chinese reviewers, and
 * Plus Jakarta Sans has no CJK coverage. Without them a Chinese label falls
 * through to whatever the OS picks and the two languages stop looking like one
 * product.
 */
export const font = {
  sans: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", Roboto, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace',
} as const;

/**
 * One ease, used everywhere. Exponential-ish ease-out: motion in a tool should
 * arrive quickly and settle, never accelerate into view.
 */
export const ease = 'cubic-bezier(.22,.61,.36,1)';

/**
 * Durations. 150–250ms on almost everything, because the reviewer is in flow
 * and choreography costs throughput. `instant` exists for the verdict commit,
 * which must feel like a keypress and not like an animation.
 */
export const duration = {
  instant: '90ms',
  fast: '150ms',
  base: '200ms',
  slow: '320ms',
} as const;

/**
 * Cú's four states, and the hours that own them.
 *
 * She reads the clock rather than a mood picker: upload centres run shifts and
 * reviewers work nights, so an owl forced onto the 06:00 shift is funny once a
 * day and never in the way. `cuStateAt` is exported rather than inlined
 * because the collector app needs the same answer from the same boundaries.
 */
export const CU_STATES = ['earlyBird', 'dayShift', 'goldenHour', 'nightOwl'] as const;
export type CuState = (typeof CU_STATES)[number];

export function cuStateAt(date: Date = new Date()): CuState {
  const h = date.getHours();
  if (h >= 5 && h < 9) return 'earlyBird';
  if (h >= 9 && h < 17) return 'dayShift';
  if (h >= 17 && h < 22) return 'goldenHour';
  return 'nightOwl';
}

/**
 * The web form of everything above.
 *
 * Names follow shadcn/ui's vocabulary (`--background`, `--card`, `--muted`,
 * `--foreground`, `--border`) so shadcn components drop in without a
 * translation layer, and so a developer who knows that ecosystem can read this
 * stylesheet on sight. The brand ramps and the stage extend it; they are ours.
 */
export function toCss(): string {
  const ramp = (name: string, scale: Record<string, string>) =>
    Object.entries(scale)
      .map(([step, value]) => `  --${name}-${step}: ${value};`)
      .join('\n');

  const neutrals = (n: Record<keyof typeof light, string>) => `  --background: ${n.background};
  --surface: ${n.surface};
  --card: ${n.card};
  --muted: ${n.muted};
  --border: ${n.border};
  --border-strong: ${n.borderStrong};
  --foreground: ${n.foreground};
  --muted-foreground: ${n.mutedForeground};
  --faint-foreground: ${n.faintForeground};`;

  const shadows = (s: Record<keyof typeof shadow, string>) => `  --shadow-sm: ${s.sm};
  --shadow: ${s.base};
  --shadow-lg: ${s.lg};
  --shadow-sun: ${s.sun};`;

  const darkBlock = `${neutrals(dark)}
  --sun-50: ${darkBrandTints.sun50};
  --sun-100: ${darkBrandTints.sun100};
  --tech-50: ${darkBrandTints.tech50};
  --tech-100: ${darkBrandTints.tech100};
  --pass-bg: ${verdict.pass.bgDark};
  --partial-bg: ${verdict.partial.bgDark};
  --reject-bg: ${verdict.reject.bgDark};
${shadows(shadowDark)}`;

  return `:root {
${ramp('sun', sun)}
${ramp('tech', tech)}

  --pass: ${verdict.pass.fg};
  --pass-bg: ${verdict.pass.bg};
  --partial: ${verdict.partial.fg};
  --partial-bg: ${verdict.partial.bg};
  --reject: ${verdict.reject.fg};
  --reject-bg: ${verdict.reject.bg};

${neutrals(light)}

  --stage: ${stage.ground};
  --stage-panel: ${stage.panel};
  --stage-line: ${stage.line};
  --stage-fg: ${stage.fg};
  --stage-mid: ${stage.mid};

  --medal-bronze: ${medal.bronze};
  --medal-silver: ${medal.silver};
  --medal-gold: ${medal.gold};

${Object.entries(radius)
  .map(([k, v]) => `  --radius-${k}: ${v};`)
  .join('\n')}

${shadows(shadow)}
  --scrim: rgba(0, 0, 0, .72);

  --font-sans: ${font.sans};
  --font-mono: ${font.mono};
  --ease: ${ease};
${Object.entries(duration)
  .map(([k, v]) => `  --duration-${k}: ${v};`)
  .join('\n')}
}

/* System preference, unless the operator has explicitly chosen light. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${darkBlock}
  }
}

/* An explicit choice wins in both directions. */
:root[data-theme='dark'] {
${darkBlock}
}
`;
}
