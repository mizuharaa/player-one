# PLAYER ONE: real-text entrance

The owner's exact 2.3-second specification replaces the previous SVG intro. The hero headline is now the exact uppercase `PLAYER ONE`. Navigation, film, page scrolling and calls to action are available immediately; the full-screen SVG intro is no longer mounted. Static navigation/footer logos remain.

| Scene | Visual story | Website copy |
| --- | --- | --- |
| Entrance, 0–0.15s | Full reserved text footprint fades in and rises 6px. | Scrambled uppercase letters in PLAYER ONE's slots |
| Shuffle and resolution, 0.15–1.90s | Independent A–Z substitutions resolve mostly left-to-right; PLAYER completes before ONE. Correct letters settle upward 3px without bounce. | PLAYER ONE |
| Reading hold, 1.90–2.30s and afterward | Sharp, still text remains in the hero. | PLAYER ONE |

The established Archivo font, weight, responsive sizes, white-on-film palette and center alignment are retained. The two words never break internally. Whole shaped words reserve layout, and DOM Range measurements place character slots as percentages of each word. Temporary glyphs are centered; final glyph windows use the original fully kerned word. At completion the natural baseline is shown without altering layout.

One elapsed-time requestAnimationFrame timeline drives all characters. Deterministic character schedules use 45–65ms intervals, slowing to 80–110ms near each lock. Lock times are 670/805/925/1060/1215/1350/1480/1590/1750ms; each settle lasts 120ms with quartic ease-out. All motion ends by 1870ms. The loop stops at 2300ms, with cleanup on unmount. Font readiness and first intersection gate playback, not page interaction. Resizing doesn't rebuild or replay the timeline. Reduced motion displays final text immediately. The heading exposes one exact accessible label; all scrambled glyphs are decorative.

Reference: [Fauna Robotics](https://faunarobotics.com/), refreshed this turn, alongside prior motion observations in `fauna-motion-reference-2026-09-09.md`. The retrieved page text cannot establish frame timing; the owner's explicit choreography is the timing authority. Motion-design skill was inspected and is scoped to generated films; Impeccable animate guidance supplies the browser implementation workflow. No generated video or new dependency was used.

Console typecheck and production build passed (9.27 seconds, 295 modules). Independent numeric schedule checks passed. Local browser first load/reload at 1440 and first load at 375 measured zero character slot x/width drift, zero final word handoff drift and stable final text. Completion was observed on the next browser frames at 2320.8–2331.3ms. Navigation clicked successfully at 14.9ms, reduced motion showed final text without a clock, and intersection/resize did not replay. No page errors. Desktop and mobile final screenshots were visually inspected; all browsers closed.

Reviewed snapshot `scratchpad/railway-release-kN07iH`: 312 files, 19,269,010 bytes. Every source hash matched before upload and after SUCCESS. Railway deployment `39d7fb37-86e9-43e5-9f3b-8bc131bc77d2` is live and independently accepted. Public 1440 first/reload completion was observed at 2319.3/2323.7ms, with zero slot/handoff drift and a stable hold/final state. Mobile reduced motion showed final text immediately; early navigation worked before font readiness/playback. Health returned 200 with `ready:true`, CSP was present, and there were no page/console/CSP errors. All browsers closed. See [independent QA](hero-letter-shuffle-independent-qa-2026-09-10.md) and `scratchpad/qa/hero-shuffle-independent/public/`. No Git commit or push.
