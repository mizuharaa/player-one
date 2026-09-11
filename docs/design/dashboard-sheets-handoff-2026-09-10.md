# Responsive dashboard sheets — implementation handoff

Frozen for independent QA, not accepted or deployed by the author. The approved contract is [dashboard-sheets-direction-2026-09-10.md](dashboard-sheets-direction-2026-09-10.md).

## Research and scope

The fresh read-only `codex exec` process completed with exit 0 and was fully awaited. Its artifact is `scratchpad/mobbin-bottom-sheets-research.md`, archived as [Mobbin research](mobbin-bottom-sheets-research-2026-09-10.md). Nine actual Mobbin calls returned 19 inspected app screenshots and seven inspected previews from two flows. Every selected screen has a canonical link and returned image link; returned image URLs expire. The report separates screenshot observations from inferred behavior. No inspected flow established swipe dismissal or sticky actions. PlayerOne's 85dvh cap, 34rem desktop width and handle-only gesture are implementation choices.

## Files and behavior

- `apps/console/src/components/ui/ResponsiveSheet.tsx`: shared native modal with accessible heading, platform focus containment, explicit close/Escape, background scroll lock and focus restoration. Mobile fits content up to 85dvh, with a scrollable body and separate footer. Ordinary sheets offer a handle-only downward drag; body scrolling does not dismiss. Payment sheets show no drag affordance.
- `apps/console/src/styles/sheets.css`: neutral operational palette, desktop bounded dialog and mobile bottom sheet, 44px controls, safe-area footer and 200ms bounded entrance. Reduced motion removes spatial animation. No dependency or GSAP ticker added.
- `apps/console/src/routes/Episodes.tsx`: existing outcome/resolution modal now uses the shared shell. Resolution cannot dismiss while pending. Mobile filters edit drafts; Reset edits only the draft, Apply changes existing table filters, and Cancel/close discards drafts. Desktop inline filters remain. No new filter dimensions or untruthful counts.
- `apps/console/src/payout/pieces.tsx`: mobile period chooser contains the existing native date field, original `isPeriod` validation and same route navigation. Desktop keeps its inline control. Closing discards the uncommitted mobile value on the next open.
- `apps/console/src/payout/BillScreen.tsx`: mobile payment entry opens the existing form in the shared sheet, displaying the exact server total/currency, whole-VND amount and collector reference. The existing retype comparison, manual reference, preflight/API checks, mutation functions and outcome messages remain. Inputs freeze while pending; pending entry cannot dismiss. Dirty entry requires explicit Cancel entry, which clears local fields before closing. No payment gesture, extra confirmation modal, fabricated success or automatic submission. Errors are also visible inside the modal. Desktop retains its bill/payment context.
- `apps/console/src/lib/sheet-copy.ts`, `workspace-copy.ts`: localized VI/EN/ZH sheet labels and dirty-entry explanation.

Responsive changes return to inline presentation when crossing to desktop; they do not cancel a request. No production financial mutation was sent by the author.

## Adjacent concrete corrections

- `apps/console/src/styles/discover-warm.css`: higher-specificity centered demo/work heading alignment; Truc pause label now uses its intended 12px type with a 44px minimum target instead of inheriting the page's larger button font.
- `apps/console/src/components/discover/DiscoverHelp.tsx`: stage and every lazy/error fallback are 112px, matching the actual mascot column so the 3D canvas is no longer clipped offscreen.
- `apps/console/src/components/logo-animation/LogoAssemblyIntro.tsx`: initial monochrome ink reads the existing `discover.ink` token (`#17191B`) directly; warm landing inheritance cannot recolor it espresso. Final orange/blue and choreography are unchanged.
- `apps/console/src/lib/discover-help-copy.ts`, `apps/console/src/routes/Privacy.tsx`: landing demo/Truc local-state claim is explicitly scoped. New signed-in studio section describes actual private database storage, seven-day access, expiry cleanup, owner deletion, demo-only decisions, retained audit metadata and separate provider backup retention. Draft label retained. Removed obsolete claim that the always-replayed logo stores a per-session playback preference.

## Author checks and independent acceptance

Final semantic-color follow-up: `workspace.css` and `sheets.css` scope primary action roles to existing `--tech-ink` / `--card`, including primary hover. Episodes filter chips gain only a presentation class; their existing `aria-pressed` state now selects `--tech-50` / `--tech-ink`. No verdict or handler changes. Token-derived WCAG contrast is 9.61:1 light / 9.53:1 dark for primary labels and 8.55:1 light / 10.08:1 dark for selected filters. Independent QA should confirm browser-computed colors. Typecheck, production build (9.05s) and scoped diff check passed after this follow-up.

