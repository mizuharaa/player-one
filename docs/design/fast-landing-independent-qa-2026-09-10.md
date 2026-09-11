# Fast landing refinement — independent QA, 2026-09-10

Scope: phone-shaped interactive demo, flat task rows, numbered guidance, aligned footer and final monotone logo assembly. No product edits, authentication changes, backend writes or deployment performed by this reviewer.

## Local acceptance: PASS

- Impeccable mechanical layout scan: `node C:\Users\user\.agents\skills\impeccable\scripts\detect.mjs --scope layout --json apps/console/src/components/discover/DiscoverDemo.tsx apps/console/src/styles/discover-warm.css apps/console/src/routes/Discover.tsx` returned `[]`.
- `node apps/console/scripts/landing-fast-independent-qa.mjs`: **6/6 PASS**, widths 375/768/1440, EN and VI. Search/no-results, category filtering, selected detail focus, both explicit declarations, physical-camera instruction and reset work. No horizontal overflow, page errors or API mutations. The phone grows with copy and uses page scrolling; at 375 its initial height was about 789 px EN and 848 px VI. Task rows are equally sized at about 107 px. Desktop footer top and bottom column starts align exactly; the shared 32-path wordmark stays within its shell.
- `node apps/console/scripts/landing-heading-anchor-independent-qa.mjs`: real nav/menu links to `#demo` place the heading below the fixed nav in all six cases. Heading top was about 167.5 px on mobile and 208 px on tablet/desktop; nav bottom was 76.375 px. Overlap visible in oversized element screenshots is capture scrolling, not the actual anchor landing position. All rendered main headings retain opacity 1 and visible dimensions after scrolling (14 mobile, 15 larger layouts). The mobile duplicate context heading is intentionally `display:none`; the initial QA selector was corrected to exclude it, then the two mobile cases passed. Original six-case anchor evidence is retained in `anchors-all.json`; final mobile heading evidence is `headings.json`.
- `node node_modules/vitest/vitest.mjs run apps/console/src/components/logo-animation/logo-fast-independent.test.ts`: **1/1 PASS**, 1.67 s. All 32 pieces have zero rotation; sampled displacement approaches zero without reversal, scale grows monotonically, and every piece is exactly aligned by 0.9 s. Authored total duration is 1.5 s.
- `node apps/console/scripts/logo-fast-independent-qa.mjs`: **3/3 PASS**, desktop first/reload and mobile first load without query parameters. 93–95 sampled frames per run retain all 32 pieces with no rotation. Initial fill is `rgb(23,25,27)`; final fills are orange `rgb(255,122,26)` and blue `rgb(74,133,248)`. Actual mount-to-removal durations were approximately 1.59–1.71 s including startup. Film handoff completed, with no debug UI or page errors.

Evidence: `scratchpad/qa/landing-fast-independent/` (`results.json`, `logo.json`, `anchors-all.json`, `headings.json`, and demo/footer/anchor screenshots). Desktop EN and mobile VI demo captures were visually inspected. All browsers closed after the local pass.

The root built/typechecked and staged the release separately.

## Public acceptance: PASS

Deployment **`eda0ea63-fd24-43fd-84d1-c12328142d26`** was independently observed as SUCCESS through the Railway CLI before browser checks began. Public origin: `https://playerone-web-production.up.railway.app`. `/healthz` returned `{ "ready": true }`.

The same QA scripts ran with `QA_BASE` set to that origin and `QA_OUT=scratchpad/qa/landing-fast-independent/public`. Demo/footer scope was limited to **1440 EN and 375 VI** (`QA_PUBLIC=1`). Desktop passed on the first run. The first mobile `page.goto` exceeded the local script's 12-second full-load timeout; one fresh mobile-only retry used a 30-second navigation bound and DOMContentLoaded readiness, then completed the entire test in **2.50 s**. No recurrent UI failure was established. Desktop was not repeated.

Both public widths pass search/no-results, filtering, detail/declarations/physical-camera instructions/reset, footer geometry and zero horizontal overflow. Real nav/menu anchors place the demo heading below the fixed nav by approximately **91 px mobile / 132 px desktop**. All rendered main headings remain visible at opacity 1 after scrolling.

Public logo first load, ordinary desktop reload and mobile first load pass: **32 pieces**, initial black then orange/blue, no sampled rotation, no debug controls, and completed film handoff. Mount-to-removal times were **1.66 s desktop first, 1.56 s reload and 1.75 s mobile**. Page errors and unexpected API mutations were zero. All browsers closed.

Evidence: `public/results.json` retains the first-run desktop pass and mobile navigation timeout; `public/mobile-retry/results.json` contains the successful mobile retry. `public/logo.json` and `public/headings.json` contain the final logo/anchor/heading results. Public screenshots are alongside those files; successful mobile demo/footer captures are in `public/mobile-retry/`.

All assigned bounded local and public gates are clear. No backend or authenticated workspace regression was rerun for these landing-only changes.
