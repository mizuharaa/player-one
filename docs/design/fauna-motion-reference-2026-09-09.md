# Fauna Robotics — geometry, motion and gallery reference — 2026-09-09

**Bounded research. Not an acceptance pass, not an implementation.** No UI
edited, no server started, no commit. Browser work went through
`withBrowser` / `newPage` (`apps/console/scripts/browser.mjs`), one context at
a time, `reducedMotion: 'no-preference'` because observing motion was the point.

**Extraction rule held throughout:** what is recorded is *geometry and
composition* — the technique, and the numbers behind it. **The Fauna mark
itself is not a reference and must not be reproduced.** Their mark is a
figurative robot glyph; ours is not and will not be.

Sources:

| | |
|---|---|
| Live site | `https://faunarobotics.com`, desktop 1440x900, 2026-09-09 |
| Mobbin | `search_sections` — "team member portrait gallery grid people" (web), "geometric shapes brand system flat primitives" (web) |
| Screenshots | session scratchpad, `scratchpad/fauna/01-top.png` … `04-scroll.png` |

**Mobbin still returns nothing for Fauna Robotics.** Consistent with the
2026-09-09 finding already recorded in
`docs/design/mobbin-reference-research-2026-09-09.md`: there is no robotics
category and Fauna is not indexed. Everything below about Fauna is measured
from the live site, not from Mobbin.

---

## 1. Measured ground and type

| Property | Measured value |
|---|---|
| Page ground | `rgb(248, 240, 227)` — warm cream, **flat**, no gradient or vignette |
| Card / well ground | `rgb(236, 228, 215)` — exactly one step down from the page, nothing else |
| Ink | `rgb(24, 1, 2)` — near-black carrying a **red** bias, not a neutral grey-black |
| Display face | `Matter, Arial, sans-serif` |
| `h1` | `64px`, weight **500**, letter-spacing **-2px**, line-height `65.92px` (**1.03**) |
| Document height | `9423px` against a 900px viewport (~10.5 screens) |
| Media | **27** `<video>`, **9** `<canvas>`, **55** `<img>` |

Two things transfer directly and cost nothing:

- **Two grounds, not five.** The entire page is `#F8F0E3` with `#ECE4D7`
  wells. Depth comes from the shape and the photograph, never from a third or
  fourth surface tint.
- **The ink is not neutral.** `rgb(24,1,2)` is a decision. Our ink is a token;
  worth checking whether it is a plain neutral by default.

Set against the Butter measurement already on file (`h1` 107.57px at weight
**400**, leading 0.99): both references set display type **light for its size
with leading at or just above 1.0**. Fauna is heavier at 500 but also much
smaller at 64px. Consistent with F3 in `style-tile-review-2026-09-09.md`, and
the same caution applies — **1.03 leading on a Latin reference is not
automatically safe for Vietnamese stacked diacritics.** Measure the stacked
forms before adopting the ratio.

---

## 2. The shape system — measured, and simpler than it looks

The "geometric fragment assembly" read is correct, and the implementation is
**plain divs with `border-radius`**. Measured across the whole document:

- `clip-path` on any element: **none**
- `mask-image` on any element: **none**
- Inline SVG: **7 total**, every one an icon — viewBoxes `0 0 20 20`,
  `0 0 24 24`, `0 0 64 64`, each with **1-2 paths** and no `g`, `rect`,
  `circle` or `polygon`. Largest rendered 64x64.

**Fifteen distinct `border-radius` values carry the entire shape alphabet:**

```
8px      16px     32px     40px     64px     100px    1000px   100%
8px 32px 32px 8px          32px 8px 8px 32px
100px 16px 16px 100px      16px 100px 16px 16px
64px 64px 0px 0px          0px 0px 50% 50%          0px 50% 0px 0px
```

The interlocking collage (screenshot `03-scroll.png`) is built from that list:

| Element | Measured |
|---|---|
| Half-round, opening down | `477 x 476`, `border-radius: 0px 0px 50% 50%`, `rgb(167, 98, 90)` |
| Quarter-round, top-right | `478 x 476`, `border-radius: 0px 50% 0px 0px`, `rgb(61, 172, 145)` |
| Arch well | `border-radius: 64px 64px 0px 0px` |
| Lozenge, one end capped | `100px 16px 16px 100px` and its mirror `16px 100px 16px 16px`, on `348 x 140` |
| Tab, one edge softened | `8px 32px 32px 8px` and its mirror `32px 8px 8px 32px` |

**Why this matters to us.** The bolder Flim ink/lavender direction wants
geometric fragments. This is evidence that **the whole vocabulary is reachable
from one square div and a directional radius** — no SVG authoring, no
`clip-path` browser matrix, no asset pipeline. Every fragment is a real DOM box
that can hold a photograph (`overflow: hidden`), take focus, and be read by a
screen reader.

**Direct consequence for the `logo_assembly` lane.** Fauna does **not** animate
a modular SVG mark. There is no inline SVG on the page above 64x64, and the
wordmark is not vector in the DOM at all. So the assembly language lives in the
**page sections**, not in an animated logo build. If PlayerOne wants an
assembling SVG intro, that is our own idea and Fauna is **not** evidence that it
works — treat it as untested, and do not cite this page in support of it.

---

## 3. The gallery — the composition worth taking

Screenshot `04-scroll.png` is the closest thing on the page to a collector
gallery, and it is the strongest idea here.

Measured: a horizontal band of **vertical slats, each `44 x 586`**, each one a
live video, arch-topped, marching across the full page width under a centred
two-line headline. At a 44px slat width the viewer reads **motion, colour and
setting**, not faces. The strip repeats — the same clips recur at regular
intervals — so it is a marquee over a finite set, not 27 unique films.

