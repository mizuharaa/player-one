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

## Three flat fields, one job each

They are not interchangeable accents, and none of them is ever a gradient.

| Ramp | Means | Appears on |
|---|---|---|
| **Sun** `#FF7A1A` (VNG) | Action | Primary buttons, focus rings, the playhead, the active nav pill |
| **Tech** `#1B6EF3` (PaXini) | Data and system | Links, collector and requirement references, the operator chip |
| **Bamboo** `#9BD11C` (Trúc) | The mascot, and progress | The shift gauge ring, a fill moving toward a target, the panda's own prop |

**Progress moved off sun.** It used to be sun's second job, which made a
half-filled gauge and a primary button the same colour and left the reviewer to
work out which of them was asking for a click. Sun keeps action; bamboo takes
progress and arrives with the mascot it is named after — Vietnamese *trúc* is
bamboo, Chinese writes the same plant 竹.

Nothing decorative uses any of the three. There is exactly one glowing element
per viewport — the primary action, carrying `--shadow-sun` — and if a second
appears one of them is wrong.

**One exception, granted 2026-09-07, and it is narrow.** The sign-in screens —
`/login` in the console and the collector's `SignIn` — carry an ambient ground
below the split: two heavily blurred fields of `bamboo-50` and `sun-50` at
about half opacity, behind the form. That is decorative use of two of the three
ramps and it is what the rule above forbids, so it is written down here rather
than argued around. Daniel asked for it directly, with a reference screen, and
overrode the rule for these two surfaces.

The exception carries its own limits, and they are the reason it is survivable.
They are stated as outcomes and not as recipes, because the two apps cannot use
the same recipe: the console has CSS `blur`, React Native does not, and the
first version of this list said "the palest step only" and "never above `lg`" —
two console implementation details that the collector app could not meet and
that said nothing about whether either wash was any good. The auditor caught
that. What actually matters is what the ground does to the page:

- **It must barely move the page.** The worst point of the composite — every
  field overlapping, at full strength — sits under 1.2:1 against
  `--background`. A wash you can name a colour for is a ramp step doing a job,
  and these are not doing one.
- **Every ink over it still clears AA**, in both schemes: body text and the
  muted ink that carries the field labels and the legal line.
- **It uses the two ramp steps that invert with the scheme**, 50 and 100.
  That is not a taste rule, it is the whole safety property: the higher steps
  are fixed values, so a 200 over a dark page is a pale disc on near-black. It
  shipped that way for one afternoon in the collector app and measured 3.73:1
  for body text and 1.68:1 for the muted ink.
- **Never on or behind an ink, a control, a pill or a chip.** It is the ground
  the form stands on and nothing else. The rule that sun means action and
  bamboo means progress is untouched everywhere a reader has to act on it.
- **Only on a sign-in surface**, and on the web only below the split, where the
  film is not already the atmosphere.
- **Measured, not asserted.** `packages/design/test/contrast.test.ts` composites
  the worst point of both implementations — the console's two blurred fields and
  the collector's fourteen concentric discs — in both schemes, and pins all of
  the above. A wash that costs a contrast ratio fails a test before it reaches a
  screen.
- **Still not a gradient on an ink.** No ramp is ever interpolated to another
  colour, on this screen or anywhere else. That half of the rule did not move.

### Bamboo's three steps, and what it may never touch

Three steps carry a job and each was chosen against a measured ratio.
`packages/design/test/contrast.test.ts` holds every number below, in both
schemes, and names the ratio in the case.

| Step | Job | Measured |
|---|---|---|
| `bamboo-500` | A **fill**, under ink text. Never text itself. | ink on it 10.02:1; it on white 1.82:1 |
| `bamboo-600` | The **stroke** — the gauge ring, a graphic outline. Text on the dark page. | 3.34:1 on the page, 3.20:1 on the surface, 3.01:1 on the muted track; 5.71:1 as text on `dark.background` |
| `bamboo-700` | Text **ink** on the light page. | 6.08:1 on white, 5.76:1 on `bamboo-50` |

`--bamboo-ink` is the per-scheme label colour for anything sitting on
`bamboo-50` / `bamboo-100` — `bamboo-700` in light, `bamboo-200` in dark
(13.00:1 and 9.51:1 on the inverted tints) — the web twin of `bambooInk` in
`native.ts`. The two lowest steps invert in dark mode like sun's and tech's, so
a fixed ink on them stops working the moment the operator flips the theme.

### Three inks, one per field: `--sun-ink`, `--tech-ink`, `--bamboo-ink`

All three fields have the same problem and now the same answer. **Write brand
text in the ink, never in a numbered step.** Each resolves to the 700 step in
light and the 200 step in dark, and each is safe on its own two tints *and* on
all four shell surfaces, so one token covers a pill label and a link.

