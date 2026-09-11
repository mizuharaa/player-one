# Warm landing implementation handoff — 10 September 2026

Implementation frozen for independent review against `warm-landing-direction-2026-09-10.md`. No author acceptance, commit or deployment.

## Changed surface

- `apps/console/src/routes/Discover.tsx`: centered introduction with one POV specimen and factual callouts; separate camera heading; credited stock scenery; six truthful FAQ rows; payment details; aligned footer with the existing SVG wordmark; IntersectionObserver glass/solid navigation.
- `apps/console/src/components/discover/DiscoverDemo.tsx`: local TaskHall/TaskDetail/SessionCreate anatomy with search, setting filters, task selection, instructions, explicit yes/no declarations, back and reset. No default declaration, fabricated rate/capacity/progress, network write or recording action. The repeated shirt backdrop and demo POV reveal are removed.
- `apps/console/src/styles/discover-warm.css`: scoped warm layout and responsive composition. Existing hero lifecycle and stable scroll logic remain untouched. No gallery scroll transforms or global animation controls.
- `packages/design/src/tokens.ts`, `packages/design/generated/tokens.css`: named warm tokens; mapped only inside `.discover-page`, leaving the operational/login palette intact.
- `apps/console/src/lib/discover-warm-copy.ts`, `discover-copy.ts`: VI/EN/ZH copy with typed parity, factual setting/story placeholders, collector-demo disclosures and two additional FAQ questions using existing answers.
- `apps/console/src/components/logo-animation/logoChoreography.ts`, `compactGeometry.ts`, `logoMotion.ts`: same 32 paths, fixed letter columns from the first native frame, local register changes, exact geometry by 1.15 seconds, color until 1.35 seconds, dock until 1.8 seconds. Native pre-import geometry and GSAP share the initial pose. Existing Skip, reduced-motion, resize and deadline cleanup remain.
- `apps/console/src/components/shell/LocaleSwitch.tsx`: explicit native option foreground/background. Independent Chromium popup pixel check already confirmed the narrow fix; warm palette and other states still require final review.
- `apps/console/src/components/shell/AppShell.tsx`, `PillNav.tsx`, `apps/console/src/lib/workspace-copy.ts`: Demo studio navigation shown only with a real operator profile identity; three localized labels. Backend agent owns the route and permission enforcement.
- `apps/console/src/routes/Profile.tsx`, `apps/console/src/styles/workspace.css`: sign-out hover/focus uses existing red semantic tokens. Dashboard layout, financial states, authentication and API flows are unchanged.

Root supplied four unique stock files under `apps/console/public/discover-media/`; sources, author names and licenses are recorded in `stock-scenery-provenance-2026-09-10.json`. Each rendered image links its photographer/source. Stock scenes are explicitly illustrative, separate from the retained AI collector pictures; no testimonials, ratings or confirmed locations are asserted.

## Author checks and limits

- `pnpm -F @playerone/design build:css`: exit 0.
- `pnpm -F @playerone/console exec tsc --noEmit`: exit 0 after final changes.
- `pnpm -F @playerone/console build`: exit 0, 7.21 seconds. Existing large JS/Panda chunk warning remains.
- Scoped `git diff --check`: exit 0; Git reports normal LF/CRLF conversion notices.
- One author `withBrowser/newPage` session captured introduction/demo/FAQ at 1440×900 and 375×900; document horizontal overflow was 0 at both widths. Captures `scratchpad/warm-{introduction,demo,questions}-{1440,375}.png` precede the final stock and logo changes. They are composition evidence, not acceptance. The session exposed redundant mobile demo context, now removed on mobile while preserving the disclosure and complete app panel.

Independent QA owns the final 320/375/768/1440/1920 and 1440×600 matrix, VI/EN/ZH, actual native popup, normal/reduced motion, keyboard, menu, anchors, expanding FAQ/payment panels, demo search/filter/back/reset/declaration behavior, sign-out states and operator/reviewer navigation. Specifically recheck zero heading-opacity resets after idle plus 4px scroll, exact logo lock/dock and cleanup, equal glass/solid nav bounds, retained final hero headline, no idle animation callbacks, and final screenshot composition. Browser lane was released before this handoff. Native OS pickers beyond Windows Chromium and physical mobile performance are unmeasured.
