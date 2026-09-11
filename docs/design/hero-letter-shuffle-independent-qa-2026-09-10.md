# Hero letter shuffle — independent QA, 2026-09-10

Result: PASS on local frozen source at http://127.0.0.1:5190. Browser closed. No product files edited. This replaces the previous SVG entrance acceptance; no authentication/backend tests were repeated.

Commands:
- `node node_modules/vitest/vitest.mjs run apps/console/src/components/logo-animation/hero-shuffle-independent.test.ts` — 1/1 passed.
- `node apps/console/scripts/hero-shuffle-independent-qa.mjs` — exit 0; three motion runs and three lifecycle/navigation cases passed.
- `node apps/console/scripts/hero-shuffle-hold-qa.mjs` — exit 0 with RAF polling for the brief hold state.

1440 first visit/reload and 375 first visit: nine A–Z decorative slots, accessible heading `PLAYER ONE`, no SVG within the heading and no blocking logo overlay. Measured slot width drift and horizontal drift were both 0px throughout the animation. First observed completion was 2320.8 / 2327.8 / 2331.3ms; these include frame sampling delay around the 2300ms timeline. PLAYER locked before ONE. Samples from 1900ms onward contained the final letters; word geometry changed 0px at the hold-to-natural-text handoff and stayed unchanged after completion. No page errors.

Numeric independent checks cover all scheduled early intervals 45–65ms, late intervals 80–110ms, correct nine letters/order, 120ms lock settling from +3px to zero, and final values unchanged through 10 seconds. The earlier first-interval 70ms and downward lock issues were corrected by the implementation owner before these passing results.

Reduced motion rendered the final heading immediately without a start timestamp. Navigation was clicked at 14.9ms after animation start and reached #demo. Starting at #demo deferred the shuffle until the hero intersected; resizing 1440?375 during the timeline and leaving/re-entering after completion did not restart it or produce horizontal overflow. Font readiness and observer cleanup were also inspected in source. The intentional pre-font final-text fallback is distinct from elapsed timeline completion.

Evidence: `scratchpad/qa/hero-shuffle-independent/results.json` contains frame-by-frame geometry/state. Screenshots: `1440-0-playing.png`, `1440-0-complete.png`, `375-0-playing.png`, `375-0-complete.png`. `1440-hold.png` was requested when RAF observed hold; screenshot completion occurred after transition to complete, so recorded frame data is the precise hold timing evidence.

Probe limitations: headless sampling does not certify physical-display frame rate. An initial screenshot-only hold locator missed the short state and timed out; RAF polling succeeded. Initial assertions also incorrectly counted the intentional pre-font complete fallback as timeline completion; corrected predicates require a non-null elapsed time >=2300ms. These were probe corrections, not application defects. Public deployment acceptance remains pending a new deployment signal.

Public acceptance: PASS — deployment `39d7fb37-86e9-43e5-9f3b-8bc131bc77d2`, independently observed SUCCESS with `npx --yes @railway/cli deployment list --service playerone-web --environment production --limit 1 --json` before testing.

`node apps/console/scripts/hero-shuffle-public-qa.mjs` exited 0. Actual public origin `https://playerone-web-production.up.railway.app`: 1440 normal first visit and ordinary reload observed completion at 2319.3/2323.7ms. Both retained zero slot width/x drift and zero word geometry drift at handoff; final text held still after 1900ms and after completion. Correct ordered locks, nine A–Z slots and accessible label passed. 375 reduced motion showed immediate final text without a start timestamp. Public early navigation worked while state was ready, before the font-gated clock started. No page errors, console errors or CSP violations; public CSP header present. `/healthz` returned 200 and `ready:true`.

Public evidence: `scratchpad/qa/hero-shuffle-independent/public/results.json`, `1440-0-complete.png`, `1440-1-complete.png`, `375-reduced-complete.png` and the corresponding normal playing captures. Final desktop/mobile captures visually inspected. All browser contexts closed. No authentication, financial or other backend mutations performed.
