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

## The world: a lavender ground, an ink action, one lime accent

Committed 2026-09-07, replacing a warm white shell whose primary was VNG's
orange. The product owner pinned it from a reference screen — a soft periwinkle
wash under frosted cards — and the change is a **replacement of the visual
world**, not a refinement of the old one. What did not move: product truth, the
three verdicts, every requirement citation, and every behaviour.

This was allowed to happen because `PRODUCT.md` says it was: VNG's orange and
PaXini's blue were named by the product owner as brand *directions*, and it
records in the same breath that **no formal guideline or binding hex values
exist**, so the old ramps were the design system's own choice. A system is
allowed to change its own mind. It is not allowed to change a partner's mark,
and it did not.

| Role | Value | Job |
|---|---|---|
| **Lavender** `50–400` | the page itself | `--background` is `lavender-100`, `--surface` is `lavender-50`. Not an accent — the ground. |
| **Ink** `--action` / `--action-ink` | the primary action | A near-black pill with a light label, inverting with the scheme. |
| **Lime** `200/500/600/700` | progress, emphasis, the focus ring | 500 fills, 600 strokes, 700 is ink on light and 200 on dark. |
| **Sun** `#FF7A1A`, **Tech** `#1B6EF3` | the partner mark, and nothing else | VNG and PaXini, in the lockup. Never action, never a link, never progress, never type. |
| **Bamboo** `#9BD11C` | Trúc's stalk | The plant the mascot carries. It lost progress to lime. |

**Why the ground is tinted, and why that is the load-bearing decision.** A
translucent card over a white page *is* white — there is nothing behind it to
show through and the blur has nothing to bend, so the material reads as a grey
rectangle and the whole world collapses into cards with rounded corners. The
wash exists so that glass has something to be glass over. Change the page back
to white and every surface in the product stops working, which is why
`contrast.test.ts` asserts `light.background === lavender[100]` rather than
leaving it as a coincidence.

**Glass is a specific effect, not decoration.** `packages/design/src/tokens.ts`
carries it as two numbers per weight — `fill`, how much white sits over the
page, and `blur`, how far the ground is smeared behind it — with a card weight
and a denser bar weight, because a floating bar passes over scrolling content
and a card does not. The craft floor names blur-as-decoration as a default to
refuse; the pinned brief overrides it, and writing the effect down as a measured
material rather than a vibe is how it stays earned.

React Native has neither `backdrop-filter` nor a blur it can apply without a
native module, and this repo does not add native modules. So on the collector
app `fill` composites straight over the wash and the varying lavender behind it
does the work the blur would have done. That is the honest translation, not a
degradation: what people read as glass is the ground showing through, and the
blur only softens it.

**One accent, spent once.** Lime is the only saturated colour left outside the
verdicts and the mark. A screen gets one lime moment — a progress arc, a live
figure, the active nav pill — and if a second appears one of them is wrong. This
is the same rule the old world had for sun's glow, carried across.

### What each lime step may and may not do

Each was chosen against a measurement, not picked and then checked.
`packages/design/test/contrast.test.ts` holds every number and names it.

| Step | Job | Measured |
|---|---|---|
| `lime-500` | a **fill**, under ink text. Never text itself. | ink on it 13.54:1; it on the page 1.16:1 |
| `lime-600` | the **stroke** — a ring, a graphic edge. Also the focus ring. | 3.71:1 on the page, 3.44:1 on muted, 3.41:1 on the dark muted |
| `lime-700` | **ink** on the light page | 4.94 / 5.70 / 4.59 on page, card and muted |
| `lime-200` | **ink** on the dark page | 16.12:1 on the dark page |

`--lime-ink` is the per-scheme label for anything sitting on a lime tint, the
web twin of `limeInk` in `native.ts`.

