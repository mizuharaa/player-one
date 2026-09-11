# PlayerOne — everyday work, seen from within

Status: production direction and builder handoff, not an accepted build. Owner: Codex design direction. Implementation: Astra / Codex-build. Independent QA: Claude. User authorized parallel work and Higgsfield existing credits. Web first; native collector refinement follows. The feature benchmark is input, not permission to invent new financial or identity services.

## Authority and baseline

Read the user-invoked `C:/Users/user/OneDrive/Documents/player-one/AGENTS.md` as project guidance. Its new website requirements are absent from this worktree. Its persistent mobile navigation and portrait composition are the latest mobile direction; the older slogan-only desktop opening remains. Do not copy unrelated template examples such as fruit motion into PlayerOne.

Source baseline: sprint/ui-revamp, fc84a98. Confirm ancestry before calling earlier commits missing. The supplied screenshots are current visual evidence; screenshots alone cannot verify motion. Source shows Hero and FilmBand as separate sections with timed choreography, not Fixa's full-screen takeover.

The weakest feature of the existing composition is separation of the real experience from its headline: grid, labels and chips dominate; the video and collector workflow are relegated below. Fix the opening composition first, not spacing tokens in the rejected composition.

## Direction contract

THESIS: ordinary work becomes first-person material, then a human decision. The page moves the visitor from observer to collector to understanding payment.

WORLD: daylight rooms and tactile ordinary objects; clean near-white breathing space; controlled lavender illumination and ink typography. Photographic colour supplies breadth. No page-wide graph paper, decorative verdicts or rainbow cursor. Existing partner identity is preserved.

STORY: recognise the work, try preparation, see the viewpoint, understand human review, find the available next action.

FIRST VIEWPORT: desktop begins with one short centred slogan, then pans it upward as the film rises into a full-width stage. The final stage carries a readable lower title and restrained navigation. Mobile keeps compact fixed navigation and a single action.

FORM: user-pinned Fixa opening, Serus navigation restraint, Flim type/image scale, Granola/Serus scenery behind one app demonstration, Klarna ending. No random concept roll overrides explicit references.

## Visual Story

| Scene | Visual story | Website copy |
| --- | --- | --- |
| 01 — Opening | Clean near-white stage. Desktop: one short slogan, no decorative grid, shapes, chips or visible navigation until reveal. Mobile: fixed brand/menu, short slogan and one action. | Your everyday skills. A new perspective. |
| 02 — Film reveal | Slogan rises as the September 8 film appears from the bottom, expanding into the viewport. The final title settles into negative space over a controlled scrim; the compact bar arrives. | Record everyday activity. Earn for reviewed, approved effective minutes. / Explore the demo |
| 03 — Choose work | One live HTML demonstration of PlayerOne task discovery, details and preparation sits in a broad, daylight photographic environment. No side-by-side feature cards. | Choose a task. Prepare your camera. / Try a task |
| 04 — Enter the viewpoint | After task preparation and the physical-button instruction, a task image expands from the demo into first-person activity. No copy during the short zoom; image remains visible after it. | Start recording with the button on Ego. |
| 05 — Everyday activity | Unequal edge-to-edge photographic fields: dominant wide action, portrait companion, small contextual detail. Different people and tasks, coherent light and photography. | Everyday work, from your point of view. |
| 06 — The device | Lower September 6 footage slot, with an accurate wearing-position illustration or corrected footage where necessary. Headset stays on forehead, both eyes unobstructed. | On your forehead. Ready for the task. |
| 07 — Human review and payment | One broad review composition, then stream-overlap illustration. Text and verdicts have stable solid surfaces; film never becomes a fake live review. | A person reviews your recording. Approved effective minutes determine payment. |
| 08 — Practical ending | Plain questions and available next actions; partners named with their roles; oversized PlayerOne wordmark anchored at the bottom. | Explore how collecting works. / Sign in to the console |

Draft English copy is direction, not the locale source. Author Vietnamese first in the existing catalogue and provide equivalent English/Chinese. Never hard-code untranslated visible copy.