| | Light (700) | Dark (200) |
|---|---|---|
| `--tech-ink` | 8.55 / 7.51 on `tech-50` / `-100`; 9.61 on the page, 8.67 on muted | 10.08 / 7.53 on the inverted tints; 11.08 on the page, 9.18 on muted |
| `--sun-ink` | 4.80 on `sun-50`; 5.19 on the page, 4.68 on muted | 11.63 / 10.04 on the inverted tints; 12.84 on the page, 10.64 on muted |

What it replaced, measured in the dark scheme: `tech-700` on `tech-50` was
**1.80:1** — the risk band pills on preflight and the payout attempt rows;
`sun-700` on `sun-50` was **3.32:1**, and **2.87:1** on the `sun-100` Home's
needs-a-human strip took on hover; and `tech-600` as a link or a data figure
was **2.63:1** on the dark card. That last one had four hand-written
`dark:text-[var(--tech-300)]` patches on it and eight sites without one, plus a
`:root[data-theme='dark'] a` rule that only caught the *explicit* dark choice
and left every operator on system dark reading links at 2.63:1.

`--sun-ink` is barred from `sun-100` in the light scheme: 4.27:1, the one pair
on these ramps that does not clear AA. The contrast test pins it as a failure so
it stays out of the markup.

**`--faint-foreground` is a hairline, not an ink.** A border, a divider, a
control's hover edge. Its value clears AA on every ground it appears on, so
this is a contract rule rather than a ratio: ten text declarations across seven
console files were setting type one step below `--muted-foreground` for no
stated reason, and they read `--muted-foreground` now. The one place it still
touches `color` is the non-blocking flag glyph in `risk/pieces.tsx`, which is
decoration beside a sentence that carries the meaning.

**Bamboo is never a verdict and never money.** Not on a verdict pill, not on a
verdict glyph, not on a payment-status label, not on any money figure. Measured,
its hue sits **67° from `verdict.pass.fg`** (79° against 146°) and the contrast
test holds every step of the ramp at least 40° away from both pass inks. And
progress drawn in bamboo always carries a text label, a unit and geometry of its
own — a ring with a gap, plus a caption — so an arc can never be read as
"passed" or "paid".

The product owner stated the two brand worlds. **The hex values are this
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

**The top bar is that same dark, and it is the only one.** `.on-stage` is on the
header, so the bar, the theatre and the one ink block a screen is allowed
(`.feature-block`) are all `--stage` rather than three near-blacks that nearly
match. It holds still when the operator flips the theme, which is the point: the
one piece of furniture on every screen is the one piece that never moves. On it,
the active nav pill is a sun fill with ink type (7.19:1) and the rest of the bar
is white held back to 72%, which composites to 9.96:1. The controls in the bar —
the theme cycle, the language select — are drawn in `currentColor` rather than in
white, because the same two components also appear on the light sign-in panel and
a control that hard-codes white is invisible there.

## Type

One family carries everything: **Be Vietnam Pro**, with **JetBrains Mono** for
every measured quantity. Both are **self-hosted** and bundled by Vite — an upload
centre on a LAN with the link down must render in the right typeface, so nothing
is fetched at runtime.

It replaced Plus Jakarta Sans. The reason is the audience, not a defect in the
old face: the platform pays Vietnamese collectors, three of the console's screens
are read in Vietnamese by the finance operators who pay them, and the collector
app is Vietnamese-first (LOC-01). Be Vietnam Pro was designed in Vietnam for
Vietnamese text, with the language's stacked marks — ế, ộ, ữ — as first-class
glyphs in every one of its nine weights; it is the face the audience's own
products are set in. Plus Jakarta Sans also ships a `vietnamese` subset (an
earlier draft of this file said it did not, which was wrong), so this is a choice
of world, not of coverage. What is verified, in `settle-bills-mobile-vi.png`, is
that Be Vietnam Pro's stacked marks render at row height at 13px without clipping
and without a fallback face.

There is no variable build of it, so `globals.css` imports six static weights —
400, 500, 600, 700, 800, 900 — from `@fontsource/be-vietnam-pro`. Each of those
six files carries exactly the three subsets this console needs, `vietnamese`,
`latin` and `latin-ext`, and the OFL licence travels with the package.

`"Noto Sans SC"` and `"Microsoft YaHei"` sit in the sans stack ahead of the
generic fallback: no Latin family has CJK coverage and LOC-02 puts this console
in front of Chinese reviewers.

**React Native gets the system face, not this one.** `nativeTheme().font.sans`
resolves to `'System'` and `mono` to `'monospace'`, because a `fontFamily` naming
a family Android cannot find renders in Roboto with no warning — the same silent
fallback the self-hosting exists to avoid. There is no native build in this
repository to link an asset into; `native.ts` carries a `ponytail:` note naming
the files to link and the one line to change when there is one.

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