**The two demotions are pinned as refusals**, not left to discipline. On the
lavender page `bamboo-600` reads 2.89:1 and `sun-700` reads 4.49:1 — both under
their floors, the second by a hundredth, which is exactly the `faintForeground`
trap this project has already been caught by once. Neither ramp was retuned,
because neither has the job any more; instead there is a test asserting each
falls short, so a future edit that wires progress back to bamboo or an action
back to sun fails before it reaches a screen.

**A wrong test, recorded.** The first version of the mark's case asserted 3:1
between `sun-500` and `tech-500`. They measure 1.76:1 and always did: two
saturated hues in a lockup are told apart by hue and by the overlap that draws
them, not by luminance. The assertion was wrong to make, and what is checked
now is that each disc separates from the page it is drawn on.

### The sign-in wash, folded into the world

The narrow exception granted on 2026-09-07 — two blurred fields of `bamboo-50`
and `sun-50` behind the sign-in forms — is **retired as an exception** because
the world it was an exception to is gone. The whole product stands on a wash
now. What survives from it is the discipline it was granted under, and that
discipline is now the rule for every glass surface in the system:

- **The ground barely moves the page.** Adjacent wash steps sit under 1.2:1 of
  each other.
- **Every ink over glass still clears AA**, in both schemes, measured against
  the *deepest* ground the surface can sit on — the worst case, not the
  average.
- **Never on or behind a control's own fill.** The ground is what a surface
  stands on; a pill, a chip or a button paints its own.
- **Measured, not asserted.** Both implementations are composited in the test —
  the console's `backdrop-filter` and the collector's flat overlay — in both
  schemes.
- **Still no gradient on an ink.** No ramp is ever interpolated to another
  colour. That half of the old rule did not move and never will.

### The landing's disc, granted a spectrum

**The product owner overruled this file for the landing's burst on 2026-09-07,
and this is the record of it.** He asked for a rainbow and said in the same
breath that the four-tint version — white, lime, bamboo and lavender, reasoned
from the rule above — was not it. He then chose the whole direction, **The
Drift**, against two alternates on 2026-09-08. The exception is granted to
`.prism` in `apps/console/src/styles/globals.css` and to nothing else.

What it does **not** grant, and these are the parts of the rule that did not
move:

- **Sun and tech are untouched.** The partner mark is still the only place
  either appears, and the mark itself is on this very screen.
- **The three verdicts are untouched.** Pass green, partial violet and reject
  red still appear on verdicts and nowhere else.
- **No new colour was added.** Every hue in all three variants is
  `oklch(from var(--lime-500) calc(l - 0.2) c calc(h + N))` — the token's own
  chroma, its lightness dropped once, and an angle. One colour dispersed,
  which is what a prism does to one beam. The drop in lightness is the light
  ground's requirement rather than a taste: a `multiply` filter has to carry
  value, and `--lime-500`'s own 0.887 multiplies over the page to nothing.
- **Still no gradient on an ink, and still no gradient lettering.**

**It is a disc on a light page, not a spoke field on a stage.** The landing
sits on `--background` like the rest of the console. The disc is a hard-edged
circle of about 58vh centred on the headline, at `mix-blend-mode: multiply`, so
it tints the tiles it overlaps and leaves the ones outside it alone. `screen`
was right over near-black and is invisible over a page; the compositing was
re-derived, not translated.

**Three variants, and each names a kind of work.** The key line — the one about
money — reads *Kitchen* / *Garden* / *Cleaning minutes, paid.*, and the disc
changes with it. The call to action cycles them on hover and on focus.

**It ignites on the button, and nothing else.** `.landing:hover` was the whole
180vh scroll region, so the burst was lit from the moment a pointer entered the
page. Pause is a *condition* of igniting rather than a rule arguing with it
afterwards, because `:has()` takes its argument's specificity and a plain
`[data-motion='paused']` rule loses to it — measured at opacity 1 with the
control pressed before it was written the other way.

