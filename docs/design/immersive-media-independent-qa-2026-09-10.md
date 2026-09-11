# Wide landing media: independent acceptance

**Local and bounded public verdict: PASS.** Reviewed the frozen implementation separately from its author in `C:\Users\user\pw\ui-integrate`, preview `http://127.0.0.1:5190`. No product edits, financial operations, authentication changes or backend/dashboard tests were performed. Every browser run used the serial `withBrowser/newPage` helper and closed afterward.

Direction: [immersive media](immersive-media-direction-2026-09-10.md). Author scope: [handoff](immersive-media-handoff-2026-09-10.md). Public deployment evidence follows the local gates below.

## Layout and readability

`node apps/console/scripts/immersive-media-layout-qa.mjs` passed eight reduced-motion cases: VI at375/430/768/1440/1920/2560, EN at1440 and ZH at375. All have zero document overflow, loaded images, heading opacity1, paused videos and no running CSS animations.

| Viewport | Collector and review media span | Stock image height | Review body contrast |
| --- | --- | --- | --- |
| 375 | Collector91.47%; review100% | 220px, all four | 14.03:1 |
| 430 | Collector92.56%; review100% | 220px, all four | 14.03:1 |
| 768 | 93.75% | 240px, all four | 14.03:1 |
| 1440 | 96.67% | 345.59px, all four | 6.45:1 |
| 1920 | 97.50% | 460.80px, all four | 6.45:1 |
| 2560 | 98.125% | 480px, all four | 6.45:1 |

The espresso introduction fills the viewport with its deliberate2:3 text/media grid and one existing POV still over the lime circle. The demo retains its lavender ground and uses separate geometric artwork. No second POV image was introduced into the demo.

The stock heading precedes its images; caption starts align within every row. Review glass has no geometric collision with the film caption or playback control. On narrow layouts the16:9 film, caption and opaque copy occupy separate vertical regions. The desktop contrast calculation composites the measured translucent panel over pure white, a conservative brightest-frame bound; it does not assume a convenient dark video frame.

A tight lower edge in the375 screenshot prompted a separate bounding-box check: the final paragraph ends28px above the glass bottom, with no hidden overflow or excess scrollHeight. The copy is not cropped. `immersive-media-edge-qa.mjs` records the containing and child rectangles in normal and reduced motion.

Evidence: `scratchpad/qa/immersive-media/layout.json`, `edges.json`; representative images `intro-1440.png`, `demo-1440.png`, `collectors-1440.png`, `stock-1440.png`, `review-1440.png`, `review-375.png`, with corresponding captures at the other five widths.

## Motion, playback and controls

`node apps/console/scripts/immersive-media-motion-qa.mjs` passed normal-motion checks at375/1440/1920.389 sampled states across introduction, collector and review sections cover idle then4px movement and rapid wheel reversal. Every sampled heading remains opacity1 and every collector figure container retains transform:none. The image hover treatment is separate from these container measurements.

At each width, the visible checklist illustration runs, its explicit pause control pauses it, and resume restarts it. The review video advances in actual playback, pauses through its button and resumes. All three verdict buttons select correctly and produce three distinct explanatory texts. No API mutation occurs.

At the final measured footer position, the illustration is paused, all offscreen videos are paused, Truc is offscreen, and scheduled requestAnimationFrame callbacks are0 over600ms after settling. An earlier short settling probe counted33 callbacks and was not accepted as an idle measurement. The final wheel run waits2.2s after arrival and records footer/Truc bounds; an independent exact-footer check also records0 callbacks over700ms in both normal and reduced motion. No recurring offscreen animation was observed. These browser measurements do not certify physical-device60fps or identify an owner for the earlier transient callbacks.

The new illustration hook was also inspected: it gates CSS activity using region intersection, `document.hidden`, reduced-motion preference and explicit paused state; removes listeners/observer on cleanup; and introduces no RAF loop or global GSAP/ScrollTrigger changes. Hidden-document behavior is source-reviewed, not claimed as an independently simulated OS-background test.

Evidence: `scratchpad/qa/immersive-media/motion.json`, `edges.json`.

## Existing demo and build

`node apps/console/scripts/immersive-demo-regression-qa.mjs` passed375/1440: three initial tasks, no-match search, clearing and filtering, details focus, both declarations initially unset, preparation disabled until both are explicitly chosen, physical Ego-button instruction, and reset restoring tasks/search/filter. No page errors or API mutations.

- `pnpm --filter @playerone/console typecheck`: exit0.
- `pnpm --filter @playerone/console build`: exit0,6.62s,292 modules. Existing application/3D large-chunk warnings remain; no build error.

No unresolved blocker remains in the requested local media scope. No additional API, dashboard or logo regression sweep was performed because those implementations were unchanged. Browser closed before release handoff.

## Public release

Railway deployment `744e6fbf-d585-4ae5-9b7c-6e1cb5dbae40` was independently confirmed **SUCCESS** using `npx --yes @railway/cli deployment list --service playerone-web --environment production --json`. Browser checks then ran against `https://playerone-web-production.up.railway.app/discover`.

`node apps/console/scripts/immersive-media-public-qa.mjs` passed the bounded1440 normal-motion and375 reduced-motion cases. New wide-intro, illustration and wide-review markup and deployed asset URLs are recorded. Collector/review widths are1392px/1392px on1440; collector343px and review375px on mobile. All four stock image sources are unique, loaded, equal-height and aligned by caption row. Desktop glass clears the caption/control; mobile video is a complete16:9 region with caption and opaque copy below. No document overflow.

Actual film playback advances and the pause button works at both widths; mobile playback occurs only after explicit Play. All three verdict responses work. Desktop illustration pause/resume and offscreen suspension pass. Reduced motion has no intro, autoplay or running animation; the illustration control is truthfully disabled. Mobile demo search, initially unset declarations, two-step enablement, physical Ego-button instruction and reset remain functional. Navigation dimensions remain stable across scroll; Vietnamese desktop and Chinese mobile choices persist after reload. No page errors or API mutations.

An initial probe clicked the play/pause button while normal autoplay was starting, then waited for a state it had just paused. The corrected probe waits for normal autoplay and uses explicit Play only in reduced motion; this was a QA race, not a product fix or blocked release.

Evidence: `scratchpad/qa/immersive-media/public/results.json`, `review-1440.png`, `review-375.png`, `stock-1440.png`, `stock-375.png`. Browser closed. No unresolved blocker remains in this bounded public scope; health and source-manifest receipts belong to the release director's separate verification.