Authored motion is a closed list, and `/review` is not on it:

- **The gauge sweep** — 900ms, once, on Home. The one number worth watching move.
- **Trúc** — breathing, a blink every 3–6s, his head following the pointer, and
  the glide to a coach mark's target during the guided tour.
- **The landing hero** — the sign-in page's parallax, desktop only, and a
  progressive enhancement: the form is usable before it runs and without it.
- **`.lease-expiring`** — a slow 1.6s pulse, so a lease running out reads as a
  warning rather than an alarm.

**Nothing moves on `/review`**, and nowhere else has a page-load sequence:
sections do not fade or rise in as a screen mounts. Motion here conveys state or
it is not there.

`prefers-reduced-motion` collapses all of it. The panda in particular is not
slowed down under it — `PandaStage` switches its render loop to `demand` and the
scene holds one drawn frame, which is a still pose rather than a crawling one.
The loop also stops dead when the tab is hidden.

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

**The primary button carries ink, not white.** White on `sun-500` measures
2.61:1 — the label on the one thing a screen was asking for had the worst
contrast on the screen. It is `--stage` now, and `--stage` rather than
`--foreground` because the fill does not change with the scheme and
`--foreground` does. Measured: 7.19:1 at rest, 8.58:1 on hover (`sun-400`),
5.52:1 while pressed (`sun-600`). `sun-700` is not one of the states, because
ink on it is 3.61:1. **Secondary is an ink outline** that inverts to a filled ink
block on hover; it used to be a filled tech blue, which made every second action
on a screen look like a link to data.

Two utilities in `globals.css` carry ideas that were being hand-rolled per
screen. **`.hatch`** is the empty state's ground — a ruled diagonal pattern with
hard stops, so it is a drawn surface and not a gradient. An empty table on this
console can mean "nothing to do" or "the query is wrong and somebody is not being
paid", and white space reads as the second; a drawn surface says the screen
rendered and is empty on purpose. **`.feature-block`** is the one ink block a
screen is allowed, with `.figure` for its numeral in mono. It exists for a figure
that carries its own sentence and its own action — never for a big number with a
small label and an accent underneath, which is the template it refuses.

**Icons are authored**, not imported: one 20×20 grid, 1.9 stroke, round joins,
`currentColor`, in `components/icons.tsx`. Several glyphs this surface needs — a
TF card, a stereo lens pair, a handover — no library draws, and mixing an
authored card icon with a borrowed chevron is how an icon set stops looking like
one. The verdict glyphs carry a heavier stroke (2.4–2.6) because they must hold
at 13px inside a pill.

## Identity

**The mark** is two overlapping circles: the Ego headset's stereo lens pair, VNG's
sun on the left, PaXini's blue on the right, overlapping where the data is. It is
also a pair of eyes, which is the mascot's face too — Cú's, and now Trúc's two
black patches. The lockup gains no gradient. It holds at 16px, works in one
colour, and survives being an Android launcher icon. The overlap is drawn as a
third shape rather than left to alpha blending, because a blend renders
differently on a dark ground and the mark appears on both.

**Trúc** is a panda, and he replaces Cú the owl. Vietnamese *trúc* is bamboo and
Chinese writes the same plant 竹, so both partners already have a word for him —
the test the owl passed too. He also does the job: a panda is the animal that
sits still and pays attention to one thing for a very long time, which is what a
reviewer does for eight hours, and bamboo is what progress is drawn in here, so
the mascot and the measure share a colour and a name. The owl artwork is gone;
`identity/Cu.tsx` is an alias file so an import that has not been switched over
still resolves.

Four states, chosen by `mascotStateAt()` reading the clock, not by a mood picker:
upload centres run shifts and reviewers work nights. The four names and the four
boundaries are unchanged, `nightOwl` included — `cú đêm` and 夜猫子 are the idioms
the shift is named after, and renaming a boundary breaks every stored preference
for nothing. `cuStateAt` and `CuState` remain as deprecated aliases so the
collector app still compiles.

| State | Hours |
|---|---|
| Early bird | 05:00 – 09:00 |
| Day shift | 09:00 – 17:00 |
| Golden hour | 17:00 – 22:00 |
| Cú đêm / Night owl | 22:00 – 05:00 |

He has two bodies.

**`identity/Panda.tsx`** is the flat one: six fills, listed in `FILL` with the
job each does, no gradients, so the same artwork ships as an `react-native-svg`
component in the collector app. Four of the six are values that also exist in
`tokens.ts` — `stage.ground`, `light.muted`, `bamboo[500]`, `bamboo[600]` — and
are the same colour on purpose. This is the one file in the console allowed to
write a hex literal, for the reason `var()` does not exist in React Native, and
`PandaStage` imports its palette from here rather than repeating it. The ink
shapes carry a hairline of `fur` around them: a black-and-white character on a
near-black card is a white head with no body.

