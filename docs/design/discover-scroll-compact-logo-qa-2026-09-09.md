# Discover scroll stability and compact logo — independent QA

**Local verdict: PASS. No blocking finding.** Independent of both feature authors. This release supersedes the 3.8-second logo acceptance. Scope was `/discover` scrolling, heading/gallery stability, film handoff, and the new 1.6-second logo; no dashboard, authentication, API, or financial workflow rerun.

## Cause and implementation review

The scroll author reproduced the old failure: after a heading settled at opacity 1, idle followed by a 4 px scroll reset it to opacity 0 and y24, producing three nearly invisible frames. The gallery similarly restarted its whole-scene scale/y entrance. Independent source inspection confirmed repeated `onEnter`/`onEnterBack` callbacks killed/recreated those animations, while scroll wake globally re-enabled ScrollTrigger.

The frozen replacement removes ScrollTrigger and global ticker sleep/wake calls. An IntersectionObserver unobserves a heading before one bounded y10 entrance; opacity is never animated. Gallery and other scene scroll transforms are removed. Owned GSAP context/animations are cleaned up explicitly. The opening watchdog covers the logo handshake and clears hiding state on failure.

An initial inspection concern about dark hover text was withdrawn after reading the full CSS cascade: later light/inherit rules override the early dark-purple rule. It was not reproduced as a current defect. Actual rendered hover colors passed below.

## Independent commands and results

Run from `C:\Users\user\pw\ui-integrate`:

- `node apps/console/scripts/discover-scroll-independent-qa.mjs`: PASS at **375, 1440, 1920 × 900**. Real wheel travel through aperture, collector gallery, review theatre and FAQ; rapid larger reversals; then 1800 ms idle and a 4 px wheel plus small reversals. Sampling every 12 ms produced **287 / 281 / 277** observations: heading opacity stayed **1**, heading and scene transforms stayed **none**. All eight headings remained visible after settling.
- Actual navigation anchors, mobile menu, EN/ZH/VI changes, viewport resize and pointer hover/out passed. All three gallery images loaded; final image transforms returned to **none** and grayscale to **1**. The intended hovered image alone reached scale 1.025 and near-full color. At a 700 ms hover-out sample, the 720 ms CSS transition was still finishing; the subsequent final state was exact.
- Rendered aperture hover foreground/background: `rgb(255,255,255)` on `rgb(23,25,27)`, **17.63:1** contrast. Gallery captions: ink on `rgb(247,247,244)`, **16.42:1**, opacity 1 and no caption filter. Full viewport captures confirm the heading and image/text composition.
- Opening MP4 played at each initial viewport, readyState 4. Review MP4 played when reached. Both were paused and offscreen at the final gallery position. Settled requestAnimationFrame registrations over 1200 ms: **0 at all three widths**. No page errors. Reduced-motion pass: no intro, zero attached/playing movies, all eight headings readable. The Truc panel was not opened during this bounded scroll test.
- `node apps/console/scripts/logo-continuity-independent-qa.mjs --compact`: PASS. Same immutable 32-piece geometry SHA-256 `a8e071870f39b7a1aa40d40b333ef0f8a0f64622cd3dad926dc91532eda49c40`; exact assembly **1.05 s**, total **1.6 s**. 192 knot checks; maximum ±1µs position span 0.000865 SVG units and one-sided derivative discrepancy 0.02109; no invalid scales/nonfinite values/nonincreasing times/final-pose errors. Direct letter-slot registers replace orbits.
- `node apps/console/scripts/logo-compact-browser-qa.mjs`: PASS. 81 time samples each at 375/1440/1920: no off-viewport pieces. Root separately approved captured local-register composition. First visit and two ordinary reloads retained 32 pieces and completed in **1.730 / 1.716 / 1.765 s** including initialization; color first observed approximately 1.08–1.10 s. Reduced motion had no intro. No page errors.
- `pnpm -F @playerone/console typecheck`: PASS on frozen scroll/logo source.
- `pnpm -F @playerone/console build`: PASS, 283 modules, 10.51 s. Existing large-chunk advisory remains.
- `$env:QA_OUTPUT='scratchpad/qa/logo-compact'; node apps/console/scripts/logo-production-independent-qa.mjs`: PASS against the actual built page on a temporary static server. Production debug query flags yielded 32 paths, zero debug controls/labels/attribute. Tab remained on Skip. Natural finish, explicit SPA route unmount, and deliberately failed motion-chunk import restored overflow/focus and cleared pending state. No page errors. Temporary server and all browsers closed.

Two initial QA selector assumptions were corrected before successful reruns: mobile anchors require opening the real menu, and reduced-motion completion is verified from visible content/absent intro rather than requiring a callback dataset marker. These were probe failures, not product regressions.

## Evidence and limits

Raw measurements: `scratchpad/qa/discover-scroll/results.json`; `scratchpad/qa/logo-compact/{continuity,browser-results,production-results}.json`.

Representative captures:

- `scratchpad/qa/discover-scroll/1440-discover-aperture-section.png`
- `scratchpad/qa/discover-scroll/1920-discover-work.png`
- `scratchpad/qa/discover-scroll/375-discover-aperture-section.png`
- `scratchpad/qa/logo-compact/1440-0.35.png`
- `scratchpad/qa/logo-compact/1440-0.67.png`
- `scratchpad/qa/logo-compact/production-natural-1440.png`

These checks establish the reproduced flash regression, bounded lifecycle, and rendered state. Headless Chromium sampling does not certify physical-device 60 fps. Pointer-hover tests used a fine pointer at all viewport widths. The first defect reproduction was the author's; all post-fix results above were independently run.

## Final cloud acceptance

**PASS** on successful deployment `ffcbaa02-c913-448a-9762-078403bedd63`, `https://playerone-web-production.up.railway.app/discover`.

Command: `$env:QA_DEPLOYMENT='ffcbaa02-c913-448a-9762-078403bedd63'; node apps/console/scripts/discover-scroll-cloud-qa.mjs`.

- Health HTTP 200, `ready:true`; no page errors.
- At 1440 × 900, the exact aperture and gallery regression was repeated using real wheel movement after 2000 ms idle, including 4 px and rapid larger reversals. **84 + 90 samples** retained opacity **1** and heading/scene transforms **none**. All eight headings stayed visible; all three gallery images loaded with no scene transform.
- First visit, ordinary reload, and debug-query request retained 32 pieces, played to completion, and exposed no production debug controls/labels. Mounted-to-complete time was **1.968 s cold / 1.650 s reload / 1.656 s debug query**, including startup around the authored 1.6-second motion. First color was observed at 1.365 s cold and approximately 1.063 s on the subsequent runs.
- All three opening-film handoffs cleared pending and produced real MP4 playback with readyState 4 and currentTime greater than zero. The opening film paused offscreen at the gallery; the review film remained unloaded/offscreen in this bounded public check.
- Settled requestAnimationFrame registrations: **0 over 1200 ms**. Browser closed. No additional dashboard, authentication, locale, or financial sweep.

Cloud evidence: `scratchpad/qa/discover-scroll/cloud-results.json`, `cloud-discover-aperture-section.png`, and `cloud-discover-work.png`.
