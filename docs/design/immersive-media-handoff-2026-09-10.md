# Wide landing media — implementation handoff

Frozen for independent QA. Author checks are not acceptance. Direction: [immersive-media-direction-2026-09-10.md](immersive-media-direction-2026-09-10.md); visual evidence: [Mobbin research](immersive-media-mobbin-2026-09-10.md). The author inspected the actual Robot.com, Aurora, Aino and Graza previews, saved privately in `scratchpad/immersive-refs/`.

## Changed product files

- `apps/console/src/routes/Discover.tsx`: full-width espresso introduction with existing lime circle and one existing POV still; task/review callouts follow the same grid. Scenery heading now precedes its gallery. Review uses one wide film and a bounded glass copy/verdict panel. Below 1100px, the complete 16:9 film, caption and opaque copy area are separate regions.
- `apps/console/src/components/discover/DiscoverDemo.tsx`: larger lavender composition with task/checklist/horizontal twin-lens device illustration and a nearby illustration pause control. Existing task search, filters, selection, declarations, hardware-button explanation and reset remain unchanged.
- `apps/console/src/styles/discover-warm.css`: fluid media stages, aligned collector photos and equal-height stock images, full-width review, narrow-screen composition and one 4px decorative checklist translation. Warm nav, FAQ, footer and identity remain.
- `apps/console/src/lib/discover-illustration-motion.ts`: IntersectionObserver plus document visibility and reduced-motion gating for CSS animation. No animation frame loop, GSAP ticker, scrolling transform or heading opacity changes. Explicit pause applies to decorative illustration only; video retains its existing independent controls. Reduced-motion preference shows a truthful disabled state.
- `apps/console/src/lib/discover-warm-copy.ts`: VI/EN/ZH pause/resume/reduced-motion labels only.

The existing POV videos were not introduced after asset review found visible defects. No media generated or duplicated; stock provenance and AI-image disclosures remain. No backend, dashboard, logo or authentication edits.

## Author evidence

- `pnpm -F @playerone/console exec tsc --noEmit`: exit 0.
- `pnpm -F @playerone/console build`: exit 0, 8.19s. Existing large-chunk warning remains.
- Scoped `git diff --check`: exit 0.
- `apps/console/scripts/immersive-author.mjs`: one serial `withBrowser/newPage` run at 375, 430, 768, 1440, 1920 and 2560. Captures and numeric evidence: `scratchpad/qa/immersive-author/` (`geometry.json`). All tested widths have zero document overflow. Collector/review media spans 96.67%, 97.5%, 98.125% of desktop viewport at 1440/1920/2560. Stock image heights match at every width.
- `apps/console/scripts/immersive-author-spot.mjs`: VI at 375/1440 and ZH at 768; one serial normal-motion run. Illustration changes running→paused through its visible control; no glass/caption/play-control overlap. `spot-checks.json` and `review-<width>-<locale>-frame5.png` capture the unchanged review video's subject at 5 seconds. The full mobile frame remains visible.
- Browser-computed glass foreground `rgb(255,252,246)` over `rgba(53,39,31,.76)` gives 6.45:1 body contrast when composited over pure white, the brightest underlying frame. Narrow-screen copy is opaque espresso.

Useful author captures: `intro-1440.png`, `demo-1440.png`, `collectors-1440.png`, `settings-1440.png`, `review-1440.png`, `review-375.png`, `review-1440-vi-frame5.png`, `review-375-vi-frame5.png`, plus all six viewport sizes. Root reviewed the composition before freeze. No browser session remains held by the author.

## Independent checks still required

Use `.discover-wide-intro`, `.discover-product-specimen`, `.discover-collector-wall`, `.discover-settings-gallery`, `.discover-review-film-viewport`, `.discover-review-glass` and `.discover-demo-context .discover-illustration-toggle`. Film viewport is the actual 16:9 region on narrow screens; its caption is outside that region. Verify the full requested viewport/locale matrix, bright-frame contrast/collisions, all three verdict responses, play/pause, decorative pause/resume and offscreen/hidden-document suspension, reduced motion, 4px-after-idle/reverse-scroll heading visibility, and the unchanged full demo flow. No operational or financial mutation is part of these checks.
