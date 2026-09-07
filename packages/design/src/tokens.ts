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
 * Five constraints, each one a decision rather than taste:
 *
 * **Three flat fields, one job each.** VNG's sun and PaXini's tech blue are
 * not interchangeable accents. Sun means *action* — a button that does
 * something, the focus ring, the active destination. Tech means *data and
 * system* — links, references, anything the machine is telling you. Bamboo,
 * added with Trúc, means *the mascot and progress* — the shift gauge's ring, a
 * fill moving toward a target, the panda's own prop. Progress moved off sun so
 * that "this is doing something" and "this is how far along you are" stop
 * sharing a colour. Nothing decorative uses any of the three, and none of them
 * is ever a gradient: each field is flat. The product owner stated the two
 * brand worlds; the hex values are this system's own choice, because no formal
 * VNG or PaXini brand guideline exists (confirmed, not assumed — do not go
 * hunting for an official palette).
 *
 * **Bamboo is never a verdict and never money.** In the wrong hands it is one
 * hue away from the pass green, so it is barred from a verdict pill, a verdict
 * glyph, a payment-status label and any money figure — measured, its hue sits
 * 67° from `verdict.pass.fg`, and `contrast.test.ts` holds that gap. Progress
 * drawn in bamboo always carries a text label, a unit and geometry of its own
 * (a ring with a gap, plus a caption), so an arc can never be read as "passed"
 * or "paid".
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
 * rest of the system refuses. Both are bundled by Vite and never fetched: Be
 * Vietnam Pro as static per-weight subsets from `@fontsource/be-vietnam-pro`
 * (no variable package of it exists), JetBrains Mono from
 * `@fontsource-variable/jetbrains-mono`.
 */

/** VNG's sun. Action and brand. Never progress, never a verdict, never a surface. */
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
 * Bamboo. Trúc the panda, and progress.
 *
 * Vietnamese *trúc* is bamboo and is the mascot's name; Chinese writes the
 * same plant 竹. The ramp exists because progress used to be drawn in sun,
 * which made a half-filled gauge and a primary button the same colour and left
 * the reviewer to work out which of them was asking for a click.
 *
 * Three steps do the work, and each was chosen against a measured ratio rather
 * than by eye:
 *
 * - **500 is a FILL and only a fill**, under ink text: `light.foreground` on it
 *   measures 10.02:1. On white it is 1.82:1, so it is never text itself.
 * - **600 is the stroke** — the gauge ring, a graphic outline: 3.34:1 on the
 *   page and 3.01:1 on the muted fill, both clearing WCAG 1.4.11's 3:1 for a
 *   non-text boundary. On the dark page it doubles as text ink at 5.71:1.
 * - **700 is the light-scheme text ink**: 6.08:1 on white.
 *
 * And the exclusions, which matter more than the ratios: **never on a verdict
 * pill, a verdict glyph, a payment-status label or a money figure.** Those
 * belong to `verdict` and to the neutrals. See the header.
 */
export const bamboo = {
  50: '#F5FCE3',
  100: '#E9F8BF',
  200: '#D6F28A',
  300: '#C3EB5A',
  400: '#B0E230',
  500: '#9BD11C',
  600: '#6E9A0F',
  700: '#4C6C0A',
} as const;

/**
 * §6.9's three outcomes, and nothing else ever.
 *
 * Each carries a `bg` for fills that keeps its `fg` legible — a pill that sets
 * only its background is the usual way a status colour ends up unreadable in
 * one of the three states.
 *
 * The ink moves with the scheme, the same way the fill already did. One ink
 * per verdict was tried first and cannot work: measured, `#12A150` on the
 * light fill was 3.06:1 and on the dark fill 4.58:1, and every step that lifts
 * one lowers the other. So there are two, and `contrast.test.ts` holds every
 * pair at 4.5:1 against its own fill, against the card and against the page.
 *
 * **Hue is what holds across the themes, not the hex.** `fg` and `fgDark` are
 * the same HSL hue and saturation as the value they replace — 146°, 252°, 358°
 * — and differ only in lightness. A green pill still means paid in a dark
 * room; it is only light enough to read there.
 */
export const verdict = {
  pass: { fg: '#0D763B', fgDark: '#14B459', bg: '#E8F8EE', bgDark: '#0D2A1A' },
  partial: { fg: '#613AFB', fgDark: '#9B83FD', bg: '#F0EDFF', bgDark: '#1E1840' },
  reject: { fg: '#C41C21', fgDark: '#EB6F73', bg: '#FDECEC', bgDark: '#331416' },
} as const;

export type VerdictName = keyof typeof verdict;

/**
 * The theatre. Present in both themes, because it is about the footage and not
 * about the operator's ambient light.
 */
