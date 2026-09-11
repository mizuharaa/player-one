# Style-tile / reference review — 2026-09-09

Independent design input. **Not an acceptance audit.** No UI edited, no route
audited, no merge, no database operation, no server started. The landing route
is still building and was deliberately not inspected.

Browser work went through `withBrowser` / `newPage` from
`apps/console/scripts/browser.mjs`. The Butter pass used `motion: true`
deliberately — observing motion was the point — and was the only motion-enabled
context; it was closed in a `finally`. Screenshots in the session scratchpad
under `scratchpad/butter/`.

---

## 1. Butter (https://www.butter.video) — observed, not described

Measured from the live page at 1440×900.

| Property | Observed value |
|---|---|
| Ground | near-white, effectively flat |
| `h1` | `107.57px`, weight **400**, letter-spacing `0.34px`, line-height `106.71px` (≈0.99), colour `rgb(15,15,15)` |
| `<video>` elements | **49** on one page |
| Video attributes | `autoplay: false`, `loop: true`, `muted: true` |
| `<canvas>` | 1 |
| Document height | 14,298px against a 900px viewport (~15.9 screens) |

### Illumination language
The ground is a **flat, shadowless near-white**. There is no page-level gradient
or vignette. All apparent light lives *inside the artefacts*: the hero's 3-D
keyring objects carry their own specular highlights, contact shadows and colour
bounce, and they float on a plain field with no cast shadow onto the page. The
result reads as **studio product photography on seamless paper** — light belongs
to the object, never to the layout.

This is directly transferable and cheap: our page does not need lighting
effects, it needs *lit subjects* on an unlit ground.

### Motion language
- **Nothing autoplays.** All 49 videos are `autoplay: false`, `loop: true`,
  `muted: true` — they are started by intersection or interaction, not on load.
  With 49 clips this is a deliberate cost decision, and it is the opposite of
  our current single hero video that plays regardless.
- **Motion is per-artefact, not per-page.** Each tile animates inside its own
  frame. The page itself does not move, slide, or parallax.
- **Type weight 400 at 107px.** The display is set *light for its size* and the
  presence comes from scale and near-1.0 leading, not from weight. Our current
  display runs heavier at large sizes.
- **Scroll-dependent disclosure is real here.** At 50% scroll the mid-page
  screenshot showed large empty regions where sections had not yet revealed —
  content that a programmatic scroll reaches before its trigger fires. Worth
  noting as a caution, not a compliment: it means a fast scroller or an
  automated reader sees blank bands.

**Verdict for us:** Butter's restraint is in the *page*, and its energy is in
the *objects*. That is the same conclusion the Flim direction reached from a
different angle, and it corroborates keeping the ground quiet.

---

## 2. Local style tile — NOT INSPECTED

`http://127.0.0.1:5190/style-tile.html` returned **HTTP 000**. The console dev
server is not running on this machine right now (it was up earlier today; it
died with the previous session). Nothing was inspected and no finding about the
board is recorded here.

To make it inspectable, the console dev server needs to be running; I have not
started one, per instruction.

---

## 3. New work photographs — independent asset inspection

`apps/console/public/discover-media/20260909/`

| File | Size |
|---|---|
| `work-wide.webp` | 153 KB |
| `work-portrait.webp` | 254 KB |
| `work-detail.webp` | 138 KB |
| `pov-landscape.webp` | 423 KB |
| `pov-portrait.webp` | 449 KB |
| `opening.mp4` | 2,154 KB |
| `opening-poster.webp` | 27 KB |

I opened `work-wide.webp` and `work-detail.webp` in full.

**These are the first assets in this project that do not contradict the
product.** In both, the device sits **across the forehead, above the eyebrows,
with the eyes fully clear** — the geometry that every previous asset got wrong.
`work-wide` shows a visible green indicator LED. Both show two lens housings on
the front face.

Other properties worth recording:
- **Setting is plausible and lived-in** — a real kitchen with a stained concrete
  wall, mismatched crockery, a cloth on the counter; a workshop with shelving,
  baskets and a part-packed carton. Neither reads as a stock set.
- **Expressions are restrained.** Both subjects are looking down at the work,
  not at camera, not smiling. This is the specific quality every earlier
  generated asset failed.
