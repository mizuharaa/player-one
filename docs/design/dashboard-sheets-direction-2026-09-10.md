# Dashboard sheets: responsive task controls

The operator console remains an Operate surface: compact data, predictable controls, and orange/blue brand details. The landing's glass navigation and beige/espresso composition do not replace operational contrast or verdict semantics.

Mobbin is configured at `https://api.mobbin.com/mcp` and Codex reports OAuth authentication. A fresh read-only Codex research session successfully called Mobbin after the long-running session's tool catalog did not refresh. Its screen/flow report supplies the reference evidence; static screenshots alone cannot establish swipe gestures, exact easing, or native snap points.

## Implementation contract

Root also visually inspected the returned Chime, Asana, Monarch and Mercury images, saved privately under `scratchpad/mobbin-refs/`. Relative to the phone content above Mobbin's attribution strip, the visible sheets occupy approximately 55%, 71% and 92% respectively. These are rough frame measurements, not native detent specifications. They support content-driven height rather than one mandatory half-screen size. Mercury's desktop filter stays anchored over the table without a modal scrim. PlayerOne's 85dvh cap below is our implementation choice, not a claimed competitor constant.

Evidence: [actual Mobbin research](mobbin-bottom-sheets-research-2026-09-10.md), produced by the completed read-only CLI session (exit 0): 19 inspected screen images and seven previews from two flows, from nine successful Mobbin calls. Useful direct references are [Chime payment review](https://mobbin.com/screens/01aff7e9-7b5a-43ac-9266-5a7495767d41), [Asana date selection](https://mobbin.com/screens/85464f79-8b7d-4582-a185-86571b3f1e2f), [Monarch filters](https://mobbin.com/screens/0e67293e-fade-4311-811f-e3efc8f7b230), and [Mercury desktop filters](https://mobbin.com/screens/4b9388c2-b8a0-40b0-ae7a-ac85cfc0d0ae). The report links each returned screenshot. Its height descriptions are visual estimates; the 85dvh/34rem dimensions below are PlayerOne implementation choices, not measured Mobbin values. No inspected flow proves drag dismissal, sticky footer behavior, or accessibility support.

| Task | Phone | Desktop | Commit behavior |
| --- | --- | --- | --- |
| Episode filters | Content-sized bottom sheet with draft fields and visible Apply/reset controls | Keep the useful inline toolbar | Only Apply changes the table; closing discards draft |
| Settlement period | Short sheet containing the existing labeled native date input | Keep the native inline date control | Apply validates with the existing period function and navigates to the same route |
| Outcome / assignment resolution | Shared responsive dialog, body scrolling when necessary | Bounded centered dialog | Existing read and resolution handlers, server validation and role rules remain |
| Payment entry | Focused sheet only when the current gated controls are requested | Keep bill context and payment panel visible together | Exact server amount, required retype/reference and existing preflight checks; no mutation on open/dismiss |

Use the existing native dialog or installed Radix implementation, without adding an animation dependency. Mobile sheets fit content up to 85dvh, with a distinct header, scrollable body and reachable actions. Use at least 44px targets, safe-area padding and 16–24px internal spacing. Desktop dialogs stay approximately 34rem wide, bounded by the viewport. Long multi-step review remains a full page; a short filter must not force a full-screen flow.

If a drag affordance is shown, implement drag on the handle only. Ordinary body scrolling must never dismiss the sheet. Close and Escape remain accessible alternatives. Financial entry cannot swipe away while dirty and cannot dismiss while a request is pending; provide explicit cancellation before submission. No gesture confirms a payment. Return focus to the opener, lock background scrolling without a horizontal layout jump, and avoid nested modal dialogs.

Motion should express opening/closing only, around 180–240ms with a single smooth translation. No springs, rocking, repeated page transitions or dashboard intro gate. Reduced motion skips spatial movement. Sheets use the existing neutral card surface, readable foreground, restrained selection fill and semantic button states.

## Independent acceptance

Verify 320/375/768/1440 widths, a short desktop viewport, Vietnamese/English/Chinese, keyboard focus containment/restoration, Escape and explicit close, drag vs body scroll, touch target bounds, safe-area action visibility and reduced motion. Test draft cancel/apply/reset, valid/invalid dates and navigation, background inertness, and no document overflow. Exercise payment form UI using an isolated fixture or intercepted reads; do not send real financial mutations merely to test presentation. Existing API/role/amount invariants must remain passing.
