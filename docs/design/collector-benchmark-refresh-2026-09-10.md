# Collector benchmark refresh

Official-source research and bounded PlayerOne source comparison, 10 September 2026. No competitor account created, no app installed, no payment or submission performed. Listings establish advertised capabilities, not verified runtime behavior. The six supplied Chinese screenshots still do not establish their publisher or a connection to Figure.

| Official source | Supported observation | Useful PlayerOne implication |
| --- | --- | --- |
| [Figure Index app](https://www.figure.ai/index-app), [developer Google Play listing](https://play.google.com/store/apps/details?id=ai.figure.index) | Application/waitlist, browsing tasks while awaiting acceptance, recording-device signup, everyday work and minute-based compensation are still advertised. The separate service-booking audience remains part of Index. | Show useful task discovery before readiness, state missing prerequisites, and explain the actual camera workflow. Service booking is not a missing PlayerOne requirement. |
| [Figure announcement](https://www.figure.ai/news/introducing-index) | Describes filtering, sampled human fraud review, deduplication, balancing and annotation. | Keep PlayerOne's human-reviewed effective-minute contract explicit; do not import Index's acceptance pipeline or scale claims. |
| [RoboX developer listing](https://play.google.com/store/apps/details?id=to.robox.robox) | Advertises practice recordings, campaign-specific duration/orientation/quality instructions, submission history, verification feedback and retries. It also advertises rewards, payout requests, referrals and account deletion. | Borrow clear preparation, task conditions and actionable rejection feedback. Do not borrow smartphone recording, automated acceptance, crypto payouts or referral incentives as PlayerOne features. |
| [RoboX official documentation](https://docs.robox.to/) | Describes region onboarding, campaigns and contribution tracking; still labels entry private beta. | Separate accessible product information from admission/availability. Public documentation and store claims have different dates and scope; neither proves end-to-end behavior. |
| [Hub Data developer listing](https://play.google.com/store/apps/details?id=xyz.hub.mobile) | Describes eligible task discovery, capture/submission, team review and payment for accepted work, across photos, video and first-person tasks. | Make eligible, submitted, reviewed and paid states distinct. Do not infer supported PlayerOne hardware from Hub's general device support. |

The earlier `figure-index-benchmark-2026-09-09.md` remains directionally supported by the refreshed official pages. No newly verified Figure feature justifies expanding MVP scope. Index rates, payout formula, schedules and actual language completeness were not independently verified. Competitor privacy claims are not PlayerOne guarantees.

## Correcting stale PlayerOne gap claims

The older `collector-feature-benchmark-2026-09-09.md` predates subsequent fixes. A current source check confirms:

- `apps/collector/src/screens/TaskHall.tsx` now has title/scenario search, available-only filtering, and explicit load/refresh failure with retry. Do not continue reporting those as absent.
- `screens/SessionCreate.tsx` now starts scenario at null and requires explicit scenario and declarations; pending creation disables the action. Do not claim the old silent home default remains.
- `apps/collector/src/App.tsx` now chooses `UnavailableDeviceTransport` in real mode and `MockDeviceTransport` only in mock mode. The old claim that real mode always simulates hardware is stale.
- `apps/collector/src/locale.tsx` still holds locale only in React state at this source snapshot; no persistence is present there. No Account/Profile screen appears in the current screen list. These remain focused implementation checks for the builder, not runtime conclusions about the ongoing revamp.

Recommended priority is complete task conditions and readable instructions, truthful readiness/recovery, attributable work status, then account/language/support continuity. Preserve physical camera recording controls, staffed TF-card handover where applicable, and server-provided financial figures. Approved training/legal content and real hardware transfer remain separate requirements, not features that a competitor screenshot can supply.

Source inspection is planning evidence only. New builder changes require their own frozen-source and runtime acceptance; native Android behavior is not certified by this website browser research.
