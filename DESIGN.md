# Design

Recorded from the built console, not from intention. Where this file and the
code disagree, the code is right and this file is stale — fix it.

Product truth lives in `PRODUCT.md`. Stack decisions live in
`docs/adr/0002-back-office-is-a-react-spa.md`. This file owns the visual system.

## Where the values live

`packages/design/src/tokens.ts` is the only place a colour, radius, shadow or
duration is written down. It emits two forms:

- `generated/tokens.css` — CSS custom properties, consumed by the console and,
  later, the Electron upload-centre client. Regenerate with
  `pnpm -F @playerone/design build:css`.
- `nativeTheme(scheme)` in `src/native.ts` — a resolved object for React Native,
  which has no cascade, no `var()` and no media queries.

Tailwind v4 reads the CSS variables through an `@theme inline` block in
`apps/console/src/styles/globals.css`, so `bg-sun-500` and `text-pass` resolve to
the same values the app does. **Do not add a colour to a component.** A value
that exists only in a `.tsx` file is a value the collector app cannot have.

## The two brands do two jobs

They are not interchangeable accents.

| Ramp | Means | Appears on |
|---|---|---|
| **Sun** `#FF7A1A` (VNG) | Action and progress | Primary buttons, the shift gauge fill, focus rings, the playhead, active nav pill |
| **Tech** `#1B6EF3` (PaXini) | Data and system | Links, collector and requirement references, the operator chip |

Nothing decorative uses either. There is exactly one glowing element per
viewport — the primary action, carrying `--shadow-sun` — and if a second appears
one of them is wrong.

The product owner stated the two colour worlds. **The hex values are this
system's own choice**: no formal VNG or PaXini brand guideline exists. That is
confirmed, not assumed. Refine them freely; do not go hunting for an official
palette that is not there.

## The three verdicts own their hues

`--pass` · `--partial` · `--reject`, each with a `-bg`, and each with **two
inks**: light `#0D763B` / `#613AFB` / `#C41C21`, dark `#14B459` / `#9B83FD` /
`#EB6F73`. Same hue in both schemes (146°, 252°, 358°), different lightness.

One ink for both schemes was the first design and it does not work. Measured:
`#12A150` reads 3.06:1 on the light fill and 4.58:1 on the dark one, and every
step that lifts one lowers the other. All three pills failed AA in both themes
and nothing said so, because the ratios lived in a code comment.

Three rules:

- **Never orange.** Partial is violet rather than the obvious amber precisely
  because amber neighbours the sun ramp, and a reviewer must never read a
  verdict as a brand colour.
- **Never colour alone.** Every verdict carries a shape too — a check, a
  half-filled ring, a cross (`IconPass` / `IconPartial` / `IconReject`).
  Red/green colour blindness is common and this axis decides whether somebody is
  paid.
- **Never below 4.5:1.** `packages/design/test/contrast.test.ts` measures every
  ink against its own fill, the card, the page and the muted fill, in both
  schemes, and fails if one drops under AA. It also holds each verdict to one
  hue across the two schemes, so a ratio can never be fixed by changing what a
  colour means.

These three appear on verdicts and nowhere else.

## Light shell, dark theatre

Not one theme with a dark variant. Two different arguments:

**The shell** (Home, Pipeline, rails, counter, sign-in) follows the operator's
environment. Light by default because staffed upload centres are lit rooms;
`ThemeSwitch` cycles light → dark → system for reviewers working nights.

**The stage** (`--stage` `#101215` and friends, applied with `.on-stage`) is the
region around the video and is near-black **in both themes**. Reviewers judge
`VQ-DARK` and `VQ-OVEREXPOSED`; bright chrome bordering footage biases a call a
collector is paid on. That argument covers pixels adjacent to video and nothing
else, which is why the metadata rail beside the player stays light.

`.on-stage` also sets `color-scheme: dark` so form controls and scrollbars inside
it stop rendering light chrome against near-black.

## Type

