# PlayerOne modular wordmark

`logoPieces.ts` is the editable vector master: 32 filled, outlined SVG fragments
in one final-layout `0 0 784 152` viewBox. This is original geometric lettering
created for PlayerOne; the incumbent supplied asset only contained the two lens
circles and its old wordmark was HTML text. No Fauna artwork is used.

`playerone-wordmark.svg` is the reusable static SVG export of those exact same
32 paths, with one shared viewBox and an accessible title. Player is orange and
One is blue. The `-dark.svg` export uses lighter blue for ink surfaces; the
`-monochrome.svg` export uses `currentColor` for single-colour applications.
`logoPieces.ts` remains authoritative. After editing geometry, regenerate the
asset from the repository root with Node 22.18 or later:

```sh
node apps/console/src/components/logo-animation/export-master.mjs
```

The same `AssemblyLogo` must be rendered in the navigation, with its SVG ref
passed to `LogoAssemblyIntro.targetRef`. Give the navigation SVG a CSS width,
automatic height and no padding. `AssemblyLogo` is colored by default: the
`surface="light"` default uses tech-600 blue, while `surface="dark"` uses
tech-400 against an ink navbar. Orange is sun-500. `monochrome` opts into
`currentColor`. The intro reads the target's colors for an exact docking match.

```tsx
const logoRef = useRef<SVGSVGElement>(null);
<AssemblyLogo ref={logoRef} title="PlayerOne" surface="dark" className="nav-logo" />
<LogoAssemblyIntro targetRef={logoRef}
  onComplete={({ played }) => revealHero({ animate: played })} />
```

The 1.5-second timeline begins as scrambled black glyph fragments inside the
wordmark's own bounds. Three rapid local register changes use zero rotation,
then exact lock at 0.9s, color by 1.1s, and docking by 1.5s.
`logoChoreography.ts` stores deterministic waypoints and a monotone cubic Hermite
evaluator. Each channel remains within its authored interval, avoiding spatial
overshoot. A single GSAP clock owns every fragment transform. Stem, curve, bar,
connector and anchor groups describe geometry roles rather than flying routes.
Every fragment is present in its own local glyph region from time zero.
Every destination comes from the final SVG geometry, never viewport letter offsets.
SVG transforms use a view-box CSS origin and one explicit GSAP `svgOrigin`
measured from each piece. Both the native startup matrices and GSAP use this same
coordinate space; applying a fill-box CSS pivot as well would double the origin.
Shared glyph joins overlap by 0.3 SVG units to avoid antialiasing cracks. Debug
mode deliberately strokes every fragment, so assess final seams without debug.

`onComplete({ played: false })` also runs for reduced motion, explicit `skip`,
fragment/deep-link navigation, resize interruption,
Escape, the skip button or runtime failure. Parent content must already be mounted
and visible beneath the overlay. Use the callback to choose a short automatic hero
entrance versus immediately showing its final state. Do not hide the page awaiting
an intro download or wait for scroll input to reveal the hero.

Modes: `always` (the default and the Discover caller), `once-per-session`
(sessionStorage), and `first-visit` (localStorage). Normal landing reloads replay
without a query flag. Restored scroll and prior visits only suppress playback in
the optional storage-based modes. This component is mounted only on Discover,
so ordinary console navigation does not trigger an intro.
Preference key: `playerone:logo-assembly:v1`. Storage failures do
not block the page. Scroll locks, focus containment, listeners and GSAP context
are restored on completion and unmount. A 6.5-second production fail-open timer
prevents an interrupted timeline from trapping the page.

GSAP and the timeline module load only after an eligible intro mounts. Before
that chunk arrives, `compactGeometry.ts` places those same 32 pieces using native
SVG matrices derived from their bounding boxes. The compact mark therefore
appears immediately without a wordmark flash or substitute placeholder. GSAP
takes ownership in one synchronous microtask. The fail-open deadline includes
chunk loading, and cancelled effects never start a late timeline.

Development only:

- `?logoReplay=1` (or `?logo-intro=replay`) replays on reload.
- `?logoDebug=1` (or `?logo-intro=debug`) runs at quarter speed and exposes a
  time/progress scrubber, pause/play, 0.25x/1x speed, family outlines, family isolation and visible IDs. Hover a
  fragment for its ID. The slider pauses the master timeline for inspection.
- `VITE_LOGO_INTRO_REPLAY=true` enables reload replay in the development server.
- `DEBUG_LOGO_ANIMATION` in `LogoAssemblyIntro.tsx` enables the development debug capability
  during local trajectory tuning. Production ignores all debug/replay flags.

Reduced motion always wins over debug/replay. Paths inherit each piece's fill.
GSAP controls SVG/DOM transforms and the explicitly requested final fill color
transition; no paid plugin, canvas,
text reveal, random render values, raster logo or per-letter fade is involved.

Latest motion (2026-09-10): 1.5s total; three local glyph-register substitutions
with shuffled onset order and zero rotation. Exact natural geometry by0.9s,
black-to-brand color0.9–1.1s, docking1.1–1.5s. The shared vector master
balances P/l/a spacing and matches both e crossbars to the lowercase16-unit
stroke. All three SVG exports regenerated from that same master.