/**
 * Trúc's own two furs, which do not move with the scheme.
 *
 * A panda is black and white whatever the page behind him is doing. His black
 * is `stage.ground` — the one near-black both apps already use — and these are
 * the light half: `coat` for the head and body, `highlight` for the belly, the
 * muzzle, the eye whites and the catchlights, one step apart so the muzzle
 * still reads against the head.
 *
 * `coat` is not pure white on purpose: a pure-white panda vanishes on the
 * white page. The console's flat drawing has held these two values since it
 * was drawn; they live here now because the collector app's version took its
 * furs from `--muted` and `--background` instead, which are scheme colours —
 * so on a dark page Trúc was drawn black on black. Measured on the collector
 * sign-in, where he is 80px in the middle of the screen and rendered as a grey
 * ghost against the ground he was standing on.
 */
export const truc = { coat: '#F4F3F1', highlight: '#FFFFFF' } as const;

export const stage = {
  ground: '#101215',
  panel: '#191C21',
  line: '#2A2F36',
  fg: '#ECEEF1',
  mid: '#9AA1AC',
  /**
   * Type drawn over *footage*, under a scrim. Pure white, and only here.
   *
   * `fg` is right on a surface whose colour is known — `ground` and `panel` are
   * fixed, so 4.5:1 is a fact. A film is not a surface: the brightest pixel
   * under the type is whatever the collector filmed, and a kitchen window is
   * near enough to white. Measured against the worst case — a pure-white pixel
   * under the landing's 62% scrim — `fg` gives **4.52:1** and this token gives
   * **5.26:1**.
   *
   * There are two scrims and they are deliberately different, so neither figure
   * here describes the other surface: the collector landing is 62% because the
   * film fills the whole screen behind the type, and the console sign-in is 60%
   * because the film is half of a split and the type sits in its quietest
   * corner. At 60% the same two inks give 4.22:1 and 4.94:1, quoted where they
   * belong in `Login.tsx`. An audit read the mismatch as drift; it is not.
   *
   * Both clear AA, but 0.02 of margin is not a margin: it is the
   * `faintForeground` mistake again, where a ratio that rounded to 4.5 was
   * really 4.49999. The extra step costs nothing on a photograph, where the
   * difference between #ECEEF1 and white is invisible.
   *
   * Never on a surface. On `ground` it is a needlessly hot white where `fg` is
   * the considered one; `contrast.test.ts` holds both.
   */
  over: '#FFFFFF',
} as const;

/** Light is the shell's default: staffed upload centres are lit rooms. */
export const light = {
  background: '#FFFFFF',
  surface: '#FBFAF9',
  card: '#FFFFFF',
  muted: '#F4F3F1',
  border: '#E7E4E0',
  borderStrong: '#D5D1CC',
  /**
   * The boundary of a control a person types into, and the only border in the
   * system held to a ratio.
   *
   * WCAG 2.1 SC 1.4.11 asks 3:1 of the visual information needed to identify a
   * component, and a text field's edge is the whole of what identifies it.
   * `borderStrong` is a *separator* — it divides a card from the page, where
   * nothing has to be identified — and at 1.52:1 on white it was never going
   * to carry this job; it was doing it by default because nothing else
   * existed. Measured: this reads 3.43:1 on `background` and on `card`, where
   * the old value read 1.52:1. Two of the four boxes on the sign-in are
   * secrets, with no reveal and no caps-lock hint, so the edge is all a person
   * has.
   */
  fieldBorder: '#8F8A81',
  foreground: '#17150F',
  mutedForeground: '#6E6A62',
  /**
   * The hairline. A border, a divider, a control's hover edge — not a text ink.
   *
   * It was `#9C978E`, which measured 2.90:1 on the page, 2.79:1 on the surface
   * and 2.62:1 on the muted fill, and at that value it was carrying the small
   * uppercase labels on Home's figures, the review rail's headings and the
   * tour's step count. `#726D64` is the lightest warm grey that clears 4.5:1
   * on all four light grounds (4.99 / 4.79 / 4.99 / 4.50), so the value is
   * safe now — but the job is not the value. Ten text declarations across
   * seven console files were still setting type in it, one step below
   * `mutedForeground` for no stated reason; they read `mutedForeground` now
   * and this token draws edges. `contrast.test.ts` keeps holding it to the
   * text floor anyway, because a border token that fell under it would also
   * be a border nobody could see.
   */
  faintForeground: '#726D64',
} as const;

/**
 * Dark, for reviewers working nights and for the Electron client on a dim
 * counter. The brand ramps and the verdicts hold their **hue** in both themes,
 * so a green pill means the same thing whatever the room is doing; what moves
 * is lightness, on the neutrals, on the two lowest brand steps, on the verdict
 * inks (`fgDark`) and on the focus ring (`ring`).
 */
