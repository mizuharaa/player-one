# Console, hero and login release — 2026-09-10

**Current production: `aecfa0ae-c867-4dd1-a54a-3d48fee687ea` — SUCCESS, publicly verified.** The [kinetic landing receipt](design/kinetic-landing-2026-09-10.md) supersedes historical releases below. Scroll-linked serif emphasis, aligned wide photography, stationary metallic CSS phone, localized copy and pausable optical accents are live. Spline remains removed. Snapshot `railway-release-TmbGLH`:318 files,19,293,005 bytes; all hashes match after SUCCESS. Health ready:true; four viewport/locale checks and two additional motion/layout checks passed publicly. No Git commit or push.

Prepared snapshot: `scratchpad/railway-release-GxpfWW` (283 files, 18,054,711 bytes). Supersedes the unuploaded `k0V3eb` snapshot after a small locale-chevron alignment correction. Source hashes all match.

Changes: retire the temporary black hero slogan after film arrival; equal-height/equal-width desktop login panels and compact mobile form composition; persistent Vietnamese/English/Chinese console controls; clearer active/hover/focus and payment ledger alignment; stored-profile-based finance access messaging and financial query gating.

Independent pre-release evidence:

- Hero/login: 15 actual locale/viewport combinations and six normal/Skip/import-failure cases passed; no duplicated headline or clipped initial login heading.
- Languages: 320/375/1440, persistent choice and current route/profile navigation; mobile menu/Escape focus return, no horizontal overflow. Dark selected/hover/secondary contrast: 9.996/8.840/6.929:1.
- Payments: administrator visits to five subroutes made zero restricted API requests and did not render cached financial data. A profile-error fixture also hid cached content. Finance read the actual local demo batch and income endpoints using GET only. Fresh 375px finance view contained the wide ledger in its own scroller, with no page overflow or errors. One earlier browser resize probe stalled and was closed; that run was not counted as passed.
- TypeScript and 34 focused tests passed. Final production build and cloud acceptance pending at creation of this receipt.

Real existing cloud accounts were tested privately: administrator login succeeded and finance-protected batch returned 403; finance login succeeded and the same batch read returned 200. No payout, bill creation, exports or seeding were performed. Server authorization, payout arithmetic and business records are unchanged.

Final production build passed: 283 modules, 10.26 seconds. Deployment uploaded as
`530d8f8a-f25e-4518-a8af-c1585613471b`; awaiting Railway readiness and independent
public acceptance.

## Final public acceptance

Railway deployment `530d8f8a-f25e-4518-a8af-c1585613471b`: SUCCESS.
Public origin: https://playerone-web-production.up.railway.app.

Independent cloud PASS: one visible hero title at 375/1440 in normal and reduced motion; equal 720px login panels at 1440x600 with unclipped initial heading and all credential fields/actions keyboard reachable. Existing administrator and finance logins both succeeded. Vietnamese, English and Chinese choices survived reload. Administrator payment view made zero protected payout requests and showed the role requirement. Finance batch GET returned 200 with the expected empty cloud bills array. Both sign-outs removed session cookies. No page errors or financial mutation attempts.

Root health check returned ready:true; all 283 source hashes still match the uploaded snapshot. Independent browser closed. Cloud evidence: `scratchpad/qa/hero-login/cloud-results.json`; final QA reports under `docs/design/`.
# Warm landing, dashboard sheets and studio release — in progress

Mobbin research completed through nine authenticated calls: 19 screen images and seven flow previews. The warm landing and responsive dashboard sheets are built; independent browser acceptance remains in progress, including a date-sheet interaction issue. The previously accepted web deployment remains live until the replacement passes.

Production migrations 0026 and 0027 completed through the isolated migration job deployment `962d3127-8b03-4bb7-bfd5-5f72020523af`. The job verified the exact previous journal head and migration hashes, applied both changes in one transaction, asserted each runtime privilege before COMMIT, and exited zero. Runtime can update only demo-review fields, not clip ownership, media or expiry. Temporary service `fd1508d1-6ea6-4c9a-8bb4-93e829e21aea` was removed and its absence verified. The web service's credentials and deployment were not changed by this job. Sanitized evidence: `scratchpad/qa/showcase-migration-job.log` and `showcase-migration-job-state.json`.

