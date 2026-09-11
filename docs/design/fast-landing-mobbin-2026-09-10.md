**PlayerOne Mobbin references — 2026-09-10**

Live discovery found `mcp__mobbin__search_sections`, `search_screens`, and `search_flows`. Exactly four section searches succeeded; all eight returned inline previews were visually inspected. No files were written.

**Exact calls**

Each call used this identical `task_intent`:

```js
const task_intent = "Find visual references for a warm editorial landing page with an interactive iPhone product demo.";

mcp__mobbin__search_sections({query:"Fixa homepage hero section",limit:2,image_format:"jpg",task_intent});
mcp__mobbin__search_sections({query:"Bevel product demo section with iPhone",limit:2,image_format:"jpg",task_intent});
mcp__mobbin__search_sections({query:"AI Design Report 2026 hero section",limit:2,image_format:"jpg",task_intent});
mcp__mobbin__search_sections({query:"Shopify design homepage hero section",limit:2,image_format:"jpg",task_intent});
```

**Still-image observations**

- **Fixa — exact site found; MAIN inspiration.** [Source 1](https://mobbin.com/sites/sections/3b3c2b66-b096-4752-aa90-29d318ec9568) · [Preview 1](https://mobbin.com/api/mcp/short/yU0ev6mB): pale gray background, compact centered white navigation capsule, small category label beside a narrow text column, black sans-serif headline and larger gray supporting text. A wide photograph with rounded corners supplies warmth through skin tones and window light. [Source 2](https://mobbin.com/sites/sections/920d0adb-7d8b-4531-9659-faa024c815f8) · [Preview 2](https://mobbin.com/api/mcp/short/dOBsFP4H): dark section with three stacked feature controls at left and two upright phone frames at right, staggered vertically within a broad rounded panel. One feature’s explanatory text is visible.

- **Bevel — exact site and iPhone feature composition found.** [Source](https://mobbin.com/sites/sections/6c021d8c-0dff-4d1d-9eb0-a091e30af6f0) · [Preview](https://mobbin.com/api/mcp/short/8GWmc2LS): white background, bold sans-serif heading, gray subtitle, four pale blue rounded feature rows at left; a single large, front-facing phone at right. The phone contains a Biological Age screen, black pill cutout, metallic-looking outline and soft grounding shadow. **The preview is a flat, front-facing phone-frame depiction; it is not evidence of a licensed 3D model.** The other result was [Apple](https://mobbin.com/sites/sections/199ad6b7-94e1-4b9d-9021-4080a5167dd6) · [Preview](https://mobbin.com/api/mcp/short/8hjPhLy9): orange phone rear beside purchase columns, an unrelated approximate hit.

- **AI Design Report 2026 — found under the title “AI in Design Report 2026”; title differs by “in.”** [Source 1](https://mobbin.com/sites/sections/9c3f760d-b931-4c36-babe-47c339c29fcf) · [Preview 1](https://mobbin.com/api/mcp/short/zBVaxIY6): grainy coral/lilac floral imagery, overlapping rectangular crops and tiny uppercase role labels. [Source 2](https://mobbin.com/sites/sections/b6c5bbfe-fd4c-4a04-871e-7d8b455c6986) · [Preview 2](https://mobbin.com/api/mcp/short/Gmw7DgYZ): orange/lilac patterned banner above an asymmetric white editorial layout; tiny left-margin label, large tightly spaced black sans-serif statement to the right, smaller supporting copy below.

- **Shopify design — Shopify brand found; a distinct “Shopify Design” site was not verified.** [Source 1](https://mobbin.com/sites/sections/b922b9b7-e52a-49d5-a53f-8f892f00692a) · [Preview 1](https://mobbin.com/api/mcp/short/LAQTfoF4): vivid green field, horizontally arranged portrait photographs with black borders and offset white backing, centered copy and outlined pill CTA. [Source 2](https://mobbin.com/sites/sections/64f1ef93-17c1-4246-b8e1-1224ba62da1b) · [Preview 2](https://mobbin.com/api/mcp/short/UZBsSMsg): cropped globe illustration at left, bold headline and a spacious two-by-two statistics grid at right.

**Implementation suggestions — separate from observations**

Keep Fixa’s restrained typography, narrow editorial copy and warm photography as the primary direction. Adapt Bevel’s feature-list/phone pairing into selectable PlayerOne demo states using a CSS phone shell and real interface content. Borrow the report’s asymmetric text hierarchy sparingly. Treat Shopify’s bordered imagery as a secondary option; its statistics are not PlayerOne evidence.

These stills establish no gestures, transitions, animation or interactive 3D behavior. No models were downloaded. Preview URLs expire after 30 days.
**Local asset check and execution record**

The parent research agent scanned the repository for phone/iPhone GLB, GLTF, OBJ and FBX filenames and model-license filenames; none were found. This bounded scan does not establish that every possible asset directory contains no usable model. No arbitrary model or dependency was downloaded. Prefer a CSS device frame around the existing functional demo for this iteration.

The research subprocess ran read-only and completed with exit 0. Its four completed `mobbin/search_sections` calls are recorded in `scratchpad/fast-landing-mobbin-cli.log`; its final artifact is `scratchpad/fast-landing-mobbin-result.md`. The statement above that no files were written refers to the research subprocess; this report was saved by its launcher. No browser or product edits were made.