**Two layering facts, both found by measuring and both cheap to lose.** The
disc carries no `z-index`: with one, Chromium composited it over the button and
the slogan painted *after* it, and no `z-index` on those was high enough to get
back on top — 9 was tried. And the type block is `position: relative` with no
`z-index`, because a static box paints below every positioned sibling. Document
order does the layering: tiles, halo, disc, type.

**Its measured limits**, from rendered pixels, disc lit, sampling only the
pixels a glyph actually covers — the difference of a render with the glyphs and
one without:

| Measured, worst frame | Value |
|---|---|
| Ink on its ground under a glyph, worst of 54 runs (3 viewports × 3 languages × 2 schemes × 3 variants) | **5.12:1** |
| Per variant | garden 5.22:1 · cleaning 5.44:1 · kitchen 5.12:1 |
| Worst boundary any landing control has on any ground, lit or unlit, all variants | **3.97:1** |
| Worst label on any landing control | **6.49:1** |
| Burst opacity at rest / CTA hover / CTA keyboard focus / tile hover / paused | 0 / 1 / 1 / 0 / 0 |

**The slogan's ground is a blurred rectangle of `--background`**, not the
near-black halo the stage version used. It is invisible on the page and its
only job is that a photograph can never be the thing under a letter — without
it the darkest ground under a glyph measured 1.08:1 at 390×844. It is a
rounded rectangle and not an ellipse because what it covers is a rectangle:
an ellipse similar to the block reaches its corners only at √2 of its
half-dimensions, which needs a box twice the block, and at 390px twice the
block is larger than the phone and bleached four tiles to white smears.

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

### A display face, for headlines only

**Hanken Grotesk Variable**, `--font-display`, added 2026-09-07 because the
product owner asked for "a great minimalistic font, modern, cool" on the
landing and showed a reference to say what he meant. It is a third family and
it earns that by doing a job neither of the other two does: Be Vietnam Pro is
the UI voice and reads as one at 52px, and there is no display cut of it.

**It was chosen on one constraint.** It is the only face on the shortlist that
ships a Vietnamese subset. Vietnamese stacks two marks on one vowel and a
display face without them sets "Đeo camera." with its consonants in one
typeface and its diacritic vowels in another, mid-word — which is worse than
having no display face at all. Self-hosted and bundled like the other two, from
`@fontsource-variable/hanken-grotesk`, OFL.

**It is variable, and that is used rather than decorative.** Large display type
wants a lighter weight than small display type: the strokes grow with the glyph
and the counters do not, so a weight that is right at 31px is heavy at 52px.
The landing's scale sets an optical weight at every step, running the opposite
way to the size.

| Role | 390px | 640px | 1024px |
|---|---|---|---|
| slogan | 1.9375rem / 600 / -0.018em | 2.625rem / 520 / -0.028em | 3.25rem / 440 / -0.034em |
| key line | 2.3125rem / 650 / -0.02em | 3.125rem / 560 / -0.03em | 3.875rem / 480 / -0.036em |

Two roles at a ratio of about 1.19, three steps each, and nothing on that
screen takes a fourth size. Tracking tightens as the size grows, which is most
of the difference between display type that looks expensive and display type
that looks like a browser default. `text-wrap: balance` on both. The values
live in one `.landing`-scoped block in `globals.css`, not spread through the
component as arbitrary Tailwind sizes.

**The dashboard takes the same two rules and only two sizes.** `.headline` and
`.headline-sm` in `globals.css` — Home's band title at 2.0625/610/-0.024em
rising to 2.625/520/-0.028em at 640px, and its four section headings at
1.0625/700/-0.012em. The weight runs the opposite way to the size there too,
and the larger step lands on exactly the landing's own 2.625/520/-0.028em, so
the two screens share a value rather than nearly agreeing.

**Where it may go: headlines only.** The landing slogan, the sign-in `h1`, and
Home's band title and section headings. Be Vietnam Pro keeps every label,
field, sentence, table and control, and `--font-mono` stays restricted to
`.num`. A display face on a form label is how a tool starts looking like a
brochure.