One family carries everything: **Plus Jakarta Sans**, with **JetBrains Mono** for
every measured quantity. Both are **self-hosted** through
`@fontsource-variable/*` and bundled by Vite — an upload centre on a LAN with the
link down must render in the right typeface, so nothing is fetched at runtime.

`"Noto Sans SC"` and `"Microsoft YaHei"` sit in the sans stack ahead of the
generic fallback: Plus Jakarta has no CJK coverage and LOC-02 puts this console
in front of Chinese reviewers.

**A fixed rem scale, not fluid** (`fontSize` in tokens.ts, ratio ≈ 1.2).
Operators view at consistent DPI on fixed machines; a clamp-sized heading that
shrinks inside a rail looks worse, not better. The scale is tight on purpose —
this surface has far more type elements than a brand page and exaggerated
contrast reads as noise.

### The `.num` class is load-bearing

Every measured quantity — durations, amounts, counts, requirement IDs, episode
folders — gets `.num`: mono, `tabular-nums`, tightened tracking. A duration whose
digits shift as it ticks is the commonest way a player looks amateur, and here it
is worse than cosmetic: reviewers scan columns of these looking for the one that
is wrong, and proportional digits make that scan fail.

## Composition

**No left sidebar.** A sidebar spends 220px of every screen on navigation used
twice a shift, and the object under review is a wide video. Navigation is a pill
row in the top bar; the live queue-depth and pace counters sit beside it on every
screen, because reviewer throughput is the programme's ceiling.

**Destinations that have no screen still appear**, marked with a dot, and route
to a page saying what the surface is for and how the work is done today. Hiding
them teaches a false map that moves later; an empty table looks like a bug on a
screen where a bug means somebody is not being paid.

**One hero per screen.** Home has the gauge and the primary action directly under
it. Review has the theatre. Pipeline has the stage track. No page is a grid of
same-size cards of icon-plus-heading-plus-text.

## Motion

One ease (`--ease`, `cubic-bezier(.22,.61,.36,1)`), 150–250ms on almost
everything. The reviewer is in flow; choreography costs throughput. Motion
conveys state, never decoration, and there is no page-load sequence.

Two authored exceptions:

- **The gauge sweep** — 900ms, once, on Home. The one number worth watching move.
- **`.lease-expiring`** — a slow 1.6s pulse, so a lease running out reads as a
  warning rather than an alarm.

`prefers-reduced-motion` collapses both.

## Browser surfaces

Selection, caret, scrollbars, focus ring, link underline offset and autofill are
themed from the palette in `globals.css`. These ship with browser defaults that
belong to no design system, and leaving them is the cheapest tell that a page was
assembled rather than built.

The focus ring is the sun, at 2px with a 2px offset, and it brightens to
`--sun-400` inside `.on-stage`. **A complete review must be possible with no
pointer at all** — that is a throughput requirement before it is an access one —
so the ring has to hold against the light shell, the near-black theatre and
arbitrary video.

It is `--ring`, a different step of the ramp per scheme: `sun-600` on the light
shell, `sun-400` on the dark one. `sun-500` in both was the first version and
measured 2.61:1 on white, 2.50:1 on the surface and 2.35:1 on the muted fill —
under WCAG 1.4.11's 3:1 for a control boundary on every shell surface, and worst
behind buttons. The contrast test holds all three.

## Components

`apps/console/src/components/ui/` follows shadcn/ui's anatomy and vocabulary —
`cva` variants, `Slot` via `asChild`, tokens named `--background`, `--card`,
`--muted`, `--foreground`, `--border` — so shadcn components drop in without a
translation layer. The values are ours.

Every interactive component declares default, hover, active, focus-visible and
disabled. Shipping half of them is the commonest way a tool starts feeling
unfinished.

