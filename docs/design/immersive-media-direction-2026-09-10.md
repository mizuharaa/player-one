# Restore media scale and graphic contrast

The owner rejects the uniformly narrow beige sections in deployment 6c53ca68. Preserve the successful warm navigation, typography, FAQ, footer, working demo, languages and accessible controls. Restore the previous page's wide imagery and dark/lime/lavender contrasts in the introduction, demo, collectors, scenery and review sections. This is an amplification of those sections, not a dashboard or brand redesign.

## Visual Story

| Scene | Visual story | Website copy |
| --- | --- | --- |
| Familiar work | Full-width dark stage; a large lime circular aperture frames the sole first-person image. Editorial text/media split, with callouts aligned to the same grid. | Preserve the existing introduction and task/review explanations. |
| Try the app | Broad lavender stage; an intentional geometric illustration anchors the working collector demo. Small idle motion belongs to the illustration, never simulated earnings or recording status. | Preserve task selection, details, explicit declarations and physical camera-button instruction. |
| People and places | Collector photographs occupy nearly the full viewport width. Stock scenery follows a consistent four-column baseline, its heading first and credits aligned below. | Preserve AI-image disclosure, activity labels, stock provenance and honest story placeholders. |
| Human review | The film fills the section width. A bounded dark glass panel contains readable copy and verdict choices while the action remains visible. Mobile film and copy are separate vertical regions. | Preserve human-review explanation and the three illustrative verdict responses. |

## Composition and motion contract

- At 1440/1920/2560 CSS pixels, collector and review media span at least 90% of the viewport. Remove the inherited 1280px cap from these media stages; retain sensible text measures. The introduction's intentional text/media split is exempt from the image-width rule, but its dark stage fills the viewport.
- Introduction uses roughly 40/60 text/media on desktop. Restore the existing lime/ink primitives without introducing a new palette. The image appears only once in the page; the demo does not reuse it as a background.
- Scenery shares one image height and one caption baseline on desktop. On phones, use a deliberate two-column composition with equal image heights per row. Do not use arbitrary stagger heights or decorative duplicates. All four real stock sources remain credited.
- Review film owns the full stage, approximately 0.85-1 viewport high on a typical desktop, bounded near 900px. Glass copy stays about 30-36rem wide, with at least 4.5:1 body contrast over the brightest video frame. Place controls/caption outside its collision area. Preserve the subject through object-position and the mobile layout.
- Mobile review uses a substantial full-width film followed by an opaque dark copy/control area when an overlay would hide the subject. Text cannot be cropped to preserve a desktop screenshot.
- Illustrative idle motion is subtle, transform-only and limited to currently visible sections. It has an explicit accessible pause control and honors reduced motion. No continuous scene/container scroll transforms, hidden heading defaults, global refresh loops, or random duplicated image strips.
- Normal scroll and reverse scroll must keep headings readable. Existing videos continue to pause offscreen. Do not tie a section's visibility to its animation completion.

## Acceptance

Native author checks precede independent Playwright review. Inspect 375, 430, 768, 1440, 1920 and a wide/zoom-equivalent 2560 layout; Vietnamese and English long-copy cases, with Chinese spot checks. Record actual stage widths, media bounds, caption/control collisions, stock baseline alignment, document overflow and heading visibility. Exercise all three verdicts, film pause, motion pause, reduced motion and offscreen suspension. Keep the working demo search/details/declarations/reset regression. Dashboard, backend, logo and production data are outside this correction.

Mobbin evidence will be linked from `immersive-media-mobbin-2026-09-10.md`. Screenshots establish composition, not exact animation timing or gesture behavior. Deployment follows the existing reviewed snapshot pipeline after local acceptance; the live site is not evidence for unfinished local work.

## Reference and media decisions

Actual Mobbin research completed: six authenticated section searches and 18 inspected previews, with eight canonical references in [the research report](immersive-media-mobbin-2026-09-10.md). Root additionally inspected the Robot.com, Graza and Aino images: nearly viewport-wide film, a saturated split field and repeated image/caption geometry directly support this correction. Their still captures do not establish idle motion or a frosted text panel; those are authored PlayerOne choices requested by the owner.

The unused 12-second POV videos were considered for the introduction, then rejected after inspecting both variants at 0/3/6/9/11 seconds. Both visibly duplicate the shirt/collar around 3 seconds and end with an awkward shelf drape. Keep the clean still rather than exposing those continuity defects. The review retains the supplied film; its 5-second centered-subject and 8-second gardening frames informed safe overlay placement. Its original source is also 1280x720, so upscaling would not add detail. Mobile retains the landscape action instead of forcing a tall crop.