Elsewhere the same page runs an **unequal-height card grid**: one column width
`459px`, heights measured at `272 / 344 / 488 / 560`, all at
`border-radius: 32px` on `rgb(236, 228, 215)` with `overflow: hidden`. **One
width, four heights.** Same lesson the Poly reference gave — variety comes from
height, alignment comes from width.

**Read against the Mobbin people-gallery set** (Ragged Edge, Mother Design,
Pitch, Maze, Runway, Until, COLLINS, Harvest, Miro, Mural, ClickUp, folk,
Equals, Passionfroot, Height, Brilliant, Uniswap, OFF+BRAND, Customer.io,
Craft, Base): the set splits cleanly in two, and the split is the decision we
actually have to make.

**Roster galleries** (Runway, Customer.io, Mural, Harvest, Height, folk,
ClickUp) put **one photo per person with a name and a role**. They work because
the identity is the point — you are meant to find a specific person.

**Composition galleries** (Ragged Edge, Mother Design, Pitch, Maze, COLLINS,
OFF+BRAND) treat the portraits as a **field**: unequal tiles, mixed crops,
mixed eras, colour-graded grounds, some tiles not people at all. Ragged Edge
puts every subject on a different saturated ground; Mother Design mixes
black-and-white archive shots with colour; Maze mixes single portraits with
group shots at three tile sizes; COLLINS substitutes artwork for a face
entirely.

**Ours must be the second kind, and the reason is product truth, not taste.**
Our collector imagery is **illustrative and does not depict real
participants** — that is already recorded in
`docs/design/style-tile-review-2026-09-09.md` section 3 and it is binding. A
roster gallery asserts "these are our collectors" by its very form: a name slot
and a role slot under a face is a claim about a person. **A composition gallery
makes no such claim**, and Fauna's 44px slats make it least of all — at that
width there is no face to mistake for a real collector.

So: **a field of work, not a wall of faces.** Slats, or unequal tiles, showing
hands and settings and activity. Whatever form it takes, the existing labelling
rule holds without exception — "Illustrative, not footage recorded by Ego" or
its equivalent stays on the section.

---

## 4. Motion — measured values only

**Measured, with no interpretation:**

| | Measured |
|---|---|
| CSS keyframe animations on the page | **2**, both `0.3s ease`, `iteration-count: 1` — `top-line-close`, `bottom-line-close` (the hamburger) |
| video count | **27** |
| `autoplay` | **27 of 27** |
| `loop` | **27 of 27** |
| `muted` | **27 of 27** |
| paused at rest | **0 of 27** — every clip was playing |

Measured CSS transitions, verbatim:

```
opacity, width          0.35s   cubic-bezier(0.25, 0.46, 0.45, …)
height, width           0.35s   cubic-bezier(0.25, 0.46, 0.45, …)
transform               0.5s    cubic-bezier(0.25, 0.46, 0.45, …)
width                   0.3s    cubic-bezier(0.165, 0.84, 0.44, …)
border-radius           0.3s    cubic-bezier(0.47, 0, 0.745, 0)
max-width               0.5s    ease-in-out
opacity                 0.3s    ease
color                   0.2s    cubic-bezier(0.25, 0.46, 0.45, …)
background-color, color, border  0.3s  ease
```

**No timing is guessed.** The values above are the computed
`transition-duration` / `transition-timing-function` strings read off the live
DOM. Fauna's *scroll* pacing is **not** recorded here because it is driven by
script, and a duration read from a computed style is not the duration of a
scroll-linked tween. **Anyone quoting a Fauna scroll timing has invented it.**

Two observations that are ours to act on, and one that is a warning:

- **`border-radius` is a transitioned property here** (`0.3s`,
  `cubic-bezier(0.47, 0, 0.745, 0)` — an ease-in). A shape morphing from square
  to arch on state change is a real, cheap technique, and it is the motion that
  matches a shape-alphabet identity rather than sitting on top of one.
- **The easing is one family.** `cubic-bezier(0.25, 0.46, 0.45, …)` —
  ease-out-quad — carries almost everything, at `0.2s / 0.3s / 0.35s / 0.5s`.
  One curve, four durations. That is a token set, not a per-element decision.
- **27 autoplaying loops is the opposite of the F1 recommendation already on
  file.** Butter runs 49 clips with `autoplay: false` and starts them on
  intersection; Fauna runs 27 and starts them all. **Do not read Fauna as
  permission to autoplay.** Our collectors are on phones, our own `/discover`
  already carries a measured idle-frame cost, and the intersection-gated
  approach in `style-tile-review-2026-09-09.md` F1 stands. If we take Fauna's
  slat *composition*, we take it with Butter's *media policy*.

---

## 5. What is NOT supported by this research

Recorded explicitly so nothing here gets over-claimed downstream:

- **No scroll-pacing numbers.** Not measured, not inferable from computed style.
- **No evidence for an assembling SVG intro.** Fauna has no such thing; see
  section 2.
- **No mobile measurement.** Desktop 1440x900 only, this pass.
- **No "Our collectors" URL.** The owner named an exact Fauna section by
  description; the URL has not arrived. Section 3 is built from the slat band at
  ~70% scroll depth and from the Mobbin people-gallery set, and will need
  rechecking against the real section when the link lands.
- **Nothing about accessibility.** Contrast, focus order and reduced-motion
  behaviour on Fauna were not probed. Our own floors (4.5:1 text, 3:1 control,
  SC 2.2.2) are unaffected by anything in this document.

---

## 6. Standing constraints this research does not override

Unchanged, and none of the above bends them: no invented balances, no Chinese
KYC, no replacing the human-review contract, no UI copying — layout ideas and
information hierarchy only, never branding or artwork. **Collector imagery stays
labelled illustrative.** Reference search only.
