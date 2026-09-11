# Claude independent measured pass — /discover — 2026-09-09

**Not an acceptance certificate.** These are measurements taken against the
frozen tree at this step. Every number below was observed by this session; none
is quoted from a builder or from an earlier step. No UI edited, no database
written, no server started, no commit.

Browser work was serialized through `withBrowser` / `newPage`
(`apps/console/scripts/browser.mjs`), one context at a time, contexts closed per
case so `sessionStorage` from one visit never contaminates the next.

Probes left in the repo for re-running any of this:

- `apps/console/scripts/logo-intro.mjs` — `stages | purity | lifecycle`
- `apps/console/scripts/discover-final.mjs` — `opening | locale | menu | demo | reentry`

---

## Gates — my own numbers

Source last modified 16:41:40–16:42:05; gates run **after** that.

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit -p apps/console/tsconfig.json` | **exit 0** |
| `env -u DATABASE_URL npx vitest run apps/console packages/design` | **11 files / 169 passed / 0 failed / 0 skipped**, started **16:47:52** |

CSS-only changes after this point were rechecked visually and were explicitly
**not** re-gated, by owner direction.

---

## Method note — the axis that matters

Motion cases gate on the application's own signals: `.discover-page` mounted,
then `data-logo-complete === 'true'`, then `data-story-pending` cleared. They do
**not** gate on elapsed time and do **not** gate on DOM absence.

This is not pedantry. Two false readings on this route came from the wrong axis:
an early report that "the opening never completes", measured by wall clock on a
scroll-driven beat; and a later report that the automatic hero was still broken,
measured with `waitUntil:'commit'` plus a detached-selector wait, which is
satisfied before React has mounted anything. Both were retracted. Stage sampling
of the intro uses the `?logoDebug=1` slider, which pauses the timeline at an
exact progress value.

---

## Automatic hero — PASS

Requirement: the film appears automatically in the first viewport after a finite
intro, with no scroll.

| Width | film top | source | paused | currentTime | overflowX | headings in first viewport |
|---|---|---|---|---|---|---|
| 375 | **0** | `opening.mp4` | false | 0.045 → 1.551 | 0 | 1 |
| 430 | **0** | `opening.mp4` | false | 0.045 → 1.556 | 0 | 1 |
| 768 | **0** | `opening.mp4` | false | 0.000 → 1.506 | 0 | 1 |
| 1024 | **0** | `opening.mp4` | false | 0.027 → 1.540 | 0 | 1 |
| 1440 | **0** | `opening.mp4` | false | 0.205 → 2.222 | 0 | 1 |
| 1920 | **0** | `opening.mp4` | false | 0.050 → 1.563 | 0 | 1 |

Layout confirms it structurally at 1440: `.discover-opening` top 0 height 900,
film `position:absolute` top 0 with `transform: none`, slogan translated to −720
and out of the way. `readyState` 4. Network shows exactly one movie request,
`opening.mp4`.

### What this replaced

Before the correction, measured at 1440 with motion enabled and sampled four
times against intro teardown (+200 / +800 / +1600 / +3000 ms, stable across all
four): film wrapper animated 1800 → 1489 → **900** and stopped on a 900px
viewport, `currentSrc` was **empty**, `paused` true, and **zero** `.mp4`/`.webm`
requests were made. The first viewport contained the nav pill and nothing else.
The empty source was a downstream symptom: the film sat below the fold, so its
IntersectionObserver never fired and `preload="none"` never attached bytes.

Raw evidence kept at `scratchpad/qa/D-D-auto-hero-evidence.md` with the probe at
`scratchpad/qa/hero-probe.mjs`.

---

## Logo assembly phases — PASS

Sampled deterministically via the `?logoDebug=1` slider. Stage boundaries are
derived from `logoMotion.ts`, not estimated: unfold 0.25–0.73s, assembly
0.61–1.69s, settle 1.70s, dock 1.74–2.30s, ink lift 1.82–2.36s. **2.36s total
corroborates the stated figure by arithmetic from source.**

| Stage | progress | piece spread | outside mark box | overlapping skip control |
|---|---|---|---|---|
| compact | 0.0636 | **101 × 64** | 0 | 0 |
| primitives | 0.2839 | 502 × 134 | 0 | 0 |
| assembled | 0.7288 | 1075 × 168 | 0 | 0 |
| docked | 0.995 | 128 × 20 | 0 | 0 |

**32 paths and 0 `text`/`tspan` at every stage.** The 32 `<title>` elements are
debug-only and are absent outside `?logoDebug=1`. Overlay is
`role="dialog" aria-modal="true" aria-label="PlayerOne"` at `z-index: 999`. Skip
control is localized (*"Bỏ qua phần mở đầu"*).

Before the origin fix, 11 of 32 pieces measured fully outside the mark box at the
compact stage and 13 at the intermediate stage, with fragments overlapping the
skip button — the two discs did not cover the colocated fragments as the source
comment claimed.

**Retracted:** an earlier report of hairline seams inside the assembled glyphs was
measured in `?logoDebug=1`, where deliberate 0.7px per-piece outlines are drawn.
That was my error, not a product defect.

### y-junction geometry

Master regenerated: `y-right` is now `M353 58h18l-26.511628 60h-18Z`, collinear
with `y-tail` at 18-unit width. Rendered from the canonical
`playerone-wordmark.svg` at ~7.1× — deterministic, no animation in the path — the
descender junction is continuous. Residual step is about 2px at that zoom,
**≈0.3 master units ≈ 0.42px at the 1100px hero render**, below one device pixel
at 1× DPR. Not a visible defect.

---

## Lifecycle — PASS

| Check | Measured |
|---|---|
| Once-per-session | first visit intro **yes**, reload **no**, fresh context **yes**; `sessionStorage['playerone:logo-assembly:v1'] = "1"` |
| Repeat visit | no intro, film top **0**, `opening.mp4`, `paused: false`, 1 heading — straight to the playing film |
| Reduced motion | no intro, **0** movie requests, 1 heading, 2 CTAs in the first viewport |
| Escape | scroll lock `hidden` → `visible`, scrolling restored, no focus left in detached intro |
| Resize | same |
| Document navigation | same |
| First paint locale | `lang="vi"` from the earliest sample; the earlier English flash is gone |
| Saved locale | no key in `localStorage`; unsaved defaults to VI as specified |

---

## Idle tail — PASS

Fresh document, motion enabled, sampled past 8 seconds, two consecutive 3-second
windows: **0.0 rAF/s and 0.0 rAF/s.**

Trajectory across this sprint: 64.2 → 17 (mis-sampled during the settling window,
corrected) → 4.0 attributed 100% to GSAP by stack-wrapping `requestAnimationFrame`
→ **0** after the duplicate `ScrollTrigger.enable` was removed.

---

## Menu, demo, re-entry — PASS

**Menu at 375:** Enter opens a real `:modal` `<dialog>`; `aria-expanded`
false → true → false; 5 links; focus enters the dialog; Escape closes it;
**focus returns to `.discover-menu-button`**.

**Demo workflow:** browse → details → prepare → ready → back, complete. Focus
lands on the step `<h3>` at every transition. The prepare CTA is **disabled until
both selects are answered**, then enables. Progress fills 2 → 3.

**Re-entry:** heading visible at scrollY 0 / 2000 / 5000 / 6776 and again on
return to 0; **0 hidden headings at any depth**. The film **pauses offscreen**
(`paused: true` at all three depths) and **resumes at the top**. Autoplay after
the finite intro and the pause-offscreen policy both hold, which is the owner's
explicit decision and supersedes the earlier intersection-gating recommendation
carried over from the Butter reference.

---

## Responsive — PASS

375 / 430 / 768 / 1024 / 1440 / 1920, reduced motion: **0px horizontal overflow
and 0 clipped text nodes at every width.**

The collector wall reflows rather than shrinks — 375 stacks at 375×288 /
375×417 / 375×280; 1440 gives 792×432 / 648×1008 / 792×576; 1920 gives
1056×576 / 864×1344 / 1056×768 — unequal at every step. Review theatre holds ink
`rgb(23,25,27)` at all widths with height reflowing 533 → 1381. Coverage keeps 4
tracks throughout. The aperture is `.discover-aperture`, **729 × 729 at
`border-radius: 999px`**, an ink disc on lavender `rgb(222,216,243)`.

---

## Locale — PASS

vi / en / zh at 375 and 1440: **0 clipped text nodes and 0px horizontal overflow
in all six combinations.** `lang` resolves to `vi`, `en`, `zh-Hans` respectively,
read from `localStorage['playerone.locale']` (not a query parameter).

---

## Contrast — bounded, one target per surface

Measured on rendered pixels, current classes only. No obsolete-selector sweep.

| Surface | Ratio | Size / weight |
|---|---|---|
| Nav link | 17.63:1 | 11.68px / 400 |
| Aperture label | 17.63:1 | 10.4px / 400 |
| Review explanation | 17.63:1 | 14.4px / 400 |
| Coverage result label | 12.78:1 | 12.8px / 400 (ink on lavender) |
| Footer link | 17.63:1 | 10.4px / 400 |
| Primary CTA | 17.63:1 | 14.4px / 600 |
| Film label | 17.63:1 | 10.4px / 400 |
| Collector label | **6.32:1** (lowest) | 11.2px / 400 |

All pass the 4.5:1 text floor. Control boundaries measured earlier at a lowest
3.67:1 against the 3:1 floor (WCAG 1.4.11) — a measured pass, on an opaque ink
ground, not a photographic one.

---

## Product truth — verified present

- Collector wall carries **"AI-generated illustrations, not actual collectors or
  collected data."** (`.discover-image-label`)
- Film carries **"Illustrative film · external view, not footage recorded by Ego"**
- Demo carries **"Interactive demo · illustrative data"**
- Three genuinely different photographs; no single film dressed as a gallery.
- No invented balances, no KYC flow, no automatic review outcome anywhere in the
  rendered copy.

---

## Demo example and disclosure text — rechecked, PASS

The CSS-only 12px floor was extended to demo badge, device small, task small,
POV caption and footnote. Targeted recheck (locale probe at 375 and 1440 across
vi / en / zh, plus the full demo workflow) measured after the freeze:

| | before | after |
|---|---|---|
| Leaf text nodes under 12px @ 375 | 17 (smallest `discover-demo-badge` **8.8px**) | **11** |
| Leaf text nodes under 12px @ 1440 | 6 (smallest 9.44px) | **1** (`P` at 11.2px) |
| Clipped text nodes | 0 | **0** |
| Horizontal overflow | 0px | **0px** |

Every demo-surface class named in the change is gone from the under-12px set —
`discover-demo-badge` and `discover-demo-footnote` no longer appear at either
width. The demo workflow is unchanged and still passes: browse → details →
prepare → ready → back, focus on the step heading at every transition, CTA
disabled until both selects are answered, progress filling 2 → 3.

### Residual, recorded not raised

At **375 only**, 11 leaf nodes remain under 12px. These are outside every named
scope so far and are reported as a measurement, not as a gate:

- **`discover-coverage-result-label` at 9.28px** — the coverage surface was never
  in a 12px scope, and this label scales responsively from 12.8px at 1440 down to
  9.28px at 375. It carries payment-coverage wording, so it is the one worth a
  look.
- Unclassed `span` at 10.4 / 10.56 / 11.52 / 9.28px and `p` at 10.4 / 11.36px.
- At 1440 the only survivor is a `p` at 11.2px.

Identical counts across vi, en and zh at both widths, so this is layout scaling,
not a locale effect.

## Measured limitations — what this pass does NOT cover

1. **Same-document SPA cleanup is untested.** `page.goto` creates a new document
   and cannot prove timeline or listener teardown within one document. The only
   same-origin nav target is `/login`, itself a document navigation. What is
   verified is **navigation restoration**, not SPA cleanup. No router route was
   invented and no application code was edited to create a test path.
2. **Dark scheme is unmeasured** at every width.
3. Phase and dock captures were taken at 1440 only; the opening was measured at
   375–1920; the six-width sweep was reduced motion.
4. Contrast is 8 bounded targets, not an exhaustive sweep.
5. **No physical device.** Nothing here is evidence about real hardware, and no
   production claim is made.
6. **The native lane closed as source-only.** F1/F2/F5/F6/F7/F12 predicates were
   verified by reading source with `tsc` exit 0 and 42/42 collector tests, but
   **no renderer is installed**, so no rendering claim has a test behind it. F12's
   `toSizeBytes` was exercised by the author across 11 mocked-wire cases that were
   not persisted as a suite; that evidence distinction is preserved deliberately.

Builders do not self-certify. Nothing above is a pass unless this session
measured it at this step and named the number.