**No figure on Home is in the display face, and that is the rule colliding with
itself.** "The one number a card is about" would be display type on most
products; here every number on that screen is a measured quantity — the queue
depth, the gauge count, the approval rate, the settled value — and a measured
quantity is `.num`, which is mono and tabular because reviewers scan columns of
these for the one that is wrong. `.num` wins. When Home carries a figure that
is not a measurement, that is the one the display face gets.

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

**One hero per screen.** Review has the theatre. Pipeline has the stage track. No
page is a grid of same-size cards of icon-plus-heading-plus-text.

**Home is ordered before it is composed**, and the order is: attention needed →
next action → shift results → recent work → optional insights. Imagery and
motion serve that order and never reorder it. The one photograph on the screen
is in the *next action* band, because that is the only place on Home where a
picture is the subject rather than a decoration; the gauge belongs to *shift
results*, because progress is a result and not an instruction; and Trúc is last,
in *optional insights*, because he is an additional channel and never the only
one. A reviewer who reads the first two hundred pixels has read the two things
that can cost somebody money.

**A picture is beside the words, never behind them.** Home's band ran that
photograph full-bleed under a 60% ink scrim, and the product owner named the
result: the image was hidden. At that strength a frame is a texture, the band
is a dark rectangle, and the only picture on the screen is the thing you cannot
see. It has a frame of its own beside the type now, at full strength and flush
to the panel's edge, and three things follow from that. There is no scrim, so
no ink whose ratio depends on which frame the parallax has reached. The primary
pill loses the `--stage-over` hairline it needed only because a near-black
control on a near-black scrim measured 1.02:1 against its own band. And
`.feature-block` is the one ink block on the screen again, rather than the
second of two near-blacks two hundred pixels apart.

**No still is ever drawn beside an episode.** A picture next to an episode id is
a claim about what is in that recording, and this console has no per-episode
frame to make it with. The tiles in `public/tiles/` carry a `CREDITS.json`, and
four of them are marked `UNCLEARED` — a demo may show those, nothing a partner
sees may.

## Motion

One ease (`--ease`, `cubic-bezier(.22,.61,.36,1)`), 150–250ms on almost
everything. The reviewer is in flow; choreography costs throughput. Motion
conveys state, never decoration, and there is no page-load sequence.

Authored motion is a closed list, and `/review` is not on it:

- **The gauge sweep** — 900ms, once, on Home, and it starts when the ring
  reaches the viewport rather than when the page loads. The arc carries its true
  offset whether or not that ever happens, so a gauge nobody scrolls to reads
  the right number instead of reading zero.
- **Home's scroll choreography** — GSAP, dynamically imported so the tween
  engine stays out of `/review`'s chunk, and entirely inside one
  `gsap.matchMedia('(prefers-reduced-motion: no-preference)')`. Sections rise
  once each at `--duration-slow` on the one ease, read out of the cascade rather
  than retyped, and the photograph's `cover` crop drifts against the scroll,
  scrubbed. **Only the sections that start below the fold are ever hidden**, and
  the hidden state is set by the engine that is going to clear it — so reduced
  motion, a blocked chunk and an unmount all leave a screen that is complete in
  its first frame. This replaced a `.reveal` class with an `opacity: 0` default
  that an `IntersectionObserver` cleared, which had the failure the rule above
  describes: an observer that never runs leaves a section nothing ever shows.
  Measured, both ways — with the chunk aborted at the network and under
  `prefers-reduced-motion: reduce`, every section renders at full opacity with
  no inline style at all.

  The `ScrollTrigger.refresh()` on a `ResizeObserver` is not housekeeping. Built
  once and never refreshed, the triggers cache positions from a page that is
  still growing — the shift query lands, the ledger fills, the recent table
  replaces its skeletons, `TrucPanel` swaps an SVG for a canvas — and two
  sections of a payments screen held `opacity: 0` through a whole scroll to the
  bottom before they began to clear. That was measured, not reasoned about.
