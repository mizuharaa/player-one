# Hero handoff and sign-in composition correction — 2026-09-10

Mode: preserve the accepted public visual world; sign-in is an Operate surface.

| Surface | What it says | Visual story |
| --- | --- | --- |
| Opening | Everyday activity becomes a new recorded perspective. | The temporary black slogan belongs only to the opening. After the film reveal, only the final white headline remains. Every skip, failure, resize and reduced-motion path settles to that same composition. |
| Sign-in, desktop | Authenticate the upload machine and the individual operator. | Equal-width panels: uninterrupted film on the left, a compact bottom caption over a readable ink gradient; a centered, bounded credential form on the right. Machine fields group together, then operator fields. Lavender and the existing brand colors provide continuity. |
| Sign-in, mobile | Reach the four fields and sign in without fighting the layout. | A short film introduction followed by the form. No desktop-width form squeezed into half a phone, no fixed-height clipping, and natural scrolling with the keyboard open. |

Evidence required: one visible hero headline after every handoff; desktop panel widths equal within one CSS pixel; no initial heading clipping; all fields/actions reachable at short heights, mobile sizes and in Vietnamese, English and Chinese. Use real deployed administrator credentials privately for a bounded sign-in check. Do not invent user activity, credentials, payment records or account statistics.

Diagnosis: opening cleanup clears the outgoing slogan's opacity while its story-active display selector remains enabled. Sign-in has equal grid tracks already, but align-start and a viewport-height film leave the panels with unequal visual height; a large opaque film caption and generously stacked form amplify the mismatch. These are lifecycle and layout defects, not a reason to replace the approved imagery or redesign the product.

Ownership: logo_choreography fixes opening lifecycle, native_ui fixes login, ui_release_audit independently checks both, root stages and deploys only the accepted result. No commits or unrelated feature changes.

## Added scope: console language, contrast and payment access

The console must expose the existing Vietnamese/English/Chinese selector in its persistent controls, including mobile navigation. A locale choice persists and translates the current route without losing task context. Do not invent a second locale mechanism.

Strengthen the existing ledger composition: distinct page heading, compact period selector, clearly active tabs, readable field boundaries, a single well-grouped action region, and restrained hover/focus feedback. Keep operational text and figures visible; motion must never reset their opacity on scroll. Preserve native scrolling and reduced-motion behavior. No promotional images, arbitrary decorative color or looping animation in money screens.

The payment screenshot may reflect an authorization mismatch rather than a failed period: the API restricts payout reads to finance while the older UI promises non-finance users visibility. Verify the actual response. Keep server authorization intact; if confirmed, skip forbidden reads and explain the required role honestly. Authorized finance reads must still work. Do not trigger bill creation, exports with side effects, payout attempts or database seeding during this release.

## Implementation and pre-release verification

All builders are frozen. Independent hero/login checks passed 15 actual locale/viewport combinations and six normal/Skip/import-failure lifecycle cases. The temporary black slogan remains hidden after handoff. Desktop login panels have equal measured width and height, while short viewports scroll naturally.

The missing console locale control is restored in the desktop sidebar and mobile header. Independent language checks passed at 320, 375 and 1440 pixels: Vietnamese, English and Chinese choices survive reload and route navigation. Measured dark-theme contrast: selected navigation 9.996:1, hover 8.840:1, secondary text 6.929:1. Reduced-motion feedback remains disabled.

Live read-only diagnosis confirmed the existing administrator authenticates successfully but receives HTTP 403 for finance-protected payout reads; the finance account authenticates and reads the same period with HTTP 200. The change keeps that server boundary. The UI now uses the stored profile role, avoids forbidden financial queries, and replaces misleading generic failure/read-only promises with role-specific messages.

Prepared source snapshot: scratchpad/railway-release-k0V3eb, 283 files, 18,054,648 bytes. All source hashes matched after staging. Payment gate checks and final build are pending; this paragraph does not claim deployment.
