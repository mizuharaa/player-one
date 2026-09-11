# PlayerOne UI delivery — 9 September 2026

This is a coordination record, not independent acceptance. Work is uncommitted in `sprint/ui-revamp` over `fc84a98`.

## Local dashboard access follow-up

The owner's subsequent request to log in locally provisioned a separate PostgreSQL
cluster on loopback port 55432, database `playerone_local_demo`. Migrations and
the existing demo seed ran only against this new database; the existing cluster
on port 5432 was untouched. The API now runs at loopback 8080 under the restricted
`playerone_app` role, behind the existing Vite console at 5190. Local credentials
are machine `HCM-01` / `pw`, operator `op-1` / `pw`; finance uses `fin-1` / `pw`.
These are demo records and stub payment history, not production activity.
Private configuration and restart instructions are in the Git-excluded
`scratchpad/local-demo/` directory. This local setup does not change the cloud
deployment/account blockers recorded below. Independent real-login evidence is
recorded in `docs/design/local-dashboard-login-qa-2026-09-09.md`.

## Latest showcase polish

The latest owner-approved scope is [showcase release direction](showcase-release-direction-2026-09-09.md). The implementation includes smoother black-piece assembly followed by orange Player / blue One, aligned demo copy, grayscale-to-color hover/focus photographs, the explicitly requested September 6 film, Truc's 3D prepared-answer help, persistent Accept/Decline controls and a public privacy draft. Sign-in now has a desktop 50/50 film/form split, and the operational shell shares the logo and typography while preserving its real API calls and seven destinations.

External Claude hit its weekly limit. A fresh independent UI agent is measuring this batch, with a separate non-author reviewing deployment transport. Current reports: [independent showcase QA](independent-showcase-qa-2026-09-09.md) and [independent deployment QA](independent-deploy-qa-2026-09-09.md). The older Claude results below are historical baseline evidence, not approval of these new changes.

Both bounded independent passes are complete. UI: TypeScript clean, 169 tests passed, 12 locale/width cases without horizontal overflow or broken loaded images, functional consent/help/media/navigation checks passed. Rendered light/dark functional text samples passed, minimum 6.03:1; logo colors were excluded from that functional-text sample. Natural motion confirmed black assembly before color, and Truc stopped requesting frames offscreen or when paused. Deployment transport: seven test entries, 19 additional HTTP probes and six startup failure scenarios passed. The reports retain their scope limitations, including fixture-only authenticated-shell checks and no Linux container/cloud execution.

The same-origin Node/Fastify deployment package and Railway configuration are prepared in [the deployment handoff](../deploy-showcase.md). Publication remains blocked by missing hosting authentication and a designated database with provisioned runtime identities. No public service has been deployed, and no real remote sign-in has been verified. Local fixture-backed UI checks and proxy transport tests must not be described as end-to-end backend acceptance. No database was seeded or truncated.

## Ownership

- Design direction: root Codex. Implementation: Astra / codex_build, logo_assembly and native_ui.
- Functional corrections: separate collector agents. They do not approve their own changes.
- Historical independent acceptance: external Claude session `955ac7ac-5882-4123-bf6e-c4f9b5944b06`. Current UI acceptance: fresh `ui_release_audit` agent. Current deployment transport acceptance: `native_ui`, which did not author the infrastructure and did not audit its own UI changes.

## Reviewable result

- Public preview: http://127.0.0.1:5190/discover
- Editable style tile: http://127.0.0.1:5190/style-tile.html
- Current direction: [discover-assembly-direction-2026-09-09.md](discover-assembly-direction-2026-09-09.md), superseding the earlier quiet composition and scroll-only opening.
- Replay the modular brand opening: http://127.0.0.1:5190/discover?logoReplay=1
- Native delivery: [native-refinement-handoff-2026-09-09.md](native-refinement-handoff-2026-09-09.md).
- Feature comparison: [collector-feature-benchmark-2026-09-09.md](collector-feature-benchmark-2026-09-09.md) and [figure-index-benchmark-2026-09-09.md](figure-index-benchmark-2026-09-09.md).

