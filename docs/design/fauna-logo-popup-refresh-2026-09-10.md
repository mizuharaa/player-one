# Fauna logo and language popup: direct observation

Read-only research and independent control QA, 10 September 2026. Scripts used `withBrowser/newPage` serially; browsers closed. No product changes authored.

## Correction to the earlier Fauna note

The statement in `fauna-motion-reference-2026-09-09.md` that Fauna has no animated logo is **incorrect**. A settled DOM with few inline SVGs cannot establish that. The live [Fauna site](https://faunarobotics.com) renders its logo in `canvas#logo` (200x60 drawing surface), using Rive's canvas runtime. The site's inline script calls `initRiveIcon` with artboard `logo`, state machine `State Machine 1`, and [this official logo asset](https://cdn.prod.website-files.com/6931911db0300aa6e7e3fc81/6970b656fb3a6d62ca8a873a_01_logo_02_hover.riv). The helper plays on load; the logo call does not enable its separate `hoverRepeat` reset handler. The observed pointer response therefore belongs to the loaded Rive interaction, rather than that optional helper branch.

## What was actually visible

The natural opening shows the normal page immediately, with the small navigation logo appearing after its runtime loads. It is not a fullscreen gate. Moving the pointer onto the actual logo produces a compact two-row shuffle: recognizable letter slots temporarily contain circles, semicircles, arches and square bars. The robot glyph remains anchored to the left. The wordmark returns to its exact arrangement by the nominal 1.4-second capture. No orbit or large travel outside the wordmark was observed.

Evidence under `scratchpad/qa/fauna-refresh/`:

- `fauna-150.png` through `fauna-5000.png`: natural page opening.
- `hover-100.png`, `hover-360.png`, `hover-750.png`, `hover-1400.png`: actual pointer-triggered geometric shuffle and return.
- `fauna-source.json`, `page.html`: fetched DOM, canvas and inline initialization evidence.
- Commands: `node apps/console/scripts/fauna-refresh-qa.mjs`; `node apps/console/scripts/fauna-logo-popup-qa.mjs`.

Capture offsets are requested wall-clock offsets and include screenshot overhead; they are not extracted Rive keyframe times. The initial timer collected only one late sample because page startup delayed its callback, so no frame-precise load-duration claim is made. Hover screenshots establish the actual behavior. The proprietary Rive internal timeline was not decoded, and no exact easing or path geometry is claimed.

## PlayerOne recommendation, not a Fauna timing claim

Use **1.8 seconds total** with the existing 32 paths. Keep the final wordmark's envelope and letter columns from the first readable frame. Over 0-0.25s reveal a compact black geometric register; over 0.25-0.85s perform one coordinated local slot reconfiguration of bars and curves, with short directional travel and restrained quarter-turns. Resolve all paths monotonically to their exact coordinates by 1.15s, without reversal or spring overshoot. Color Player orange and One blue over1.15-1.35s, then dock over1.35-1.8s. Preserve reduced-motion/Skip/fail-open and normal-reload behavior. Transfer the fixed-envelope principle, not Fauna's proprietary letter shapes or robot symbol.

## Language popup: reproduced defect and verified local fix

**P1 functional visibility issue, fixed locally.** On deployed `/discover`, opening the native select with keyboard Space produced a white popup where unselected English and Chinese were white and unreadable; only the selected Vietnamese row was legible. All options inherited white ink and transparent background from the dark navigation. `color-scheme:dark` did not make this Windows Chromium native popup dark.

The builder's explicit option foreground/background in `apps/console/src/components/shell/LocaleSwitch.tsx` fixes the actual popup: all three choices are readable, selected and unselected, with computed unselected ink rgb(23,25,27) on white. Space opens, Escape closes and selecting English updates the rendered language. This is actual native-popup pixel evidence, not just closed-control contrast.

- `native-popup-live.png`: deployed defect.
- `native-popup-fixed.png`: local corrected popup.
- `popup-comparison.json`, `native-popup-result.json`: source colors and selection results.
- Command: `node apps/console/scripts/locale-popup-pixels-qa.mjs`.

An earlier login screenshot did not reproduce the issue because that control inherits dark ink. Cropped popup captures also omitted the native popup surface; the full screenshots above are the decisive evidence. Other operating-system native picker implementations were not tested. This narrow audit does not assign a broad site accessibility score.