## Scroll pacing and motion

- Opening: short load reveal of the slogan, then approximately 0.9 viewport of native scroll on desktop moves slogan up and film from bottom. Final film reveal gets a readable hold, not an empty pinned runway. Mobile initial active travel about 0.55 viewport. Tune from Claude's observations.
- Use GSAP/ScrollTrigger for opening and heading entrances. Keep landing choreography separate from shared dashboard logic. User asked for re-entry: replay a heading's upward reveal only after the section has left and re-enters, not once-only. Preserve visible semantic HTML when JS/import/media fails.
- App demo: manual browse/detail/claim/preparation states with labelled example data. A single controlled image expansion is about 0.6 viewport desktop/0.35 mobile if scroll-driven; keyboard/tap equivalent is mandatory. Do not auto-claim a real task or trap scroll inside the demo.
- Native scroll owns document position. No wheel interception, scrollTo loops or Lenis requirement. Smoothness comes from compositor transforms, stable section dimensions and bounded media work.
- Ambient idle motion: subtle illumination drift around the photo/demo only, compositor CSS where possible; pause offscreen, hidden tab and reduced motion. It must not animate money, verdicts or pretend the camera is recording.
- No continuously running JS ticker after active GSAP work settles. The old once-only batch sleeper proposal is obsolete if reveals re-enter. Builder must handle waking on actual scroll/resize/re-entry without leaving sections invisible. Claude measures both idle work and all-section visibility.
- Video: muted inline loop after reveal, pause when out of view, user pause/play, poster on failure. Reduced motion shows the composed final layout and still, with optional manual play. No animation sequence downloads under reduced motion.
- If a cinematic image sequence is used, deliver dedicated portrait and landscape variants, choose before fetch, bounded requests/decoded memory, cancel obsolete work at breakpoint. A responsive layout is not justification to crop away hands/device/action.

## Composition and evidence per section

| Section | Visual carrier and arrangement | Required real evidence | Must never claim |
| --- | --- | --- | --- |
| Opening film | Full-width film after three-beat reveal. No giant process paragraph above a separate strip. Text aligned to the photographed negative space, not the wearer's face. | Requested September 8 file, inspected frames; generated/illustrative label where appropriate. | A wearer-facing external shot is camera POV; generated participants are real enrolled collectors. |
| Navigation | Compact ink pill with calm opaque surfaces, existing PlayerOne/partner mark, language, section destinations and console entry. Mobile bar persists outside story container. | Existing links, localization, partner roles. | Serus branding belongs to us; APK exists; a fake waitlist is collecting requests. |
| App demonstration | One central HTML application surface over scenery; task list becomes detail, then preparation, then POV. Use actual task vocabulary; no invented phone OS chrome needed. | Existing collector flow and source types. Mark example throughout; use no payout amounts or capacity counts unless clearly example and needed. | Tapping the phone starts camera recording; a demo has made a real claim/upload/payment. |
| Photo field | Three or four independent photographs, unequal spans, consistent daylight grading. One dominant action gives the eye a place to land. | New Higgsfield generations, prompts, job provenance; correct headwear for external views. | Racial variety proves geographic operations; a stock scene is a genuine dataset sample; generated signs are real business endorsements. |
| Device film | A second intentional media moment, not an old frame reused as another story. Use September 6 requested source as input. | Inspect eye placement. If the source covers eyes, correct through Higgsfield or hold the slot as illustrative/unapproved; do not silently swap the wrong film in. | Obstructed vision is correct wearing; unsupported device specifications or battery readings. |
| Review | One record/footage context with actual Good/Partial/Reject shapes and labels; explanation adjacent on the same stage. | Existing verdict semantics and human review contract. | Automated acceptance, guaranteed approval, fake telemetry or sample figures passed off as live. |
| Payment | Clear overlap diagram tied to approved effective time, supported by concise text. No decorative currency counter. | Existing intersection rule and server-computed reviewed minutes. | Raw recording duration is payable; estimated earnings are cash ready to withdraw. |
| Close | Native questions, active demo/how-it-works anchor, honest APK availability, console sign-in, large wordmark. | Real release/contact links only. | Fake Zalo address, fabricated release date, or nonfunctional signup confirmation. |

