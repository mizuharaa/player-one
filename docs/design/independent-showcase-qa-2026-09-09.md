# Independent showcase QA — 9 September 2026

Independent reviewer: Codex audit session, which did not implement the product changes. Worktree `C:/Users/user/pw/ui-integrate`, branch `sprint/ui-revamp`, HEAD `fc84a98` plus the shared uncommitted implementation. Preview: existing Vite process at `http://127.0.0.1:5190`. No server was started, no product UI was edited, and no commit, seed, database mutation or deployment was performed. This session wrote only QA probes, screenshots, measurements and this report.

Read the main-worktree `AGENTS.md`, repository `CLAUDE.md`, `PRODUCT.md`, `DESIGN.md`, release direction and login/shell handoff. The latest owner's September 6 film and colored-logo instructions supersede the earlier rejection/monochrome direction.

## Result and scope

No confirmed release-blocking frontend regression was found in this bounded pass. This is frontend acceptance evidence only. The API on port 8080 was not running and no real credentials or remote service were available. Authenticated-shell cases explicitly used isolated Playwright response fixtures; they do not establish real authentication, cookies, database access, payment, media authorization or deployed same-origin routing.

All browser probes used `withBrowser` and `newPage` from `apps/console/scripts/browser.mjs`, with one browser/context sequence at a time and reduced motion by default. Motion contexts were limited to the actual logo, gallery, video and Truc measurements. Intro waits first required the page to mount; natural first-play cases then required `data-logo-complete` and cleared story pending. Reduced-motion, hash and remembered-session skips accepted the corresponding known skip condition and absent intro only after mount. No pre-mount detached-selector gate was used.

## Commands and independently observed results

Run from the worktree, using PowerShell:

```powershell
pnpm -F @playerone/console typecheck
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
pnpm exec vitest run apps/console packages/design --testTimeout=180000
node apps/console/scripts/showcase-independent-qa.mjs layout
node apps/console/scripts/showcase-independent-qa.mjs controls
node apps/console/scripts/showcase-independent-qa.mjs motion
node apps/console/scripts/showcase-shell-independent-qa.mjs
node apps/console/scripts/showcase-motion-extra-qa.mjs
node apps/console/scripts/showcase-edge-qa.mjs
$env:CONSOLE_URL='http://127.0.0.1:5190'
node apps/console/scripts/discover-final.mjs demo
node apps/console/scripts/showcase-contrast-qa.mjs
node apps/console/scripts/showcase-contrast-qa.mjs help
Get-FileHash apps/console/public/discover-media/20260909/review.mp4 -Algorithm SHA256
```

- Console typecheck: exit 0.
- Console/design tests: **169 passed, 0 failed, 0 skipped; 11 files passed**. `DATABASE_URL` was removed from that test process; no database was used. Includes 54 design-token contrast tests. This is not a whole-repository/database/corpus test run.
- Browser layout: **12 cases**: VI/EN/ZH at 375, 768, 1440 and 1920 pixels, height 900. Landing top/lower section and login each reported 0 horizontal overflow, 0 broken loaded images and 0 dead in-page anchors. No page errors or movie requests in these reduced-motion contexts. Root language correctly used `vi`, `en`, `zh-Hans`.
- Desktop login: form/film widths were exactly **720/720 at 1440** and **960/960 at 1920**, sharing top coordinate 80. At 375/768, the form precedes the full-width film and credentials/submit remain reachable by ordinary page scrolling. Both legal links point to the working `/privacy` draft.

Machine-readable evidence and screenshots: `scratchpad/qa/showcase-independent/{results,shell-results,extra-results,edge-results,contrast-results,contrast-help-results}.json`. Probe failures during development were selector/harness failures: the range needed native input events, radio clicks needed their visible label, and immediate intro skips do not reliably retain the completion data attribute. A broad API route fixture initially matched Vite's shared-package module URL and was corrected to check the actual path prefix. Those runs were corrected and rerun; they are not counted as product failures.

## Rendered functional-text contrast

Bounded 1440px light/dark sample, using the existing screenshot/glyph-difference measurement from `contrast.mjs`, not just token arithmetic. All final sampled functional text exceeds 4.5:1. Decorative orange/blue logo paths were excluded from this functional-text sample.

| Sample | Light | Dark |
| --- | ---: | ---: |
| Login selected role | 15.78:1 | 16.12:1 |
| Login unselected role | 6.03:1 | 6.19:1 |
| Sign-in primary label | 15.78:1 | 16.12:1 |
| Active shell navigation label | 15.78:1 | 16.12:1 |
| Inactive shell navigation label | 6.95:1 | 7.46:1 |
| Cookie Accept and Decline labels | 16.42:1 | 16.42:1 |
| Truc action, rest | 17.63:1 | 17.63:1 |
| Truc action, hover | 9.03:1 | 9.03:1 |
| Selected prepared-question label | 17.63:1 | 17.63:1 |
| Truc explanatory copy | 16.42:1 | 16.42:1 |

The original helper-action row in `contrast-results.json` is invalid: `.discover-button` uses `color: ... !important`, so the inherited probe's ordinary inline transparent color failed to hide the glyphs. The bounded helper-only rerun explicitly used transparent `!important`, waited for hover to settle, and measured genuine changed glyph pixels. `contrast-help-results.json` supersedes both initial helper-action rows. This was a measurement defect, not a UI contrast failure; no product fix was needed.

## Logo, gallery and motion

