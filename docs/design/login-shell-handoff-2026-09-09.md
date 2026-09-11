# Login and operational shell handoff — 9 September 2026

Builder implementation only; independent acceptance remains outstanding. Worktree: `C:/Users/user/pw/ui-integrate`, branch `sprint/ui-revamp`. No deployment, database command, seed, credential creation or commit was performed.

## Delivered

- `apps/console/src/routes/Login.tsx`: desktop 50/50 film/form layout; mobile form-first single column; original role radios, machine/operator credential names, autocomplete groups, request payload, cookie behavior, errors, busy state and successful redirects retained.
- `apps/console/src/components/shell/LoginFilm.tsx`: existing `opening.mp4` and `opening-poster.webp`, explicitly illustrative; play/pause control; reduced-motion and data-saver suppress automatic playback; hidden/offscreen playback pauses; poster/error fallback does not gate sign-in. No landing component or GSAP dependency.
- `apps/console/src/components/shell/ConsoleLogo.tsx`: shared colored `AssemblyLogo`, selecting the logo agent's light/dark surface treatment according to the current theme. No logo geometry or intro-animation edits.
- `apps/console/src/components/shell/AppShell.tsx`: lavender/ink shell, scoped Archivo, actual operator identity and labeled server queue/pace figures, workspace skip link, compact-screen native dialog drawer. Dialog keyboard events stop before operational page shortcuts. Existing optional guide offer remains.
- `apps/console/src/components/shell/PillNav.tsx`: all seven existing routes and partial-build mark retained; visible text labels on desktop and drawer; active-page semantics retained.
- `apps/console/src/styles/operations.css`: scoped login/shell styles, responsive form and navigation, keyboard focus and wrapping role controls. Existing operational table scroll containers, tabular figures, status colors and review theatre remain.
- `apps/console/src/lib/ops-copy.ts` and `lib/i18n.ts`: Vietnamese/English/Chinese presentation copy. Shared locale selection/storage remains; `/privacy` now receives the same unsaved Vietnamese public-page default as `/discover`, coordinated with the public-page owner.

No native collector code or operational Home data/business logic was changed in this pass. The former single sign-in card and ink navigation bar were intentionally replaced. Both sign-in policy links now open the available `/privacy` draft; its sections have no IDs, so neither link invents an anchor. This pass did not author approved legal documents.

## Author checks

- `pnpm --filter @playerone/console typecheck`: exit 0 after the final implementation.
- `pnpm --filter @playerone/console build`: exit 0, Vite reported completion in 6.72 seconds. It also reported chunks above 500 kB; no claim of load-time optimization is made.
- Scoped `git diff --check` across the eight implementation files: exit 0, Git line-ending notices only.

No browser, visual acceptance, authentication attempt, database test or screenshot was performed by this builder.

## Independent recheck

1. Desktop login split and 320/390/768px single-column form; short heights, 200% zoom and all three locales. Role controls/labels must wrap and every credential/submit remain reachable without nested scrolling.
2. Compare operator/reviewer requests: `POST /api/session`, same-origin cookies, machine fields absent for reviewer, error-specific responses and successful reviewer/home redirects. Use authorized credentials; do not run the destructive demo seed.
3. Block video; deny autoplay; enable reduced motion; hide the tab and scroll the mobile film offscreen. Confirm form remains usable and film play/pause, visibility and poster behavior match the labels.
4. Open/close compact navigation by pointer and keyboard; Escape, focus containment/return, current route and all seven links. On Review, navigation keys must not reach verdict/playback shortcuts behind the dialog. Resize across 960px with the drawer open.
5. Inspect light/dark logo, header and real data/error/empty states, wide table scrolling, main-content skip link, long operator IDs and Vietnamese/Chinese labels. No financial/statistical substitutes were added.

## Deployment inventory handed to the deployment owner

API entry: `pnpm serve` → `node packages/api/bin/serve.ts`; `HOST`/`PORT` default `127.0.0.1`/`8080`. Required names: `DATABASE_URL`, `PLAYERONE_TOKEN_SECRET`. Frontend build emits `apps/console/dist`; Vite dev is port 5173 and proxies `/api`, `/auth`, `/media`, `/whoami`, `/reference`, `/handovers`, `/upload-batches`, `/episodes/` to `PLAYERONE_API` or local port 8080. Bare `/episodes` stays an SPA route. Production needs equivalent same-origin routing for cookies.

No verified remote backend target or deployment host was established by this lane. `seed-console.mjs` truncates tables and creates demonstration records; it was inspected only and is not a production identity bootstrap. Existing authenticated operation requires valid active machine/operator credential hashes (or the scoped reviewer identity) in the chosen database. Environment variable names were reported; secret values were not printed.

Implementation is frozen pending independent findings.
