# Fast logo and app preview refinement

The owner requested a fast shuffle into a more consistent PlayerOne wordmark, an iPhone-style interactive preview, and stronger organization informed primarily by Fixa and Bevel. This is a refinement of the accepted warm landing and broad media layout, not a replacement of its film, gallery, FAQ or backend.

## Visual Story

| Scene | Visual story | Website copy |
| --- | --- | --- |
| Intro | Glyph fragments change registers and proportions, then resolve into the same precisely spaced vector wordmark. | PlayerOne |
| Demo | Three preparation stages sit beside one large, functional phone preview; short task rows replace repeated rate cards. | Existing translated task and preparation copy |
| Footer | The shared wordmark and equal navigation column gaps give the closing section one alignment system. | Existing links and attribution |

Intro duration is 1.5 seconds, exact assembly at 0.9 seconds, followed by brand color and page handoff. All fragment translations approach their final positions without reversing; rotation is zero. Reload and reduced-motion behavior remain. The SVG remains the source of the final wordmark across placements.

The demo uses a CSS phone shell around real interactive HTML, not a picture of an app or an imported 3D model. It grows with content rather than trapping touch users in an inner scroller. Desktop uses a guide/phone split; mobile presents a compact three-stage guide above the phone. The decorative preparation SVG was removed. No rates, testimonials or operational data were invented.

Four actual Mobbin queries returned eight inspected previews: [research and source links](fast-landing-mobbin-2026-09-10.md). Bevel's front-facing phone and Fixa's feature/phone grouping informed the layout; still images do not establish animation or model licensing. No additional WebGL dependency or borrowed 3D asset was added.

Console typecheck and production build passed (7.87 seconds). Independent local checks passed the full demo flow, search/filter/empty/reset, all visible headings, footer alignment and zero overflow at 375/768/1440 in English and Vietnamese. Actual navigation to the demo clears the fixed navigation by at least 91px. Three normal-motion first-load/reload cases passed the intro; observed mount durations were 1.59–1.71 seconds including scheduling. The 32-piece numeric check confirms no rotation or reversal and exact final geometry. Browsers closed.

Snapshot `scratchpad/railway-release-zeG0jg` contains 309 files, 19,261,940 bytes; source hashes matched before upload and after SUCCESS. Only nine landing/logo files differ from the prior production snapshot. Railway deployment `eda0ea63-fd24-43fd-84d1-c12328142d26` is live and independently accepted. Health returned `ready:true`. Public 1440 EN and 375 VI demo/filter/declarations/reset, footer alignment, anchor clearance, visible headings and zero overflow passed. Logo first/reload/mobile checks passed with 32 persistent pieces, black-to-brand color and no rotation. An initial mobile 12-second full-load timeout did not reproduce on a fresh 2.5-second retry; no page errors or mutations were observed. Browser closed. See [independent QA](fast-landing-independent-qa-2026-09-10.md) and `scratchpad/qa/landing-fast-independent/public/`. No Git commit or push.