**`identity/PandaStage.tsx`** is the three.js one, lazy-loaded in its own chunk.
It renders `public/truc.glb` — one mesh, one material, about 22k vertices — and
falls back, in order, to a panda built from spheres and capsules while the model
loads or if its fetch fails, and to the flat SVG when there is no WebGL at all. A
slow LAN degrades to a different fidelity, never to a hole in the page. It
breathes, blinks every 3–6 seconds, turns its head toward the pointer, takes a
`mood` (`idle | happy | thinking | pointing`), and with an `anchor: DOMRect`
becomes a fixed transparent layer over the whole viewport and glides to that
rect, turning toward it. DPR is capped at 1.5, the loop stops when the tab is
hidden, and the loader's allocations are disposed on unmount.

He appears in the shift gauge, empty states, loading states, the sign-in panel,
the not-built pages and the guided tour. **He never appears on the review
screen** — `PandaStage` returns `null` when `location.pathname` starts with
`/review`, so no caller can put him there by accident. The rule's reason is
footage: nothing cartoon goes next to a recording somebody is paid or not paid
on. The flat panda in a queue-empty state on `/review` is the one place the
letter of the rule and its reason diverge, and it stays — an empty queue has no
episode, no player and no payment on the screen at all.

## The guided tour

`components/guide/`. Optional, dismissible, and offered by the console itself
exactly once: a strip on Home, once per browser (`playerone.guide.seen`), plus a
permanent "Show me around" button in the top bar. It never starts by itself
anywhere else, and never on `/review`.

Four or five sentences per screen, each standing beside the element it names.
`steps.ts` maps a route to `{ target, key, placement }`, where `target` is always
a `[data-guide="…"]` attribute — a class is a styling decision and moves — and
`key` is an i18n key that exists in all three locales or the parity test fails.
A step whose element is not on the page keeps its sentence and says so rather
than pointing at nothing.

The spotlight is one `box-shadow`: a 9999px spread of `--scrim` around a
transparent rounded box, so the cut-out is the box itself and there is no second
element to keep aligned. The container is a real `<dialog>`, so focus trapping,
the top layer and Escape come from the platform, and the focus returns to the
trigger on close. On every route except `/review`, `PandaStage` receives the
target rect and Trúc walks over and looks at it.

**The tour must not be able to pay anybody.** `/review` binds Space, ←, →, J, L,
I, O, X, 1, 2, 3 and Enter to the window, and Enter commits a verdict. The tour
is driven with Enter and the arrow keys. Two guards, both in the code and both
measured in `guide.test.tsx`:

- `guideBlocksKeys(event)` — one line at the top of Review's window handler. It
  reads a module variable, not React state, because a React update is not
  visible to a native listener running in the same tick as the key it is
  judging. The signal is raised synchronously in `startGuide`, **before** any
  dialog opens, and cleared on close, on unmount and on a route change.
- Every key event is stopped natively at the dialog element, in the bubble
  phase, so it never reaches `window` at all — including the Enter or Escape
  that closes the tour. React's `stopPropagation` would not do this: React
  delegates to the root container and the native event carries on regardless.

The lease is untouched by any of it, and the shortcuts resume the moment the
dialog closes.

`/episodes` carries `IconPartialBuilt`, a half-filled square, in the nav. It is
**not** `IconPartial`, which is a verdict glyph: a payment symbol in the
navigation is one glance from meaning something about money. `/counter`, which is
not built at all, keeps a plain dot.

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

English, Chinese and Vietnamese, from one catalogue —
`packages/api/src/i18n.ts`, imported by the console through
`@playerone/api/i18n`. A test asserts all three locales hold every key, so adding
an English string without its counterparts fails CI rather than surfacing as an
English word in the middle of a Chinese sentence at an upload centre.

Keys are flat and dotted, so i18next runs with `keySeparator: false` and
`nsSeparator: false`.

The language toggle is labelled in the **target** language — somebody who cannot
read the current one can still find the way out — and sets `lang` on the root
element (`zh-Hans`, not `zh`) so CJK glyph variants and screen-reader voices are
right.

**Vietnamese is a console locale.** It was absent until the payout screens, and
that sentence survived here longer than it was true. LOC-02 put the back office
in English and Chinese; the payout brief added Vietnamese, because the finance
operators who run a settlement batch are VNG staff in Ho Chi Minh City and every
risk flag has to render as one plain sentence in Vietnamese and English. `vi`
holds every key, not a subset — a catalogue with holes is how an English word
ends up mid-sentence. It is also why the interface face is Be Vietnam Pro.

Separately, LOC-04 puts Vietnamese on what reaches the **collector**: the reject
reason codes, which are catalogue rows in `review_reason_codes` with a
`label_vi`, not strings here.

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