The current composition uses a modular SVG brand opening followed automatically by the full-bleed film, Archivo display type, compact ink navigation, a large circular inspection scene, a working illustrative task-preparation demo, an unequal three-photograph collector wall, an ink/lime human-review scene, a larger lavender coverage diagram and the oversized PlayerOne ending. Website motion belongs to the story; native operational screens remain task-oriented and legible.

The wordmark consists of 32 real vector pieces with deterministic trajectories and a shared final SVG geometry. The intro supports session playback, a development replay/debug mode, a localized skip control and an import timeout that releases the page. Independent captures found a duplicate SVG pivot, which scattered starting fragments and caused overlap with Skip; the corrected version shows the intended compact mark and bounded assembly. Debug outlines were correctly excluded from production seam findings. The diagonal notch in the master wordmark's y was corrected and independently checked from the canonical SVG.

The normal-motion hero required two corrections: CSS and GSAP both translated the film, and playback could read a stale opening-pending attribute. The corrected, properly gated independent probe confirms the film at the top of the viewport, with its source attached and playback advancing. Unsaved visits initialize Vietnamese before rendering.

## Functional work kept separate

The earlier bounded corrections are documented in [functional-fixes-2026-09-09.md](functional-fixes-2026-09-09.md). Follow-up work removes Income's unsupported review-start checkpoint, adds visible Uploads refresh failures with retry, and preserves cached Home/Hall/Income rows alongside a failure notice and retry. No financial calculation or backend schema was changed by these UI follow-ups.

## Media truth and remaining dependency

Three separately generated work photographs and landscape/portrait POV stills and films are in `apps/console/public/discover-media/20260909/`. They are illustrations, not records of enrolled collectors. Production records: [photography-delivery-2026-09-09.json](photography-delivery-2026-09-09.json) and [motion-assets-2026-09-09.md](motion-assets-2026-09-09.md).

The new POV films lift, smooth and drape a shirt. They failed the authored folding instruction; the implemented example is therefore named arranging clothes. Claude reviewed that narrower content fit. The September 8 opening clip remains an external-view illustrative film, never labelled Ego POV.

The latest owner explicitly selected the September 6 film despite the earlier wearing-position concern. It is now delivered as `review.mp4` in the human-review section, replacing the repeated still, with an illustrative external-view/not-fit-guide label. Its manifest identifies the exact supplied source, and independent QA checked the output hash and actual playback. The forehead-mounted collector photographs remain separate. No additional subscription or credits were purchased.

## Acceptance boundary

Claude independently ran TypeScript successfully and 169 console/design tests with zero failures for the bolder page. The current reduced-motion sweep at 375/430/768/1024/1440/1920 measured zero horizontal overflow and zero clipped text nodes. Current captures confirm three unequal gallery photographs and an adjacent illustration disclosure. A fresh normal-motion document settled to 0.0 requestAnimationFrame calls per second in two consecutive three-second windows after eight seconds. Repeat-session visits bypassed the intro and played the film at viewport top. Escape and resize restored scroll/focus access.

The bounded rendered contrast sample passed on navigation, aperture, review, coverage, footer, CTA, film label and collector label; lowest sampled ratio was 6.32:1. This is sampled evidence, not an exhaustive contrast guarantee. Normal-motion openings passed at all six widths from 375 to 1920: film at viewport top, playback advancing, one visible heading and no horizontal overflow. VI/EN/ZH at 375 and 1440 passed clipping/overflow checks. The mobile menu opened as a modal, closed on Escape and restored focus. The demo preparation controls required both answers, and focus followed its steps. Heading re-entry remained visible, while the film paused offscreen and resumed at the top.

Final TypeScript and 169 console/design tests were independently rerun at 16:47:52 after the logo fixes. One subsequent CSS-only refinement raises the demo's example/device/disclosure text to 12px; its targeted locale/demo recheck passed. The current measured report is [claude-discover-final-2026-09-09.md](claude-discover-final-2026-09-09.md). It records residual smaller text outside those named surfaces as a tuning observation. Document navigation restoration was observed; same-document route lifecycle teardown is not independently proven. Dark scheme and physical devices remain unmeasured.

