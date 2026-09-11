# PlayerOne showcase release direction

The owner's latest request preserves the accepted composition and adds a colored assembled brand, restrained image interaction, a second supplied film, Truc help, a cinematic sign-in screen and a consistent operational shell. It explicitly supersedes the previous monochrome wordmark, plain sign-in, partner-only orange/blue rule for the wordmark, and lower-film selection. Root directs; Astra agents implement; Claude independently measures.

## Visual Story

| Scene | Visual story | Website copy |
| --- | --- | --- |
| Opening | Black geometric pieces unfold on the light ground, join into PlayerOne, then ease into orange Player and blue One before docking into navigation. | PlayerOne; existing localized slogan. |
| Task demo | Heading and supporting copy share a deliberate alignment above the existing interactive phone surface. | Choose familiar work; prepare the camera. Physical buttons start recording. |
| Collectors | Existing unequal photographs rest in grayscale on hover-capable desktops; hovered or keyboard-focused images regain color with a small contained enlargement. Touch retains full color. | Existing activity captions and illustration disclosure. |
| Human review | The expressly requested September 6 film replaces the repeated still. It remains labelled an illustrative external view, not footage captured by Ego or a wearing-position guide. | A person reviews the recording. Approved effective minutes determine payment. |
| Questions | Existing Truc 3D asset returns beside useful questions; a working help panel clearly identifies the AI feature as a placeholder. | Questions about collecting; AI assistance coming later. |
| Sign in | A balanced video/form split on desktop reflows around usable credentials on mobile. | Existing real operator/reviewer sign-in flow. |
| Console | The same wordmark, typography and restrained lavender/ink shell surround live task and review data. Operational navigation remains explicit. | Existing authenticated data and existing API errors. |

The intro remains finite and skippable. Only assembled pieces change color; there is no replacement heading fade. Photo transforms stay within their fields. The operational dashboard does not inherit cinematic scroll behavior.

## Privacy and unfinished capabilities

Provide a public privacy draft and a persistent Accept/Decline choice with a way to change it. Neither choice enables nonexistent tracking or claims legal compliance. Essential authentication continues to work. Truc must not simulate a model response or transmit questions to an invented endpoint. Unavailable APK, storage, payment and other integrations must report their actual state rather than redirect to a dummy success page.

## Deployment

The repository is a Vite console plus a Fastify/Node API and PostgreSQL. A correct showcase must serve API paths on the same public origin as the console so session cookies work. Preserve the special distinction between the client route `/episodes` and API routes under `/episodes/`.

No configured remote API, hosting deployment, or Railway/Render credentials were found in the workspace. The owner has been asked for an existing API URL or hosting account while deployment preparation continues. A static-only upload does not constitute end-to-end backend delivery.

Use a dedicated showcase database or existing explicitly designated service. Never run `seed-console.mjs` against existing data: it truncates tables. Apply migrations with the owner role and run the API with `playerone_app`, not a database superuser. Do not publish secrets, raw corpus files, screenshots, local env files or machine credentials. Public showcase deployment is authorized; no additional conversational deployment approval is needed once the account and runtime are available.

## Independent evidence

External Claude reached its weekly limit during this batch. A fresh independent UI agent checks the new intro and colors, keyboard/touch photo behavior, help/cookie controls, video playback, sign-in and authenticated navigation. A separate non-author audits deployment transport. Fixture-only authentication checks do not prove real credentials or a deployed same-origin session. Existing tests remain evidence for the earlier tree until rerun against this batch. Report any account or integration dependency explicitly.

## Subsequent owner direction: irregular assembly and repeat playback

The latest owner rejects the current smooth, predictable assembly. Keep the same
real SVG pieces and final wordmark, but replace uniformly eased travel with short,
irregular, stepped reconfigurations and brief holds before a crisp final lock.
Major primitives remain visually traceable; do not replace the SVG with HTML
character scrambling, a binary-number overlay or unrelated fading text. Keep the
pieces black until assembly finishes, then transition to orange Player / blue One.

Normal landing reloads now replay the intro by default. No query parameter or
session-storage reset is required. This supersedes the previous once-per-session
default. The intro remains skippable and reduced motion still bypasses it; the
operational console is not interrupted by a brand intro on every route change.
Any per-run variation must be generated once at mount and remain stable through
the run and React lifecycle. Cleanup must release scroll and remove every timer.
