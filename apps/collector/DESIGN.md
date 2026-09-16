# Collector design direction

Scope: the native collector app. The root design file describes other product surfaces.
Owner screen-specific Impeccable briefs override this file. Product and server truth always remain binding.

## Sources and method

- Owner Luma images: C:/build/design-ref/owner-refs; img34 gallery, img36-38 detail, img40 Share, img41 composite/map/navbar, img42-49 onboarding, img51 completion.
- Wise, Klarna and Fiverr: C:/build/design-ref/design-reference.md and its curated/ images. Read its verification corrections before individual clusters. The final master table determines the queue.
- Measurements in that reference are visual estimates, not extracted source values. Use intended proportions; record direct pixel measurements when a change depends on exact geometry.
- UI UX Pro Max 2.13.0: glassmorphism style, multilingual typography and dragging-movement searches. The generic purple marketplace design-system result was rejected because it conflicts with the owner references.
- Hallmark: one coherent app system, truthful copy, no nested decorative cards or fabricated statistics. Its web-only CSS/export and diversification recipes do not apply to this native app.
- Impeccable: inspect the rendered flow, repair behavior before polish, check long/localized/reduced-motion states. No claim of a full audit passing without its evidence.

## Visual world

Modern native utility with warm paper, dark readable ink and selective frosted chrome.
Wise supplies money hierarchy and row discipline; Klarna supplies translucent materials;
Fiverr supplies browsing density and action hierarchy. Luma controls the named flows.
The gallery is the explicitly requested photographic exception to the restrained app surfaces.
No competitor imagery, icons or wordmarks are extracted. Use approved bundled images with illustrative labels.

## Shared layout target

- 4-point spacing scale: 4, 8, 12, 16, 20, 24, 32, 48.
- 16-point screen gutter; related rows align to that same edge.
- Card radius 20; field radius16; pills fully rounded. No screen-specific card radius.
- Body16/24, caption14/20, section20/28, screen28/36, dominant money40/48.
- Retain the bundled Be Vietnam Pro family and system glyph fallback; use weight to separate roles, not decorative font changes.
- Never truncate a money string. Keep the number and currency legible at large text sizes.
- Native safe areas remain outside scrolling content. Dock and sticky actions reserve measured space.
- One primary action per decision. Quiet secondary actions remain stable under a finger.
- Loading placeholders match the eventual structure; empty and failed states share the same grid.

## Glass construction target

1. Actual page/scroll content is the backdrop, with a controlled warm/pastel tint where appropriate.
2. Real native blur belongs behind floating chrome and sheets, above that backdrop.
3. A translucent neutral overlay controls the worst-case contrast independently of blur.
4. One subtle outer hairline and a lighter top edge indicate thickness; text stays above every material layer at full opacity.
5. Monetary statements, dense text and input interiors use denser or opaque fills when translucency would hurt reading.

Reference blur amounts are visual guidance, not reverse-engineered private implementation values.
Expo blur intensity is not a radius in pixels. Verify its rendered result on the device.
Measure composited contrast: body>=4.5:1, large text/control indicators>=3:1.
Reduce Transparency must use an opaque fallback; motion settings must not hide content.

## Truth and interaction

- English is the default. Home exposes language switching; all three locales remain complete.
- Green money means a positive explicitly live paid amount. Pending, estimated, zero and simulated amounts stay neutral; simulation sentences remain visible.
- Never animate intermediate money values, manufacture task totals, or turn upload completion into review/payment success.
- No fake grabbers. Sheets need working drag behavior or explicit Close, including a single-pointer alternative.
- Boot runs only once the app is foregrounded; Reduce Motion has a visible static mark. Film has user-initiated Play and bounded Retry recovery.
- Detail: equal-width Claim / Follow / Help. Follow is an honest not-ready preview until a backend notification capability exists; Help explains the real pipeline.
- Counter address is not final: its localized where string is the replacement seam.
- Discover remains a list with an honest map-coming explanation while the API lacks coordinates. No invented hosts, attendees or locations.
- Tasks are everyday domestic actions recorded from the wearer's perspective. Display live server titles and facts; do not replace them with invented inventory.
- Completion uses the corrected img51 sheet layout: small status above title, real facts, explicit close and meaningful next action. No map without real data.
- Demo Skip may navigate only through the existing explicit demo mechanism; it cannot bypass live authorization or claim gates.

## Delivery

Each item gets its own commit and root typecheck, collector tests and release gate.
Capture affected screens at390/430; browser captures do not prove native playback or blur.
Reports: one message to w1:p8 and identical new UTC-named file in C:/build/astra-reports.
No push or emulator. Build49 follows a clean, reviewed batch; report Expo, submission and Apple availability separately.
B10 footage-examples work remains deferred tonight.