Independent backend verification passed nine cases, including ownership, ranges, quota races, expiry, raw protected-column UPDATE denial and separation from production reviews/payment records. Local browser verification passed real demo upload, playback, seek, review persistence and deletion. These do not yet establish public studio access; that follows the web rollout.

## Reviewed replacement uploaded

All remaining local gates passed. The period-picker stall was a settlement-table render loop: a fresh `useQueries` result array repeatedly reset table pagination. Structurally shared combined income data now keeps unchanged rows stable while real income changes still update them. Independent populated-data checks covered repeated open/close, date draft cancellation/application, changed data and idle responsiveness. The original native sheet remains; diagnostic replacements were reverted.

Mobile filters passed draft/reset/apply, keyboard focus, body-versus-handle dragging and desktop inline behavior. Payment forms passed dirty/pending dismissal protection and visible refusals using intercepted manual/API requests, with no financial writes. The final studio UI Delete check caught and fixed an empty-JSON request header; the real button now returns 204 and its media returns 404. Final Truc bounds, initial black logo, orange/blue final logo and action contrast passed. Independent final build passed in 7.27 seconds.

Snapshot `scratchpad/railway-release-kIqRwE`: 300 files, 19,164,512 bytes, upload-safe allowlist and external SHA-256 manifest. Uploaded as Railway deployment `6c53ca68-9747-4705-8244-b8d7a584adae`. Public acceptance is pending; upload alone does not establish readiness.

## Final public acceptance of the replacement

Railway deployment **`6c53ca68-9747-4705-8244-b8d7a584adae`** reached SUCCESS and `/healthz` returned 200 with `ready:true`. All 300 source hashes matched the uploaded snapshot. This supersedes earlier deployment receipts above. No Git commit or push was performed.

Public site: https://playerone-web-production.up.railway.app/discover. Console: https://playerone-web-production.up.railway.app/login.

Independent public UI PASS: ordinary intro loads completed in 1961/1983ms with the same 32 SVG paths, black-to-orange/blue transition and no debug controls; the opening film played behind one settled heading. Glass/solid navigation stayed stable and native language options were readable. Desktop login measured equal 720px panels without document overflow. Mobile Vietnamese landing preference persisted; Truc measured 112px. Real finance login returned 200 with Secure, HttpOnly, SameSite=Strict cookies; visible mobile Chinese selection survived reload. Finance GET returned 200 and the expected empty cloud bill list. Repeated period close/reopen, draft cancellation and Apply passed. Logout left zero cookies and `/whoami` returned 401. No page errors or financial writes.

Independent public studio PASS: a 6,581-byte synthetic clip uploaded through the UI (201), played and sought successfully, returned exact byte-range media (206), and refused unauthenticated media access (401). A demo decision persisted in both server data and UI. Mobile had no document overflow. UI Delete returned 204, subsequent media returned 404, and logout cleared cookies. The exact test clip was removed. These operations remain isolated from production reviews, earnings and payments.

Evidence: `scratchpad/qa/warm-public/results.json`, `finance-results.json`, and `scratchpad/qa/showcase-production/results.json`; independent report: `docs/design/warm-showcase-sheets-independent-qa-2026-09-10.md`. All QA browsers closed. Headless browser results do not certify physical-device frame rates; payment mutation checks used intercepted requests and do not claim actual payment execution.

## Immersive media correction

The next owner correction restores broad media and graphic contrast while retaining the warm navigation, FAQ, footer and existing dashboard. Six authenticated Mobbin searches returned 18 inspected previews; the selected references and observations are in `docs/design/immersive-media-mobbin-2026-09-10.md`. Reference imagery was not shipped. Glass treatment and illustration motion are authored choices, not claims about behavior visible in still captures.

The introduction now pairs an espresso field and lime circle with a large existing POV still. The working demo occupies a lavender stage with a small preparation illustration and explicit motion control. Collector images fill a broad aligned grid; the four stock scenes share image heights and caption baselines. The review film fills the wide stage with desktop glass copy and a separate full 16:9 film/copy composition on narrow screens. No additional asset recycling or generated media was introduced. Existing unused POV clips were inspected and rejected for visible continuity artifacts.