- Deterministic debug samples retained **32 paths, 0 SVG text nodes**. At 1.59 seconds all piece transforms were identity and fill was black `rgb(23,25,27)`. At 1.79 seconds those same paths interpolated color. By 1.98 seconds fills reached orange `rgb(255,122,26)` and blue `rgb(74,133,248)`; docking retained them.
- A separate natural-speed run sampled 42 frames: first visible geometry black/unassembled; first fully assembled sample black; first color sample fully assembled; final sample orange/blue. This independently confirms order without the debug slider. Sample timestamps include page/chunk loading and are not timeline-duration measurements.
- Natural first visit mounted the intro; it completed with a visible colored 32-path navigation logo. Reload in the same session skipped the intro and retained storage key `playerone:logo-assembly:v1=1`. Reduced motion skipped intro and media downloads.
- Desktop gallery: rest `grayscale(1)`/no transform; hover and keyboard focus `grayscale(0)` with `scale(1.025)` and `translateY(-2px)`. Touch viewport: no grayscale, no transform, hover media query false. Focus outlines remain visible. Debug outline seams in the logo screenshots are diagnostic overlays, not production seams.
- Truc actually mounted a canvas. The rAF counter measured **77 callbacks/600ms while visible**, **0 callbacks/1500ms after offscreen settle**, and **0 callbacks/1500ms while manually paused**. Independent CDP sampling after leaving Truc measured 0.000922 seconds script work during a two-second window; this is negligible work, not a claim of literally zero JavaScript execution.
- Login film paused while offscreen, played upon entering view, responded to manual pause, and paused again when scrolled offscreen. Aborting the movie request produced the visible fallback message while all credential inputs and submit remained enabled.

## Landing controls, privacy and media

- Initial cookie banner visible. Accept saved `accepted`; reload hid it. Settings reopened it and focused `discover-cookie-title`. Decline saved `declined`; reload again hid it. `/privacy` retained the choice and rendered without overflow. Both choices are real preference writes, with no analytics/ad activation in the implementation.
- Truc explicitly says AI chat is not connected and offers prepared answers. Opening focuses the answer heading; changing a question updates the answer; Escape closes and returns focus to the trigger. Pause toggles `aria-pressed`. Native FAQ details independently open and close. Mobile menu is a native modal dialog, contains focus, and returns focus on Escape.
- Privacy copy clearly identifies a draft, its local storage/preferences, demo-only actions and missing responsible-party/retention/contact details. It does not claim approval, legal compliance or a guarantee about infrastructure request logs.
- Review video genuinely loaded `review.mp4`, advanced while visible, and paused offscreen. Reduced motion made zero movie requests before explicit Play; manual Play then loaded and played the review film. Its visible/accessibility disclosure says illustrative external view, not a device-fitting guide.
- Review file hash was `FA166CC6DB2E7F5AB14D1894DF085219B81B67A2DE2F3574998CBF7D0A285FDF`, matching `review-manifest.json`. That manifest identifies source `hf_20260906_224034_559e64c5-136d-46d3-a4ef-61991f646fa1.mp4`, 1280×720, 24 fps, 10.041667 seconds, silent. Source filename provenance comes from the retained manifest; a byte comparison against the original source was not performed.
- Demo heading and supporting copy both measured top **1828.65625** at 1440; computed alignment `start`. Existing demo probe completed browse → details → prepare → ready → back. Prepare remained disabled before required selections, enabled afterward, and heading focus moved with each step. This remains an illustrative preparation flow, not camera recording control.

## Login and shell — response fixtures only

- Both roles submitted `POST /api/session`. Operator included machine identifier/secret and operator reference/secret; reviewer omitted machine fields. All submitted values were `qa-placeholder`, never real credentials. Mock mismatch and rate-limit responses produced their distinct visible messages. Mock success redirected operator to `/` and reviewer to `/review`.
- The shell was checked at 375/768/1440/1920, with VI/Chinese/English represented. Seven labeled navigation links remained present. All seven destinations rendered the shell with correct `aria-current` and zero horizontal overflow under unavailable-data fixtures.
- Compact drawer: native modal, focus inside, Tab/Shift+Tab containment, Escape close/focus return, and closure on resize across 960 pixels. Workspace skip link focused `#workspace`.
- On the review route, ArrowLeft/ArrowRight/1/2/3/Space/Escape dispatched while focus remained inside the drawer did **not** reach a native window listener. This proves keyboard containment at the shell boundary; no actual leased review/payment was exercised.
- With fixture data endpoints returning 503 and retries allowed to settle, Home showed `Not connected`, `No figure` and reference `QA-FIXTURE`; it did not fabricate zero-valued results. Early shell screenshots show loading placeholders; `shell-unavailable-1440.png` shows the settled failure state.

## Representative images

- `scratchpad/qa/showcase-independent/login-1440.png` and `login-375.png`.
- `scratchpad/qa/showcase-independent/landing-natural-1440.png`.
- `scratchpad/qa/showcase-independent/logo-1.59.png` and `logo-1.98.png` (debug outlines).
- `scratchpad/qa/showcase-independent/questions-1440.png`, `questions-375.png`, `privacy-mobile.png`.
- `scratchpad/qa/showcase-independent/shell-1440.png`, `shell-375.png`, `shell-unavailable-1440.png`, `demo-alignment-1440.png`.

## Remaining limitations

No real API login/cookie session, live database figures, remote deployment, production proxy boundary, or deployed media authorization was validated by this lane. API/deployment changes belong to their independent reviewer. No full video-quality review, full accessibility certification, whole-repository tests, 200% browser zoom or every short-height/theme/locale combination was claimed. The current pass deliberately targets the newly requested frontend behavior.
