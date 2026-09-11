# Supplied Spline iPhone — implementation handoff

Scene: `https://prod.spline.design/kUdcRT9H2Xli6pPZ/scene.splinecode` (1,335,431 bytes measured download). Browser inspection confirmed an upright **iPhone 14 Pro**, Dynamic Island, screen/wallpaper and metal border, originally above a gray pedestal. Evidence: `scratchpad/qa/spline-author/scene-inspection.png`, `scene-framed.png`.

## Scoped implementation

- `apps/console/package.json`, `pnpm-lock.yaml`: exact `@splinetool/react-spline` 4.1.0 and `@splinetool/runtime` 2.0.44. Uses React/Vite entry, not Next.js entry.
- New `apps/console/src/components/discover/DiscoverSplinePhone.tsx` and `discover-spline-phone.css`.
- `DiscoverDemo.tsx`: wrapper around the original working HTML; resets inner scroll on each step before focusing its heading. Existing task/search/filter/preparation handlers remain unchanged.

The named `bg` group and decorative `Screen` wallpaper are hidden; phone geometry, metal border and Dynamic Island stay. Front-facing alignment uses base scale 2.15 at390px, proportional to container width, with x108/y650. HTML is layered inside the screen; it remains the only demo interaction. Device has fixed aspect390/800 with inner native scrolling. Fallback and loaded screen share insets; canvas has a stationary shadow.

IntersectionObserver loads near the visible phone, skips WebGL for reduced motion, and stops rendering offscreen. Initial and resize rendering are bounded to two animation frames followed by `app.stop()`. There is no idle animation loop, pointer orbit or parallax. Hidden document stops the runtime. The React SDK owns disposal. A20-second load cap/error boundary leaves the CSS device and complete HTML available.

The SDK calls `onLoad` for a disposed StrictMode instance with zero scene objects. Author reproduction found that rejecting that stale callback incorrectly removed the live scene. Empty disposed callbacks are now ignored; global StrictMode is unchanged.

Spline attribution is retained in full. SDK inspection confirmed it is a canvas-drawn `SplineWatermark` texture in `logoOverlayPass`, not a DOM anchor. The canvas now extends80px below the phone, with96px layout reserve; the phone is offset upward to retain HTML alignment. This exposes the original badge below the HTML without replacing, cropping or obscuring it. The obsolete anchor selector was removed.

## CSP and source limits

Observed remote requests: scene from `https://prod.spline.design`; `process.wasm` and `physics.wasm` from `https://cdn.spline.design/@splinetool/runtime@2.0.44/build/`. No separate remote image/font host observed. Runtime also creates same-origin blob workers.

Required additions: those two `connect-src` hosts; WebAssembly-specific `script-src 'wasm-unsafe-eval'`; existing `worker-src blob:`. **No JavaScript `unsafe-eval`.** Root owns and has tested the policy patch. Independent production-proxy check remains required. No scene/license ownership claims are inferred from the supplied URL.

## Author checks and independent QA

- Console typecheck exit0 before final small source adjustments; root runs final combined checks.
- Production build exit0 (22.40s) before final lifecycle/mobile adjustments. New SDK build warns about optional Draco/boolean WASM paths and large lazy chunks. Those optional decoder paths were not requested by this scene during author inspection; production network/CSP acceptance must verify the supplied scene.
- `scratchpad/local-demo/spline-integrated.mjs` uses `withBrowser/newPage`, with software WebGL explicitly enabled. 1440/375 normal motion reached ready;375 reduced used fallback. No page errors/horizontal overflow. Screens/results in `scratchpad/qa/spline-author/`. The first375 capture exposed fixed world sizing; proportional width scale was then added and awaits independent recheck.
- Browser lane released to independent QA; no active author browser or deployment.

## Attribution and resize correction

Author captures `attribution-375.png` and `attribution-1440.png` confirm the full badge below the frame, ready state, zero horizontal overflow and no page errors. After those captures the named decorative wallpaper was hidden at the director's request; independent QA verifies the final appearance. Visible intersection return and document visibility return now call the bounded paint routine, refreshing scale/render after an offscreen resize. Typecheck exit0 before the final wallpaper line; root owns final combined build and recheck.

QA: assert one phone, supplied model ready, correctly aligned frame at375/430/768/1440; attribution visible and keyboard reachable if linked; no loading movement or screen-layout jump; all form states usable with keyboard and200% text; lower task selection and preparation transitions reset inner scroll; reduced-motion toggle on/off; timeout/WebGL/network failure fallback; offscreen/hidden stop; production CSP permits only observed resources. Root owns final build and release.
