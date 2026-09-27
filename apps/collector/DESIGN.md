# Collector design direction

Owner-approved visual contract: `outputs/design-drafts/mobile-flow-refined.png`, 26 September 2026. Mode: Operate. Android first; iOS and web previews remain supported. The approved four-screen draft supersedes the earlier card-heavy implementation.

## Direction
PlayerOne lets people find suitable recording work, prepare and submit it, then follow review and payment. The first screen should expose a useful task within the first viewport. The owner references define the visual world: Luma's compact thumbnail rows and image-backed detail/sheets; Shop's generous curved image cards, horizontal rails and tactile pills; Klarna's clear earnings hierarchy, short action tiles and plain history.

White and pale lavender surfaces, purple accents, near-black text and actions share the console's brand. Semantic review/payment colors remain separate. Use shared collector tokens, with translucent image materials named in theme.tsx. Preserve bundled multilingual typography and all product truth.

## Composition
Home: ambient lavender upper field, centered PlayerOne masthead between avatar and notifications, short My tasks / Awaiting review tiles, one featured photograph, then flat compact task rows. Counts come from claims and episodes. Readiness gates stay explicit, but do not replace the work hierarchy with a dashboard.
Task: the same photograph fills the top edge and fades into ink. Title, rate and actual availability precede an initially expanded What to record accordion and a Before you start disclosure. One white Review task action is anchored below. The claim sheet is smoky neutral translucent material over recognizable dimmed detail: thumbnail/title/rate, three plain facts, shared-target and payment disclosures, one Confirm task claim action and Cancel. It is not another nested card. There is one server claim only after explicit confirmation.
Income: ambient lavender top with the custom statement/ledger vector to the right of the factual status headline. Estimated and confirmed earnings are unboxed, side-by-side figures. Confirmed earnings are not labeled paid. Activity and utilities are flat rows, followed by a precise explanation of review. Task images/names are used only when episode → session → task relationships exist in API data; otherwise show the episode reference. Sessions, Explore and Profile keep existing functional navigation.

## Motion and access
Press down quickly; return with a bounded spring. Sheets enter and settle, follow downward drag on their handle/header, and close by drag, backdrop, close button or Android Back. Reduced motion keeps state changes immediate. Do not delay work for decorative motion. Native momentum scrolling remains native.
Use at least 48 dp controls, measured dock/footer reserves, safe areas, dark image scrims and explicit labels. No color-only status. Rounded image cards are intentional owner references, not generic card nesting.

## Boundaries
No fabricated payment, availability, task or collector statistics. Claims, onboarding, upload and finance gates remain server-owned. Illustrative task pictures retain disclosure. IDs remain available when the API does not supply task/date attribution; do not guess links between episodes and sessions.

## Approved illustration and navigation family
The collector's default avatar is the bundled panda portrait across Home, Income, Sessions and Profile. There is no user-photo field or upload control in the profile API. Sessions uses its own foil film-frame/upload vector in an open color-wash header. Income uses a statement/ledger object and Profile a collector pass. The panda remains the default avatar, rather than repeated hero art. Dock destinations retain their labels and 48 dp targets: Explore uses Search, Sessions uses Video, active Home/Income use ink-filled icons without a lavender selection pill. Compact task rows place the status at the trailing edge on 390 dp and wider screens, reflowing below content on small screens or enlarged type. Photo provenance stays visible.

## Notification icon refinement
Owner correction: real library SVGs and solid color, no generated notification art or decorative gradients. Notifications use the installed Lucide vectors; category badges use violet for review documents, peach for payments, blue for uploads, mint for devices, amber for tasks. Category icons do not imply a successful verdict or completed payment. The bell uses a solid yellow fill with an ink outline and no surrounding badge or box. The header keeps its invisible 48 dp touch target; no fabricated unread badge. The 27 September owner refinement allows restrained lavender/rose header washes and holographic illustration materials. Notification icons and control labels stay solid; the yellow bell remains unboxed. Existing photo-legibility scrims remain functional.

## Landing wordmark parity
The mobile gallery uses the console's shared 2.3-second PLAYER ONE letter schedule, with a larger responsive wordmark and the same orange/blue finish. Reserve each final letter's width, announce the brand once, and render the settled mark immediately for reduced motion. The sequence runs once after the existing intro completes and stops when the app backgrounds. Sign-in and other compact brand slots retain their existing size.

## Material refinement, 27 September 2026
Direct Mobbin research: Klarna Payments/Wallet/Profile, Revolut feature menus, and Taskrabbit task detail. Use these for hierarchy and material cues; no third-party marks, financial products, paid badges or screenshots become PlayerOne UI.

Decorative object illustrations are authored with react-native-svg: foil film frames for Sessions, folded receipt/ledger for Income, and a collector pass for Profile. They carry no live status, amount or verification claim and are hidden from assistive technology. Color tokens live in theme.tsx. Library feature icons use solid two-tone fills and no extra boxes. Profile's identity is open instead of another filled rounded card. Native press feedback and all task/payment gates remain unchanged.