Native source corrections were independently rechecked in [claude-native-recheck-2026-09-09.md](claude-native-recheck-2026-09-09.md): TypeScript and 42 tests passed. Source-level findings were resolved without claiming a physical-device render check.

No physical Android, camera hardware, APK release or production deployment has been verified by this work. The collector web harness remains a review harness. Native enlarged-text/safe-area/keyboard behavior requires evidence beyond a browser rendering.

## Latest operator workspace and cloud recovery

The owner requested a cleaner data-driven console using the supplied Autosend,
Harvey and Harvest references. The implemented workspace now uses a stable
sidebar, compact real metrics, review/exception rows and task category glyphs.
The main logo returns to Home. Profile/settings includes actual identity,
browser-local avatar selection/reset, appearance and language preferences,
sign-out, and an 84-day own-operator activity calendar in Vietnam local dates.
The calendar excludes sign-ins and never substitutes fabricated activity.

The logo now uses deterministic irregular stepped assembly before its final
orange/blue color change, and replays on ordinary landing-page reloads. Reduced
motion still bypasses the intro. Independent source/API/browser checks passed;
see dashboard-workspace-qa-2026-09-09.md. One minor English singular/plural copy
issue remains documented there.

A clean 282-file source upload recovered the failed Railway replacement.
Deployment b88ecf9b-58a2-4a19-918d-3ab3f00d59a9 reports SUCCESS; public /discover,
/login and /healthz return200. The previous failed replacement stopped in build
scheduling and never displaced the then-healthy release. Final cloud interaction
evidence is recorded in the Railway release receipt and cloud QA report.

Public showcase data is intentionally empty beyond its provisioned centre and
login identities. Local demonstration credentials do not authenticate publicly.
Private cloud access instructions live in scratchpad/local-demo/showcase-access.private.md.
Raw-recording storage, live sign-in-code delivery, payment-provider integration
and the full analysis runtime remain separate production dependencies.

## Continuous logo refinement, deployed

The latest owner direction supersedes the stepped scramble. The live intro is
now a continuous3.8-second choreography: five distinct motion families, opposing
crossings, wide/compressed/asymmetric formations, directional sweep, progressive
letter recognition and exact lock before the existing orange/blue handoff.
The32SVGpaths are unchanged; normal reload replay and accessibility safeguards
remain. Developer tools add true pause/scrub, quarter speed, visible IDs and
family isolation. They are excluded from production.

Independent local and cloud checks passed on Railway deployment
b7f50c70-1dc4-42e0-b5eb-48ffcec09644. Evidence:
[logo QA](logo-continuous-independent-qa-2026-09-09.md). Public first/reload runs
completed and the opening film played; no browser errors. These checks do not
claim physical-device60fps certification.

## Short intro and scroll stability correction

The long swinging logo motion was rejected and replaced with a short local
mechanical scramble: 1.6 seconds authored, approximately 1.7 seconds including
startup in independent browser checks. The same 32 pieces, final brand colors
and ordinary-reload replay remain.

The disappearing-heading/gallery problem was reproduced: a tiny scroll after
idle globally re-enabled ScrollTrigger and restarted its entrance callbacks.
Those callbacks hid visible headings and shifted/scaled entire photo panels.
The replacement uses opaque one-shot heading entrances and leaves gallery
geometry fixed. It removes the global scroll-plugin sleep/wake cycle.

Independent tests at 375/1440/1920 sampled 845 points during tiny scrolls and
reversals. All headings remained opaque; settled heading and scene transforms
stayed clear. All eight headings remained visible, offscreen videos paused,
and idle animation callbacks reached zero. Existing hover contrast was verified
through the full CSS cascade; it did not require an additional CSS change.

The combined release ffcbaa02-c913-448a-9762-078403bedd63 is deployed successfully.
Evidence: [scroll and short-logo QA](discover-scroll-compact-logo-qa-2026-09-09.md).
Final public verification is recorded in that report and the Railway receipt.