The apparent date-sheet hang was isolated with a debugger breakpoint on React state dispatch: `SettleScreen` repeatedly called TanStack table `resetPageIndex` / `onPaginationChange`. Its rows memo depended on the fresh `useQueries` result array, so every render changed table data identity and queued another reset. The fix uses `useQueries.combine` to retain structurally shared income data and a stable empty-bills constant. No server values or query permissions changed. All temporary dialog, placement and field diagnostics were reverted; the original native dialog lifecycle remains.

After this fix, the original independent reproduction script was rerun as an author check: `node apps/console/scripts/date-isolation-qa.mjs` exited 0 in 3.89s, completing first open, Escape, second pointer open, date edit and screenshot. TypeScript passed. Independent QA still owns edited Escape/Apply and payment acceptance; this author reproduction is not self-acceptance.

- Console TypeScript check passed after sheet implementation.
- Existing targeted tests: `pnpm exec vitest run apps/console/src/payout/gate.test.ts apps/console/src/payout/payout.test.ts apps/console/src/routes/episodes.test.ts` — 41 tests passed across three files. These protect existing formatting, gate and episode logic; they are not browser acceptance.
- Production build passed after sheet implementation; final privacy/CSS build and typecheck are recorded in the agent handoff message.
- Scoped `git diff --check` passed.
- No author browser session competed with independent QA, and no database or financial mutation was executed.

Independent QA should exercise actual 320/375/768/1440 and short-height layouts, VI/EN/ZH, focus containment/restoration, body-vs-handle drag, draft Reset/Cancel/Apply, valid/invalid native dates and route navigation, long outcome/resolution content, reduced motion, safe-area actions, and resize. Use isolated intercepted payment reads/mutations: verify exact displayed server figures, required reference/retype, dirty Escape/backdrop blocking, pending nondismissal, duplicate-submit protection and visible real errors/status. Do not send real money to test presentation. Confirm the two scoped landing fixes and all five privacy sections independently.

## Exact browser entry points and isolated financial fixtures

- Below 768px, visit `/episodes` and open the Filters control above either existing table. Search/status are drafts until Apply; Reset then Cancel must preserve the original table. The same route's existing outcome and resolution actions open the shared modal. At 768px and above the inline filters remain.
- Visit `/settle?period=2026-09-01` in a finance fixture context and choose the period control. The native date input stays native; invalid input must not navigate. Apply uses the existing route's period search parameter. Desktop keeps its inline form.
- For payment presentation, use a fresh isolated browser context with `/whoami` and `/api/operator/profile` intercepted as an active finance operator. Fulfill `GET /api/payout/batches/2026-09-01` and `GET /api/settle/bills/<fixture-bill-id>` with internally consistent typed fixtures from `lib/api.ts`; never seed the server. Start with manual mode, one unpaid bill, non-null `amount_vnd`, no issues, clear risk and an eligible account.
- Before navigation, intercept **all non-GET `/api/payout/**` and `/api/settle/**` requests**; unknown mutations should abort, never fall through. Fulfill `POST /api/payout/batches/2026-09-01/preflight` with the corresponding fixture. Open `/settle/preflight?period=2026-09-01` to establish the normal cached gate, then navigate within the SPA to `/settle/bills/<fixture-bill-id>?period=2026-09-01` without reloading. Keep the batch fixture stable and complete the interaction within five minutes. A direct bill-page reload intentionally leaves the payment gate closed until preflight is rerun.
- On mobile, Review payment opens the sheet. Its figures must equal the intercepted response, including stored total/currency and whole-VND amount. Wrong amount or absent reference cannot submit. Dirty Escape/backdrop/Close must not discard the entry; explicit Cancel entry clears it. Hold intercepted `POST /api/payout/bills/<fixture-bill-id>/mark-paid` pending to verify fields and all dismissal paths stay blocked, then return a deliberate API refusal and check visible error plus retry. Also cover the existing `/pay` path in an API-mode fixture; never allow either path to reach the real server.
- Keep fixture labels and numbers confined to the isolated QA context and evidence. They are not product data or proof that payment executed. Use the repo `withBrowser/newPage` helper; no author browser session is holding the lane.