**Icons are authored**, not imported: one 20×20 grid, 1.9 stroke, round joins,
`currentColor`, in `components/icons.tsx`. Several glyphs this surface needs — a
TF card, a stereo lens pair, a handover — no library draws, and mixing an
authored card icon with a borrowed chevron is how an icon set stops looking like
one. The verdict glyphs carry a heavier stroke (2.4–2.6) because they must hold
at 13px inside a pill.

## Identity

**The mark** is two overlapping circles: the Ego headset's stereo lens pair, VNG's
sun on the left, PaXini's blue on the right, overlapping where the data is. It is
also a pair of eyes, which is where Cú comes from. It holds at 16px, works in one
colour, and survives being an Android launcher icon. The overlap is drawn as a
third shape rather than left to alpha blending, because a blend renders
differently on a dark ground and the mark appears on both.

**Cú** is Vietnamese for owl; `cú đêm` — "night owl" — is a real Vietnamese
idiom, and Chinese has the same one, 夜猫子. Both partners already have a word for
her. Four states, chosen by `cuStateAt()` reading the clock, not by a mood
picker: upload centres run shifts and reviewers work nights.

| State | Hours |
|---|---|
| Early bird | 05:00 – 09:00 |
| Day shift | 09:00 – 17:00 |
| Golden hour | 17:00 – 22:00 |
| Cú đêm / Night owl | 22:00 – 05:00 |

She appears in the shift gauge, empty states, loading states, the sign-in panel,
and the not-built pages. **She never appears on the review screen.** Nothing
cartoon goes next to footage somebody is paid or not paid on.

Flat SVG, five fills, no gradients on the character, so the same artwork ships as
an `react-native-svg` component in the collector app.

## Copy

Plain and specific, in Simplified Technical English when describing system
behaviour. Controls name their action; errors name the problem and the recovery.
This copy reaches people who are paid or not paid on it, so there is no "Oops"
and no congratulation nobody asked for.

Two sentences are not decoration and must survive any rewrite:

- **"An estimate. The server figure decides the payment."** beside the running
  total on Review. The client sends marked spans and never a duration or an
  amount; the server rounds in exactly one function. The word "estimate" is on
  the screen for the same reason it is in the code.
- **"Your decisions only. Not the programme's spend."** under Home's settled
  value, so nobody reads a personal figure as a budget.

## Localisation

English and Chinese (LOC-02), from one catalogue — `packages/api/src/i18n.ts`,
imported by the console through `@playerone/api/i18n`. A test asserts both
locales hold every key, so adding an English string without its Chinese
counterpart fails CI rather than surfacing as an English word in the middle of a
Chinese sentence at an upload centre.

Keys are flat and dotted, so i18next runs with `keySeparator: false` and
`nsSeparator: false`.

The language toggle is labelled in the **target** language — somebody who cannot
read the current one can still find the way out — and sets `lang` on the root
element (`zh-Hans`, not `zh`) so CJK glyph variants and screen-reader voices are
right.

Vietnamese is deliberately absent from this console. LOC-04 puts Vietnamese on
what reaches the **collector**: the reject reason codes, which are catalogue rows
in `review_reason_codes` with a `label_vi`, not strings here.

## Accessibility floor

No standard is mandated by the brief or by VNG policy — confirmed, not assumed.
What this project holds itself to:

- WCAG 2.2 AA contrast in both themes.
- Full keyboard reachability; a complete review with no pointer.
- Never colour alone on any state that decides money.
- `aria-current` on the active destination, real `<fieldset>`/`<legend>` grouping
  on sign-in, `role="img"` with a text label on the gauge, and `<dialog>` for the
  shortcut sheet so focus trapping and Escape come from the platform.

## Checking it

```
pnpm -F @playerone/console dev          # needs the API on :8080
node packages/api/scripts/seed-console.mjs   # a real queue to develop against
node apps/console/scripts/shots.mjs     # every screen, both viewports, both languages
```

`shots.mjs` writes to `.impeccable/review/`. Run it before claiming a visual
change works; a typecheck cannot see contrast, overflow or a gauge drawn from the
wrong angle.