export const dark = {
  background: '#0E1013',
  surface: '#131619',
  card: '#181B1F',
  muted: '#1F2328',
  border: '#2A2F35',
  borderStrong: '#3A4048',
  /** 3.35:1 on the dark card, where `borderStrong` read 1.65:1. */
  fieldBorder: '#666E79',
  foreground: '#ECEEF1',
  mutedForeground: '#9BA2AB',
  /** Same argument, inverted: `#6C737C` read 3.30:1 on the muted fill. */
  faintForeground: '#848B94',
} as const;

/** The two brand steps that must invert, or a tint becomes a glare. */
export const darkBrandTints = {
  sun50: '#2A1608',
  sun100: '#3D2009',
  tech50: '#0C1A33',
  tech100: '#123061',
  bamboo50: '#1B2408',
  bamboo100: '#2C3D0C',
} as const;

/**
 * The keyboard focus ring, per scheme.
 *
 * §6.6 requires a complete review with no pointer, so the ring is a control
 * and WCAG 1.4.11 asks 3:1 of it against what it sits on. `sun[500]` was used
 * in both themes and measures 2.61:1 on white, 2.50:1 on the surface and
 * 2.35:1 on the muted fill — under the floor on every shell surface, and worst
 * on the one behind most buttons. `sun[600]` clears it on all three (3.40,
 * 3.26, 3.06) and `sun[400]` clears it on the dark shell (8.71). The stage
 * keeps its own override in globals.css, because near-black is a different
 * ground again.
 */
export const ring = { light: sun[600], dark: sun[400] } as const;

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

/**
 * The ambient ground: how the wash behind a sign-in form is built.
 *
 * A sign-in screen carries a soft wash of a brand tint behind the form
 * (`DESIGN.md`, "One exception, granted 2026-09-07", which allows an ambient
 * ground on the two sign-in surfaces while the ban on decorative and gradient
 * use of the three inks holds everywhere else). React
 * Native has no CSS blur, so the wash is `rings` concentric discs of one tint,
 * each drawn at the same low `step` alpha: they composite to
 * `1 - (1 - step) ** rings` at the centre and fall off one step per ring
 * outward, which is what reads as a blur. Three discs at three chosen alphas
 * was the first version and it read as three rings.
 *
 * The two numbers trade against each other: the ceiling is what the ink has to
 * survive, and the ring count is what stops the falloff reading as a target.
 * Three discs, then eight, both showed their edges on the dark page, where a
 * warm tint over near-black has nothing to hide a 5% band in. Fourteen at 0.026
 * composite to the same 0.31 in steps small enough to disappear.
 *
 * `step` is chosen against the text that can end up over it: at a 0.31
 * composite, `sun[200]` gives #FFECDD on the light page
 * and #6A5748 on the dark one, where the foreground ink measures about 15:1
 * and about 7:1. Raising either number is how a decorative wash starts costing
 * contrast.
 *
 * Decorative only, behind the form, never under an ink or on a control. Not
 * emitted by `toCss()`: the console draws its own wash in CSS, where a real
 * blur exists and these numbers do not apply.
 */
export const ambient = { step: 0.026, rings: 14 } as const;

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
 * Be Vietnam Pro carries the interface.
 *
 * It replaces Plus Jakarta Sans. The reason is the audience, not a defect in
 * the old face: this platform pays Vietnamese collectors, three of the console's
 * screens are read in Vietnamese by the finance operators who pay them, and the
 * collector app is Vietnamese-first (LOC-01). Be Vietnam Pro was designed in
 * Vietnam for Vietnamese text, with the language's stacked marks — ế, ộ, ữ —
 * as first-class glyphs in every one of its nine weights; it is the face the
 * audience's own products are set in. Plus Jakarta Sans also ships a
 * `vietnamese` subset (an earlier note here said it did not, which was wrong),
 * so this is a choice of world, not of coverage. What is verified, in
 * `settle-bills-mobile-vi.png`, is that Be Vietnam Pro's stacked marks render
 * at row height at 13px without clipping and without a fallback face.
 *
 * `Noto Sans SC` and `Microsoft YaHei` stay in the stack ahead of the generic
 * fallback because LOC-02 puts this console in front of Chinese reviewers and
 * no Latin family has CJK coverage. Without them a Chinese label falls through
 * to whatever the OS picks and the three languages stop looking like one
 * product.
 *
 * Mono is JetBrains Mono and it is for `.num` — measurement — only. A
 * translated label is never mono: monospace for a column of figures somebody
 * scans is a different thing from monospace as a costume for "technical".
 */