- **Trúc** — breathing, a blink every 3–6s, his head following the pointer, a
  jump with a squash on the landing when he is pressed, and, during the guided
  tour, a walk to the coach mark's target with a bob and a roll timed to the
  ground he covers, then a few small nods while the step's sentence is new. The
  nods run once per step and stop; a mascot that never stops moving beside a
  sentence is a reason not to read the sentence. Each behaviour is a named
  function of time in `PandaStage.tsx`, all of them inside the one `useFrame`.
- **The landing** — one choreography in three beats, not three entrances.
  Desktop only, scrubbed against scroll, and every tween starts from an
  already-visible default so a blocked tween engine leaves a finished page
  rather than an invisible one. The field opens out; the marquee band rises
  and its letters come out of a blur, once; the sign-in panel's parts arrive
  in reading order 40ms apart on an exponential ease-out. The tiles' own idle
  drift and their wave entrance are CSS, so they survive GSAP being blocked.
  The disc ignites on the call to action, on hover and on keyboard focus.
  Nothing is built at all under `prefers-reduced-motion`: the band is not
  rendered, the disc is `display: none`, the drift is removed rather than
  shortened, and two screenshots 2.2s apart are byte-identical.
- **`.lease-expiring`** — a slow 1.6s pulse, so a lease running out reads as a
  warning rather than an alarm.

**Nothing moves on `/review`**, and nowhere has a page-load sequence: a section
rises when it is scrolled to, never because a screen mounted. Motion here
conveys state or it is not there.

**Anything that idles carries a way to stop it.** `PandaStage` breathes and
blinks for as long as the tab is visible, which is what WCAG 2.2's Pause, Stop,
Hide is about — and `prefers-reduced-motion` does not answer it, because that is
a different person making a different decision somewhere else. The stage takes a
`paused` prop that runs through the same `still` path reduced motion already
takes, and the caller draws the control: on Home it is a real button beside him.

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
breathes, blinks every 3–6 seconds, turns its head toward the pointer, jumps
when pressed, takes a `mood` (`idle | happy | thinking | pointing`), and with an
`anchor: DOMRect` becomes a fixed transparent layer over the whole viewport and
walks to that rect, turning toward it. That layer is drawn **above** the coach
mark's card (`z-60` against the card's `z-50`), because a character who walks to
the element and is then painted over by the sentence about it is the bug the
whole behaviour exists to avoid; it costs the card nothing, because the layer
and every descendant are `pointer-events: none` and the card's buttons are still
what `elementFromPoint` returns at their own centres. He is given the card's own
rect as well, and stands beside it rather than on it. DPR is capped at 1.5, the
loop stops when the tab is hidden, and the loader's allocations are disposed on
unmount.

**He is not in the shift gauge, and that is a decision taken by the product
owner.** He stood in the middle of the ring at a size where a character with a
fixed camera and a pointer-driven yaw reads as a figure trapped in a hoop; the
word used was *uncanny*. The ring is a measurement and is now only that. He has
his own panel at the foot of Home instead, where he is a character rather than a
decoration inside an instrument — and where what he *says* is held to the rule
below.

**A greeting is authored. An operational statement is evidence.** Every sentence
he says that asserts a fact comes from the same query, with the same scope, the
same freshness stamp and the same error state as its ordinary counterpart
elsewhere on the screen — and that counterpart is always there, because he is an
additional channel and never the only one. `Shift` carries current figures and no
historical series, so there is nothing behind a trend and he does not claim one.
When a request failed he says **"Not connected"** and shows a dash; he never
substitutes an example for a figure that did not load, and no money is ever
animated through values nobody was paid. Numerical demonstrations live behind a
preview the operator turns on by hand, every value carrying "Example — not live
data" in all three locales.

He appears in empty states, loading states, the sign-in panel, the not-built
pages, Home's optional insights and the guided tour. **He never appears on the review
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
