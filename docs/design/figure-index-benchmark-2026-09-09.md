# Figure Index: feature benchmark for PlayerOne

Research date: 9 September 2026. Scope: public official pages, developer-maintained app-store listings and five published Android store screenshots. No account was created, no application was submitted, and no authenticated app workflow was tested. This is a feature benchmark and design input, not a production-readiness audit.

## Identify the product correctly

**Index is Figure AI's human-data collection application and contributor network. Helix is the robot AI trained using that data.** Figure announced Index on 25 August 2026. The official Android package is `ai.figure.index`; the iOS app ID is `6800436796`. These are not Valve Index, the financial company at `figure.com`, or the unrelated application at `figure.dev`. The six Chinese screenshots supplied by the owner are a separate benchmark; their publisher is not established by those screenshots alone. [Figure announcement](https://www.figure.ai/news/introducing-index), [Google Play listing](https://play.google.com/store/apps/details?id=ai.figure.index), [Apple listing](https://apps.apple.com/us/app/figure-index/id6800436796).

Figure's announcement describes automated quality screening, human fraud sampling, deduplication, balancing and annotation. That is a different review contract from PlayerOne. **Do not import automated acceptance or sampled review into PlayerOne's payout story.** Our human reviewer determines the approved effective minutes for an episode. [Figure announcement](https://www.figure.ai/news/introducing-index); PlayerOne `PRODUCT.md`, `CLAUDE.md`.

## What the official public material establishes

| Area | Public evidence | Evidence boundary |
|---|---|---|
| Recruitment | Apply to join; application waits for acceptance; the applicant is notified. | Public availability does not establish immediate enrolment or availability in every country. |
| Before acceptance | Applicants can browse task examples, preview services and learn about earnings. | A preview is not a live task allocation or payout entitlement. |
| Equipment | Accepted creators sign up to receive a recording device. | No public source inspected establishes shipping terms, deposits, inventory, ownership or supported pairing protocols. |
| Recording and earnings | Creators perform everyday tasks and the listing describes payment by the minute. | No confirmed rate, currency, eligible-minute formula, minimum withdrawal, payment schedule or dispute process. |
| Two-sided service | The app also accepts applications to book professionals for home or business tasks. | This service marketplace is Figure's additional business model, not a missing PlayerOne MVP feature. |

The table above paraphrases the developer's [Google Play description](https://play.google.com/store/apps/details?id=ai.figure.index), updated 26 August 2026, and [official Index page](https://www.figure.ai/index-app). It does not establish implementation behind the screenshots.

The Apple listing includes Vietnamese, English, Simplified Chinese and Traditional Chinese within its eleven advertised languages. This establishes a localisation benchmark, not translation quality or complete language coverage. The listing requires iOS 18 or later; that is not an appropriate device-support floor for PlayerOne's Android-first collector population. [Apple listing](https://apps.apple.com/us/app/figure-index/id6800436796).

## Public screenshots inspected

These screenshots are developer-published marketing material. They show visible information hierarchy, not verified behaviour. Direct image links are retained so the design and QA agents can inspect the same evidence. They must not become PlayerOne product assets.

| Screenshot | Visible information | Feature lesson, without copying the layout |
|---|---|---|
| [Onboarding](https://play-lh.googleusercontent.com/C35U1N7W_od8r_V_V_0a3HpoXYyQZ7ZtAp4-_Jd8LEGXcTgVQ0kffrRMxHAGM8Vb3JJcr77sYIasaS5z5X5raGk=w600) | A person doing an ordinary task while wearing the device; a short purpose statement and swipe progression. | Explain the work using a concrete action before presenting mechanisms. A person wearing the device is an external view, not its POV. |
| [Task list](https://play-lh.googleusercontent.com/0mSXTDJusgIJfRFHkGFwAnha08vtBmSuBBOTca0TOz_-9Lvn2-sdecO8t9LYfPyaWZBE4zx6rPrVzd_QkRylLQ=w600) | Task names, short instructions and category tags; examples include table setting, waste removal and folding clothes. | Let collectors recognise work they already do. Categories and specific instructions should help them choose. |
| [Dishwasher task](https://play-lh.googleusercontent.com/j65nWlfek--UNKD9i8mcYPSXy45mbuZy4Z_wgf6GQ9GKQDdIMrgStJj6PcUhsA7nLoCdmzCNVHW8LQkVLVtUN54=w600) | A task detail sheet with instructions, categories, minimum time and a Start Task control. | Put task conditions before commitment. A button's label alone does not prove that it operates a camera. |
| [Room task](https://play-lh.googleusercontent.com/l-klKxDwNXXDEDjX7gZRcjaEGC7ieEJIRb9i6yaEigkpuuR9pJ5LReSe_4CcFQ2CQs1MPitiblOwTJl4l3ig=w600) | The same task-detail information in a different scene. The recording device sits above the wearer's eyes. | Preserve the task's information order between categories. Use verified PaXini hardware references for our generated scenes, not Figure hardware styling. |
| [Plant task](https://play-lh.googleusercontent.com/66fdlHIFnBylf2H2_4q6C8Y83F7-TAHvz9DvfPH8GYtHyx_y-7MBpXf5VlPiVGGEtdBVOWjiChLTODMdc7B6m4k=w600) | Another detail example with an action description, categories and minimum duration. Both eyes remain visible beneath the device. | Show a single believable action and clear hardware placement. Competitor example durations do not become our task requirements. |

## Privacy and terms: what is actually public

The relevant document is the **Index-specific** privacy policy, updated 11 August 2026. It covers creators' contact, device, age, location and sensory recording data. It describes disclosure to service providers, affiliates, recruiting intermediaries, employers and commercial purchasers, including commercial sale/disclosure. It offers a contact route for requests including access, erasure and opting out of sale, subject to applicable conditions, and excludes under-18 app users. This is a record of the competitor's disclosed policy, not a legal recommendation for PlayerOne. [Index privacy policy](https://www.figure.ai/index-privacy-policy).

The policy references separate Application Terms of Use. The public footer instead links to website terms dated February 2023. Those website terms do not establish creator remuneration or the app's full contribution contract. No complete application terms, bystander authorisation screen, identity-verification implementation or task-level consent sequence was verified in this research. [Index privacy policy](https://www.figure.ai/index-privacy-policy), [website terms](https://www.figure.ai/terms-and-conditions).

**Do not translate the competitor's privacy claims into PlayerOne promises.** In particular, do not copy a blanket no-third-party-sharing claim, promise a deletion outcome the platform cannot provide, or introduce identity-document scanning, police-database checks or face liveness because they appear in a supplied competitor screenshot.

## PlayerOne feature implications for the MVP

The following are design recommendations or existing spec requirements, not claims about what is missing from today's code. The build/QA lanes must check the implementation separately. Requirement references come from `C:/Users/user/Downloads/Player One — Engineering Brief v1.0.md`, read during this research, with binding later decisions in `CLAUDE.md`.

| Surface | Decision to support | PlayerOne basis | What must not be borrowed |
|---|---|---|---|
| Public page | Understand the work, inspect an honestly labelled demonstration, find the actual available next action. | Two audiences and truthful release availability in `PRODUCT.md` and owner brief. | Figure's contributor totals, global footprint, service-booking model or an invented PlayerOne waitlist endpoint. |
| Task hall | Choose suitable work from task type, instructions, price basis, duration target, progress and claimable state. | APP-08–10. | Competitor task quotas, arbitrary rates or decorative countdown scarcity. |
| Task detail | Know the scenario, permitted activity, boundaries, payment rule and privacy notice before claiming. | APP-09, APP-12. | A pretty photograph standing in for actual task instructions. |
| My tasks | Find claimed tasks and understand what state each is in. | APP-11. | Treating collected, uploaded, reviewed and paid as equivalent. |
| Equipment | Bind by QR/device ID; see real bound-device state; understand why preparation is blocked. | APP-14–15, APP-18; later hardware decisions in `CLAUDE.md`. | A simulated connected state, invented battery level, or a fake device-order flow. |
| Preparation | Bind task, collector, device and scenario to one session; capture the two APP-17b declarations. | APP-16–17b. | A Start recording action in the app. Physical camera buttons start and stop recording. |
| Eligibility | Make registration agreements, training and exam requirements understandable before task claiming. | APP-02–05, PRV-01–02. | Competitor identity verification steps as new PlayerOne requirements. |
| Earnings | Explain reviewed approved effective minutes and show server-provided settlement state. | `PRODUCT.md`, `CLAUDE.md`, engineering brief settlement requirements. | Pending footage valued as withdrawable cash; unimplemented instant withdrawal; another platform's currencies. |
| Language and help | Prioritise Vietnamese collector comprehension; give actionable failure reasons and help routes. | LOC-01, LOC-03–04. | A language menu whose task text, errors or money labels remain in another language. |

## The strongest transferable pattern

**Make progress possible before a collector is ready to record.** Index's public application preview offers task discovery while admission is pending. PlayerOne can apply the principle to its honest product demo and existing eligibility flow: discover the work, understand a task, know which prerequisite is unmet, and follow a real next action. That is more useful than copying visual cards or adding another disabled download button.

For the landing's phone demonstration, the truthful sequence is: **browse → inspect a task → demonstrate claiming/preparation → show the physical camera-button instruction → reveal an explicitly illustrative POV scene**. A demo must remain a demo, with no live claim request, invented payable total or implied phone-controlled recording. Build its text and states from PlayerOne's existing product model.

## Research boundaries

- The official sources are sufficient to benchmark Index; no extra competitor was added merely to increase the count.
- No claim is made that the supplied Chinese app is Index or that its displayed balances, quotas or identity-check promises are suitable for Vietnam.
- No live eligibility, real shipment, recording session, payment, claim rejection, device pairing, offline sync or deletion request was executed.
- No app code, database, CI gates or QA scripts were changed or run. Independent QA remains with Claude.