export const font = {
  sans: '"Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", Roboto, sans-serif',
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
 * The mascot's four states, and the hours that own them.
 *
 * Trúc reads the clock rather than a mood picker: upload centres run shifts and
 * reviewers work nights, so a mascot forced onto the 06:00 shift is funny once
 * a day and never in the way. `mascotStateAt` is exported rather than inlined
 * because the collector app needs the same answer from the same boundaries at
 * the same moment.
 *
 * The four names and the four boundaries are unchanged from Cú the owl, whom
 * Trúc replaces. `nightOwl` keeps its name deliberately: `cú đêm` and 夜猫子
 * are the idioms the shift is named after, and renaming the boundary would
 * break every stored preference and every test that names it, for nothing.
 */
export const MASCOT_STATES = ['earlyBird', 'dayShift', 'goldenHour', 'nightOwl'] as const;
export type MascotState = (typeof MASCOT_STATES)[number];

export function mascotStateAt(date: Date = new Date()): MascotState {
  const h = date.getHours();
  if (h >= 5 && h < 9) return 'earlyBird';
  if (h >= 9 && h < 17) return 'dayShift';
  if (h >= 17 && h < 22) return 'goldenHour';
  return 'nightOwl';
}

/**
 * The owl-era names, kept so `apps/collector` and any console route that has
 * not been switched over still compile against the same four boundaries.
 *
 * @deprecated use `MASCOT_STATES`
 */
export const CU_STATES = MASCOT_STATES;
/** @deprecated use `MascotState` */
export type CuState = MascotState;
/** @deprecated use `mascotStateAt` */
export const cuStateAt = mascotStateAt;

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
  --field-border: ${n.fieldBorder};
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
  --bamboo-50: ${darkBrandTints.bamboo50};
  --bamboo-100: ${darkBrandTints.bamboo100};
  --bamboo-ink: ${bamboo[200]};
  --sun-ink: ${sun[200]};
  --tech-ink: ${tech[200]};
  --pass: ${verdict.pass.fgDark};
  --pass-bg: ${verdict.pass.bgDark};
  --partial: ${verdict.partial.fgDark};
  --partial-bg: ${verdict.partial.bgDark};
  --reject: ${verdict.reject.fgDark};
  --reject-bg: ${verdict.reject.bgDark};
  --ring: ${ring.dark};
${shadows(shadowDark)}`;

  return `:root {
${ramp('sun', sun)}
${ramp('tech', tech)}
${ramp('bamboo', bamboo)}
  /* Ink for text on bamboo-50 / bamboo-100, per scheme: the web twin of
     bambooInk in native.ts, there for the same reason techInk is. The two
     lowest steps invert in dark mode, so a fixed bamboo-700 label on them goes
     from 5.76:1 to unreadable the moment the operator flips the theme.
     Measured: 700 on the light tints reads 5.76 and 5.39; 200 on the dark
     tints reads 13.00 and 9.51. */
  --bamboo-ink: ${bamboo[700]};

  /* The same per-scheme ink for the other two fields, and for the same reason:
     sun-50/100 and tech-50/100 invert in dark mode and the 700 steps do not.
     Measured on the dark tints, tech-700 reads 1.80:1 on tech-50 (the risk
     band and the payout attempt rows) and sun-700 reads 3.32:1 on sun-50 and
     2.87:1 on sun-100 (Home's needs-a-human strip). The 200 steps read
     10.08 / 7.53 and 11.63 / 10.04 on the same fills.

     They are also the brand text ink on the neutral surfaces, which is the
     other half of the same bug: tech-600 as a link measured 2.63:1 on the dark
     card, and four call sites had each patched that by hand with a one-off
     dark: variant. One token, both grounds - light 700 reads 9.61 / 8.67 on
     the page and the muted fill, and 5.19 / 4.68; dark 200 reads 11.08 / 9.18
     and 12.84 / 10.64. contrast.test.ts pins every pair.

     sun-ink is not allowed on sun-100 in the light scheme: 4.27:1, the one
     pair on these two ramps that does not clear AA. Nothing sets that fill
     under text. */
  --sun-ink: ${sun[700]};
  --tech-ink: ${tech[700]};

  --pass: ${verdict.pass.fg};
  --pass-bg: ${verdict.pass.bg};
  --partial: ${verdict.partial.fg};
  --partial-bg: ${verdict.partial.bg};
  --reject: ${verdict.reject.fg};
  --reject-bg: ${verdict.reject.bg};
  --ring: ${ring.light};

${neutrals(light)}

  --stage: ${stage.ground};
  --stage-panel: ${stage.panel};
  --stage-line: ${stage.line};
  --stage-fg: ${stage.fg};
  --stage-mid: ${stage.mid};
  --stage-over: ${stage.over};

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