- **The action is genuine work** — washing greens, packing a box — and the hands
  are doing it, not posing with it.
- **Both are third-person.** Neither may be captioned as a POV recording or as
  something the camera made. `work-detail` is close enough that the temptation
  will exist; the rule still holds.

**One thing I could not verify:** whether the device geometry matches the real
Ego unit in detail — housing proportions, strap width, LED placement. I compared
against the owner's photograph of the physical device from memory of this
session, not side by side. Someone with the hardware should confirm before these
are treated as product-accurate rather than product-*consistent*.

---

## 4. Three actionable findings

**F1 — Do not autoplay the hero film; gate it on intersection.**
Butter runs 49 clips with `autoplay: false, loop: true, muted: true` and starts
them on demand. We run one clip that plays regardless. Our page already carries
a known cost problem (GSAP idling at 64.2 rAF/s measured on `/discover`), and an
always-playing decode adds to it on exactly the phones our collectors use.
*Action:* start the film on intersection, keep `muted` + `loop`, and keep the
poster as the resting state. Cheap, and it makes the opening sequence's third
beat honest — the reveal shows something that has just started, not something
that has been running unseen.

**F2 — Put the light in the subject, not in the layout.**
Butter's ground is flat and shadowless; every highlight belongs to a lit object.
The new work photographs already have this property — real window light, real
falloff. *Action:* keep the page ground unlit and let these photographs carry the
illumination. Specifically, do not add page-level gradients, glows or vignettes
to compensate for a quiet ground; that is the failure mode that produced
"monotone and 0 colors" being answered with decoration rather than with subjects.

**F3 — Set the display face lighter as it gets larger.**
Butter's `h1` is **107.57px at weight 400** with leading 0.99. The presence comes
from scale, not weight. This matches the optical-weight rule already in our
`.headline` classes but the reference is more extreme than our current setting.
*Action:* when the new direction sets type at Butter-scale, take the weight down
rather than up, and hold leading near 1.0. Verify Vietnamese stacked diacritics
at that leading — `ề`, `ậ`, `ữ` need vertical room, and 0.99 leading on a Latin
reference is not automatically safe for `vi`. This is measurable before it is
argued about.

---

## 5. Correction to my earlier report — collector API table was WRONG

`docs/design/claude-qa-status-2026-09-09.md` claimed our collector API had only
six routes and that task hall, claims and device pairing had no backing. **That
was false, and the way it was false is worth recording.**

`packages/api/src/collector-app.ts` contains **four literal NUL bytes**, the
first at offset 18131, inside a deliberate composite map key:

```js
profile.agreements.map((a) => [`${a.agreement}\0${a.version}`, a.accepted_at])
```

A `\0` separator is a legitimate technique — it cannot collide with a real
agreement id. But `grep` classifies any file containing NUL as **binary and
skips it**, emitting one `Binary file … matches` line. I read past that line and
published the resulting partial scan as the API surface.

**Corrected: 17 routes are served, and the collector client consumes them all.**

```
/api/me/            /api/me/claims       /api/me/profile    /api/me/tasks
/api/me/agreements  /api/me/devices      /api/me/register   /api/me/tasks/:id
/api/me/episodes    /api/me/exam         /api/me/sessions   /api/me/tasks/:id/claims
/api/me/income      /api/me/training     /api/me/uploads    /api/me/uploads/:id
                                                            /api/me/uploads/:id/complete
```

So **task hall, claims and device pairing all have real backing.** Only two rows
of my original table survive re-verification:

- **No wallet/balance route.** `/api/me/income` is history.
- **No KYC route.**

Both re-checked against the corrected binary-safe scan.

**Trap worth adding to `CLAUDE.md`:** a source file containing a NUL byte is
silently skipped by `grep`, so any capability inventory built with `grep` can
report an absence that does not exist. Use `grep -a`, or verify the file count
scanned. This is the same class as the corpus trap already recorded — a green
result that was actually a skip.

---

## 6. Standing constraints, unchanged

No invented balances. No Chinese KYC flow. No replacing the human-review
contract. Reference search only — layout ideas and information hierarchy, never
branding or artwork.

Awaiting build handoff before any acceptance work.