## Typography, colour and cursor decisions

- Change landing display to Archivo Variable, self-hosted Vietnamese+Latin subsets; use verified compatible Chinese fallback. Keep operational body fonts and financial typography intact. Do not change shared dashboard typography just to style the public page.
- Keep all literal colour/radius/shadow/duration definitions in `packages/design/src/tokens.ts`, emitted CSS via existing design build. Near-white landing canvas uses a named landing token. Lavender light belongs to bounded scenery transitions, not a grid over every section. Saturated photographic content replaces the missing decorative-hue hunt.
- No three new arbitrary decorative colours needed. Verdict hues and partner hues keep their roles. Bounding boxes/tracking scores would imply automatic inspection that Phase 1 does not perform: omit them rather than treating them as the product's signature.
- Cursor lens is optional, desktop pointer only, headings only, never cards/buttons/nav/body text. Activate against actual text fragments (line/word/glyph bounds), not container rectangles or whitespace. Reset on scroll/resize/leave. Remove rainbow outline; one restrained lens/ring with short eased entrance. Keep native pointer available and disable effect for reduced motion/touch. If clone registration cannot stay exact at zoom, use heading emphasis without duplicate text; do not pretend random-spot zoom is fixed.

## Native collector follow-on: feature benchmark decisions

Source findings are in `collector-feature-benchmark-2026-09-09.md` and `figure-index-benchmark-2026-09-09.md`. The Chinese screenshots' publisher is not established. Index is Figure's separate product.

Build existing truthful flow, not a clone of either competitor: task browse → detail → claim → explicit session preparation → TF-card handover/episode state → reviewed income. Prioritise server claimability/device state preservation, real scenario selection, missing/error/pending states, and exclusion of QR/BLE simulations from production. Then search/available filtering, account/sign-out and locale persistence. Do not invent task aggregates without episode attribution, withdrawal endpoints, KYC/liveness or device shipping.

The collector browser surface is a React Native review harness. Do not label it a production collector webapp. The public landing demo is illustrative and isolated; the authenticated webapp remains the operator console. P0 task content, agreement bodies, training/exam and physical-hardware integration need evidence and owner/provider deliverables; UI polish cannot complete those dependencies.

## Build ownership and independent acceptance

- Codex root: this plan, visual direction, approved prompt and evidence mapping; no application UI edits or acceptance scores.
- Astra Codex-build: first actual token-based style tile, then `/discover`, cursor scope, landing motion and media integration. Expected files: Discover route; additive DiscoverDemo/landing motion modules; scoped globals CSS; tokens and generated CSS; font entry/dependencies; locale catalogue; media manifest; editable style tile. No file deletions or operational dashboard/backend changes.
- Media production agent: Higgsfield MCP only, existing credits explicitly authorized (`use_unlim: false`); full-film motion requests, separate deliberately recomposed portrait variant, independent photo generations. Exact prompts/settings/provenance retained. Inspect asset defects, but Claude owns acceptance. Maximum one targeted correction per failed concept before reporting limitation.
- Collector refinement follows web handoff with isolated native file ownership; do not collide in shared catalogue/tokens. It may proceed in parallel with web QA, not before the benchmark is considered.
- Claude: independent Impeccable critique/QA; verify desktop 1440/1280, phones 320/375/390/414 and tablet 768 in vi/en/zh, short heights, 200% zoom/text, no overflow, safe areas, menu focus, real rendered contrast, reduced motion, reverse/re-entry/fast scroll, media request selection, idle scheduling and all heading visibility. Use `withBrowser/newPage`; audit controls and consent flow, not only rhythm.
- User retains aesthetic acceptance. Passing source checks does not certify production, smooth motion or headset accuracy. Build results remain unaccepted until Claude's report and unresolved items are stated.
