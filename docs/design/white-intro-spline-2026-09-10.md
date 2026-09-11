# White intro and supplied Spline phone

The owner requested the white prelanding screen again, stronger letters with a smooth settle, and the exact supplied Spline iPhone scene. This refines the accepted real-text shuffle and collector demo; it does not reinstate the earlier SVG swinging animation.

| Section | Visual | Interaction and motion |
| --- | --- | --- |
| White opening | Centered Archivo PLAYER ONE, weight 650, warm white and espresso | Existing 2.3-second anchored A–Z shuffle, orange/blue color settle, 300ms page handoff; skip, Escape and navigation remain available |
| Film opening | Existing wide film with stronger still typography | Full label remains after the intro; reduced motion bypasses the overlay |
| Collector demo | Supplied iPhone 14 Pro scene, curved dark rim and stationary drop shadow | Real HTML search, filters and task preparation stay inside the screen; scene loads near visibility with a usable fallback |

Scene: https://prod.spline.design/kUdcRT9H2Xli6pPZ/scene.splinecode. The existing app uses Vite React, so its integration uses `@splinetool/react-spline` rather than the Next.js-only entry. The scene attribution remains visible.

The intro waits for its font, preserves each natural character slot, and fails open if font loading stalls. It never locks page scrolling or focus. The model is decorative; keyboard and touch interactions use the actual demo controls. Reduced motion uses the stationary fallback.

The response policy permits the two Spline asset hosts and WebAssembly compilation. JavaScript evaluation, inline scripts, frames and objects remain blocked. This batch does not change authentication, database privileges or payment logic.

Validation so far: numeric timing test, final console typecheck, response-policy test and production build passed (415 modules, 25.38 seconds). Build reports large lazy SDK chunks and optional decoder paths; the supplied scene fetched its actual scene/process/physics resources successfully through the production server policy.

Independent intro checks passed all nine cases: desktop/mobile slot width drift was zero, handoff fade measured 328/334ms after the 2.3-second clock, and Skip/Escape/navigation/scroll/reduced-motion behavior worked. Rejected or unresolved fonts failed open. Screenshots and frame evidence: `scratchpad/qa/white-intro-independent/`.

Independent production-proxy checks reached the actual model at 1440/375px and completed search/task/preparation/restart in normal, reduced-motion and simulated network-failure cases. No page overflow or idle/offscreen WebGL drawing was measured. Initial QA found the model attribution obscured by the HTML screen and a frame-resizing defect after returning from offscreen; corrections are under final validation.

The SDK's MessagePack decoder tries an optimized `new Function` decoder, catches the CSP denial, and continues with its ordinary field-loop decoder. This produces one expected blocked-evaluation event on scene load. JavaScript evaluation remains prohibited; actual model loading succeeds. Independent injected inline script and event-handler probes were blocked. Reduced-motion toggling removes and reloads the model successfully. Trace: `scratchpad/qa/spline-independent/trace.json`.

Final local acceptance passed after both corrections. The native canvas badge now occupies an additional 80px below the phone; its original rendering remains untouched. The wallpaper mesh is hidden behind the actual HTML. Returning from an offscreen desktop-to-mobile resize redraws the correctly sized frame and then stops drawing again. Root visually inspected the final mobile capture. Final build passed in 18.49 seconds, typecheck passed, and the 316-file snapshot matched every source hash.

Uploaded snapshot: `scratchpad/railway-release-dDj8cJ`, 19,281,866 bytes. Deployment: `e15d5445-23a8-40fd-a2ca-27b03fed4cea` is SUCCESS and independently accepted publicly. White intro first/reload, mobile actual Spline with full attribution, demo flow and reduced-motion fallback passed. Scene/process/physics requests returned 200; no page or console errors. Root verified ready:true and all 316 source hashes after SUCCESS. See the [independent report](white-intro-spline-independent-qa-2026-09-10.md). No Git commit or push was performed.
