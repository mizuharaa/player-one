# Collector design direction

Owner-approved refinement, 30 September 2026: open lists, floating navigation and the illustrated panda family. This supersedes earlier lavender header washes, boxed statistics and foil object art. Android first; iOS and web previews remain supported.

## Composition

Oat surfaces, plum type/actions, tangerine accents, yellow notification bell. Headers stay solid. Use shared tokens and multilingual typography. Icons share outline weight and alignment; the bell has no surrounding box.

Home: avatar and wordmark at left, notification action at right; greeting, plain task counts, a featured photograph with title below, then compact task rows. Counts come from claims and episodes. Readiness and consent gates remain explicit.

Sessions: short heading, camera panda, upload action, recording setup link, search and status filters, then recording rows. Income: confirmed earnings first, payment-pending explanation, separate estimate, then activity. Profile: identity followed by unboxed settings rows. Display task names/images only with explicit API relationships; retain references as fallback.

Task details keep the image-backed dark surface and expanding instructions. The claim sheet retains recognizable dimmed/blurred context, actual availability, shared-target and payment disclosures, and explicit confirmation. Claim success shows the camera panda and recording-setup action. A claim never starts the physical camera.

## Illustration and motion

Use the approved cream/plum/tangerine panda from assets/illustrations/PANDA.md: portrait for avatars, camera for recording and claim success, wave for guidance, clipboard for review context, mug for empty states. Art is decorative and hidden from accessibility navigation. No checkmark implies a financial or review outcome.

Floating five-tab dock: warm translucent surface, labelled destinations, measured active capsule and safe-area clearance. Press feedback uses the existing bounded spring; the active capsule tracks the selected tab. Reduce motion immediately when requested. Retain native momentum scrolling. Sheets support close, backdrop, drag and Android Back. Controls have at least 48 dp targets; support narrow screens and enlarged text.

## Product truth

No fabricated task, payment, availability or collector statistics. Confirmed earnings are not labelled paid. Preserve server-owned onboarding, claims, upload and financial gates. Illustrative photos retain provenance. Unknown task attribution remains an episode reference. Keep the accepted landing opening, letter shuffle and demo video.
