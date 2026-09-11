# Continuous logo choreography — independent QA

**Local release verdict: PASS. No blocking finding.** Reviewed independently of the feature author against `logo-continuous-choreography-2026-09-09.md`. Root separately approved the full-frame composition, including the partial-letter frame at 2.55 seconds. This supersedes the earlier stepped-logo motion acceptance; the dashboard was not retested.

## Commands and measured results

Run from `C:\Users\user\pw\ui-integrate`:

- `node apps/console/scripts/logo-continuity-independent-qa.mjs`: PASS. 32 unique original paths; five semantic families, counts 9/6/6/6/5. 320 interior waypoint checks at ±1 microsecond: maximum position span 0.001660 SVG units and one-sided derivative disagreement 0.025449. Positive finite scale throughout 240 Hz sampling; strictly increasing waypoint times; every final pose exactly x/y/rotation 0 and scale 1. Geometry identity hash: `a8e071870f39b7a1aa40d40b333ef0f8a0f64622cd3dad926dc91532eda49c40`. Original piece/master files have no changes in this motion batch.
- `node apps/console/scripts/logo-continuous-browser-qa.mjs`: PASS on existing Vite 5190. Six widths: 375, 430, 768, 1024, 1440, 1920. 77 deterministic timeline samples each: no piece outside the viewport. Six full-viewport screenshots each cover unfold, crossing/wide formation, compression, release/sweep, partial lettering, and exact lock. Debug outlines are diagnostic, not production seams or brand color.
- Debug controls: paused geometry remains stable; family isolation shows precisely six clockwise pieces; normal/quarter-speed controls advance from 0.30 to 1.12/0.50 seconds over approximately 800 ms. Scrubbing backward restores black fill. Final docking differs from the navigation target by less than 0.041 px.
- First visit plus two ordinary reloads, without query parameters: each mounted 32 black pieces with zero debug controls and completed. Navigation-to-completion including development page load measured 4.318–4.684 seconds; authored geometry is 3.2 seconds and the timeline including color/docking is 3.8 seconds. The startup fail-open budget is 6500 ms.
- Skip, Escape, resize, runtime reduced-motion change, and initial reduced-motion preference all restore root/body overflow, reveal navigation, and clear the intro/story gate. Reduced motion creates no visible intro. No page errors.
- `pnpm -F @playerone/console build`: PASS, 285 modules, 9.13 seconds. Existing large-chunk advisory remains; no build error. No broad test-suite rerun for this isolated motion change.
- `node apps/console/scripts/logo-production-independent-qa.mjs`: PASS against an ephemeral local static server serving the actual built `apps/console/dist`. Production ignores `logoDebug=1`, `logoReplay=1`, and `logo-intro=debug`: 32 paths, zero debug controls, zero piece labels, no debug attribute. Keyboard Tab remains on Skip. Natural completion, explicit SPA route unmount to `/login`, and deliberately aborted motion-chunk import all restore overflow/focus and clear the intro. No page errors. Server and browser closed.

## Evidence

Raw results: `scratchpad/qa/logo-continuous/{continuity,browser-results,production-results}.json`.

Representative full-frame captures:

- `scratchpad/qa/logo-continuous/1440-1.25.png`: wide crossing formation.
- `scratchpad/qa/logo-continuous/375-1.65.png`: mobile compression.
- `scratchpad/qa/logo-continuous/1440-2.55.png`: partial letters, no cropped right edge.
- `scratchpad/qa/logo-continuous/production-natural-1440.png`: natural production frame with no debug decoration.

The evaluator supplies continuous tangents rather than independent stop/start tweens. The master clock is the only owner of piece transforms; measured SVG pivots and immutable geometry remain intact. Fill stays black through assembly and changes on those same pieces before docking. Screenshots and mathematical sampling support bounded composition/continuity; they do not establish physical-device 60 fps. Mobile captures used 900 px height and larger widths 1000 px height.

## Final cloud acceptance

**PASS**, successful deployment `b7f50c70-1dc4-42e0-b5eb-48ffcec09644`, checked at `https://playerone-web-production.up.railway.app/discover` using `node apps/console/scripts/logo-continuous-cloud-qa.mjs`.

- Health HTTP 200, `ready:true`.
- First visit, ordinary reload, and production debug-query request completed with `logoPlayed=true`. Mounted-to-complete observations: **3.984 / 3.963 / 3.909 seconds**, including initialization and sampling overhead around the authored 3.8-second timeline.
- Each run retained 32 pieces across 128 samples; 106–109 distinct transform states. Initially black; first color appeared 3.219–3.320 seconds after mounting. No debug controls, piece labels, or debug attribute, including `?logoDebug=1&logo-intro=debug`.
- Each handoff cleared the story-pending gate and restored document overflow. The real opening MP4 was playing, readyState 4, with currentTime 2.286 / 0.575 / 0.594 seconds at the observations. No page errors.
- The initial probe waited solely for `data-film-revealed=true` and timed out. The bounded diagnostic rerun measured actual playback: the first visit lacked that marker while pending was cleared and the film played; ordinary reload and debug-query runs had the marker. This matches the existing story fail-open behavior and did not block the handoff. Do not interpret a missing marker alone as a failed video.

Evidence: `scratchpad/qa/logo-continuous/cloud-results.json` and `cloud-natural-1440.png`. All browser contexts closed. No authentication, dashboard, review, or financial mutation checks were repeated for this logo-only deployment.
