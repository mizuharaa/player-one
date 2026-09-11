# Claude independent web acceptance — /discover — 2026-09-09

**Not an acceptance pass.** Concrete defects for the builder, plus what I
verified and what I could not. No UI edited, no database written, no server
started, no commit. Browser work serialized through `withBrowser`/`newPage`,
one context at a time.

Measured against the **frozen correction batch** unless a row says
`[pre-batch]`.

---

## Measurement boundary

| | |
|---|---|
| Tree | `HEAD = fc84a98` + **28 modified tracked files** — implementation is uncommitted working-tree state |
| Server | single builder-owned Vite on `127.0.0.1:5190`. I started nothing. |
| Routes | `/discover` 200, `/style-tile.html` 200 |

---

## Gates I ran myself

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit -p apps/console/tsconfig.json` | **exit 0** — corroborates the author's `tsc 0` |
| `env -u DATABASE_URL npx vitest run apps/console packages/design` | **11 files, 169 passed, 0 failed, 0 skipped** |
| `rhythm.mjs` `/discover` en @ 1440/1280/390 | **8 findings** (was 32 `[pre-batch]`) |
| `contrast.mjs` light/1440/en | lowest text **6.32:1**, lowest control **3.67:1** |

---

## RETRACTION — my "opening never completes" reading was wrong

I reported that the opening was stuck on beat 1 because the viewport still
showed only the slogan at 2.6s and again at 6.5s. **That was the wrong axis.**
The opening is scroll-driven by design; elapsed time proves nothing because I
never scrolled. Re-measured by scroll progress, it behaves as specified.

**Desktop 1440×900, forward:**

| scrollY | slogan | nav | video | CTA |
|---|---|---|---|---|
| 0 | on, op 1 | present, **covered** | – | – |
| 450 (0.5vh) | off, op 0 | uncovered | – | – |
| 900 (1vh) | off | uncovered | **on** | – |
| 1800 | off | uncovered | on | **on** |

Film reveals at ~1 viewport, matching the handoff's "~0.9 viewport". **Reverse
restores exactly**: back at y=0 the slogan returns at opacity 1 and the nav is
covered again. Mobile follows the same progression with the film at 844 and the
CTA at 1266.

Desktop nav being covered at y=0 is the owner's explicit slogan-only request and
is **not** reported as a defect.

---

## Defects

### D-1 — Mobile first viewport has no scroll cue
**Severity: MEDIUM. Source:** mobile hero at 390×844, `scroll0` capture.
**Evidence:** The first viewport shows persistent nav (brand + hamburger), the
slogan, and one primary CTA ("Khám phá bản demo"). That matches AGENTS.md §2 on
three of four points. The fourth — *"A subtle scroll cue"* — is **absent**.
Everything below the fold is reached only by scrolling, and nothing indicates
that. **Exact validation:** load `/discover` at 390×844, do not scroll, confirm
a visible scroll affordance exists in the first viewport.

### D-2 — Five off-scale vertical gaps remain
**Severity: LOW–MEDIUM. Source:** `rhythm.mjs`, frozen batch.
**Evidence:** 32 → 8 findings; 3 are D-4 (non-defect). Remaining:

| gap | count | between |
|---|---|---|
| 112px | 2 | `div.discover-footer-top` → `div.discover-wordmark` |
| 56px | 2 | `h2.discover-heading "Seen by a person…"` → `div.discover-review-layout` |
| 18px | 1 | `div.discover-stream` → `div.discover-stream` |

Enforced scale is `[2,4,6,8,12,16,20,24,32,40,48,64,80,96,128]`. 112 and 56 are
composites (96+16, 48+8) and may be intended; **18px between two adjacent
`.discover-stream` items is the one that reads as drift.** If 112/56 are
deliberate, add them to `SCALE` rather than leaving the audit noisy.
**Exact validation:** `MSYS_NO_PATHCONV=1 CONSOLE_URL=http://127.0.0.1:5190 ROUTES='/discover' node apps/console/scripts/rhythm.mjs`