Independent local acceptance passed at 375, 430, 768, 1440, 1920 and 2560px, including EN/ZH spots. Desktop media occupies 96.67–98.125% of viewport width. Glass body contrast is 6.45:1 against a conservative white-frame bound; mobile opaque copy is 14.03:1. All 389 reverse-scroll samples retained visible headings and stable figure containers. Illustration controls, reduced motion, offscreen pause, actual film playback, verdict controls and the existing demo flow passed. Settled footer sampling recorded zero scheduled RAF callbacks; this does not certify physical-device frame rates. Typecheck and the final production build passed (6.62 seconds).

Reviewed snapshot `scratchpad/railway-release-tpjSAL`: 301 files, 19,183,292 bytes. All source SHA-256 hashes match the external manifest after upload. Only five landing product files differ from the prior snapshot; dashboard, backend, auth, logo and media assets are unchanged. No Git commit or push was performed. Railway deployment `744e6fbf-d585-4ae5-9b7c-6e1cb5dbae40` reached SUCCESS and passed independent public acceptance; `/healthz` returned `ready:true` after SUCCESS.

Local evidence and exact measurements: `docs/design/immersive-media-independent-qa-2026-09-10.md` and `scratchpad/qa/immersive-media/`.

Public acceptance at 1440px normal motion and 375px reduced motion verified the new JS/CSS assets, 1392px desktop gallery/film, four unique stock scenes with aligned image/caption bounds, desktop glass and complete mobile 375x210.9375px film. Caption and playback control do not collide with copy. Actual playback/pause, three distinct verdict messages, illustration pause/resume/offscreen behavior, reduced-motion manual playback and truthful disabled illustration control, demo declarations/reset and VI/ZH persistence passed. Navigation bounds remained stable and document overflow was zero. No page errors or API mutations occurred. Independent browser closed; coordinator inspected both public review screenshots.

Public evidence: `scratchpad/qa/immersive-media/public/results.json`, `review-1440.png`, `review-375.png`. Live page: https://playerone-web-production.up.railway.app/discover. This media release supersedes 6c53ca68 while retaining its prior dashboard and studio acceptance.

## Engineering and upload recovery release

Current deployment: `e15d5445-23a8-40fd-a2ca-27b03fed4cea` is SUCCESS and independently accepted publicly. It restores the warm-white opening with the exact 2.3-second real-text PLAYER ONE shuffle, strengthens the typography and embeds the owner's stationary Spline iPhone around the working demo. Snapshot `scratchpad/railway-release-dDj8cJ`: 316 files, 19,281,866 bytes; all hashes and ready:true verified after SUCCESS. Local intro, model, demo, fallback and production-policy acceptance passed. Public intro first/reload, mobile actual Spline and attribution, demo flow and reduced-motion fallback passed with no page/console errors. See [refinement receipt](design/white-intro-spline-2026-09-10.md).

Previous release: `39d7fb37-86e9-43e5-9f3b-8bc131bc77d2` passed public acceptance for the exact 2.3-second real-text PLAYER ONE hero. It removed the blocking SVG intro and preserved the remaining landing/backend. Health and all 312 snapshot hashes verified after SUCCESS; first/reload, zero slot drift, mobile reduced motion, early navigation and CSP passed. See [hero release receipt](design/hero-letter-shuffle-2026-09-10.md).

Latest follow-up: deployment `eda0ea63-fd24-43fd-84d1-c12328142d26` is live and independently accepted, preserving this engineering release while refining only nine landing/logo files. Health and all 309 snapshot hashes verified after SUCCESS. Public phone demo, footer, navigation clearance and intro replay passed at desktop/mobile sizes. See [landing receipt](design/fast-landing-refinement-2026-09-10.md).

Deployment `947d23ee-3377-4418-9be4-ff7744002927` supersedes 744e6fbf and passed independent public acceptance. Migration 0028 and the three existing showcase credential rotations committed through an isolated job; the temporary service was removed. The web runtime retains restricted database access. All 309 uploaded source hashes matched after SUCCESS, and health returned `ready:true`. No Git commit or push was performed.

Public checks passed whitespace login, old credential refusal, showcase RLS, administrator diagnostics, finance refusal, responsive panda tours, CSP and actual demo upload/playback/review/UI deletion. The exact test clip was removed and logout cleared all cookies. The landing design is preserved. Full scope and limitations: [engineering release receipt](engineering-release-2026-09-10.md). Independent evidence: `scratchpad/qa/security-release-public/results.json` and [QA report](design/upload-session-security-independent-qa-2026-09-10.md).