### D-3 — Idle rAF is 17/s, not 0
**Severity: LOW. Source:** measured in-page with a `requestAnimationFrame`
counter, both viewports, motion enabled, page idle.
**Evidence:** **17 rAF/s** at 1440×900 and at 390×844. Down from **64.2** — a
real improvement — but not zero. A landing page that never stops scheduling
frames still costs battery on the phones collectors use.
**Exact validation:** wrap `requestAnimationFrame`, load `/discover` with
motion enabled, leave it untouched 3s, divide the count.

---

## Verified and passing

| Check | Result |
|---|---|
| **Only the selected POV aspect is requested** | Desktop requests `pov-landscape.webp`; mobile requests `pov-portrait.webp`. Never both. **PASS** |
| **Reduced motion requests no movie** | `reducedMotion: 'reduce'` → **0** `.mp4`/`.webm` requests. **PASS** |
| **No hidden media while pending** | Motion-on first load requests 5 files, all stills/posters. No film fetched before its reveal. **PASS** |
| **Heading visibility** | 9 headings; **0 hidden at settle**, **0 hidden after reverse scroll**. **PASS** |
| **Reverse restores state** | y=900 → y=0 returns slogan to opacity 1 and re-covers nav. **PASS** |
| **Control boundaries** | Lowest measured **3.67:1** against a 3:1 floor (WCAG 1.4.11) — **measured pass**, pending broader sampling. Nav is opaque ink, not photographic. |
| **Text contrast** | Lowest **6.32:1** (`#575C5D` on `#F7F7F4`) against a 4.5:1 floor. Headings 16.42:1, wordmark 17.63:1. **PASS** at light/1440/en |
| **Mobile hero composition** | Persistent nav + one headline + one primary action. **PASS** except D-1 |

---

## D-4 — Not a product defect: decorative overscan

The three `CLIPPED` rows all name `div.discover-demo-scene`. From source:
`.discover-ambient-light` is `position:absolute; inset:-15%; pointer-events:none`,
contained deliberately by `overflow:clip` on the parent. No text or control
overflows. **Root's read confirmed independently.** `rhythm.mjs` cannot yet
distinguish a decorative absolutely-positioned layer from clipped content —
recorded, **not suppressed**, because a mute would hide real clipping later.

---

## Defects in MY tooling, found and fixed (no product code touched)

### T-1 — `contrast.mjs` selector table was stale and hung the shared lock
The table addressed `[data-band=*]`; the rebuilt page has none. Playwright
locators auto-wait, so zero matches **blocked** rather than threw — one run held
the browser lock ~9 minutes before being killed. `inkRatio` now calls `count()`
first and **throws by name**; the `/discover` text and control tables were
rebuilt against shipped classes. **No suppressions added** — a missing selector
is reported as a probe failure.

### T-2 — `contrast.mjs` also needs `MSYS_NO_PATHCONV=1`
Without it, Git Bash rewrote `ROUTES=/discover` and the probe announced
`=== C:/Program Files/Git/discover ===` then `TypeError: TEXT[route] is not
iterable`. Known for `rhythm.mjs`; **undocumented for `contrast.mjs`.**

---

## Not yet measured

- `LOCALE=vi` / `LOCALE=zh` coverage for both probes — **both default to English
  and neither locale has been measured.** Vietnamese diacritics and CJK put ink
  where the Latin sample has none. *(Note: the page renders vi by default, so the
  captures above are Vietnamese glyphs measured under an `en` context — the
  probes' own `LOCALE` switch is still unexercised.)*
- Compact widths below 390.
- Dark scheme at any width.
- Menu keyboard path (open/close/Escape/focus return) and media-failure
  fallbacks.
- `style-tile.html`.
- Probe rows still unresolved: `.discover-demo-task-name`, `.discover-demo-field`
  (likely only exist after a demo step — the probe must drive the demo),
  `footer nav a`, and the two disabled APK controls which timed out. **Open probe
  gaps — explicitly neither passes nor failures.**

---

## Product-truth notes

- **POV wording accepted.** The prompt failed to produce *complete folding*; the
  films do lift/smooth/drape, which is why the example reads "Arrange clothes".
  Copy and footage agree.
- **New imagery is illustrative, not actual participants**, and must stay
  labelled as such wherever it appears.
- Standing: no invented balances, no Chinese KYC, no replacing the human-review
  contract.

Builders do not self-certify. Nothing here is a pass unless I measured it at this
step and named it above.
