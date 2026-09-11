# Dashboard language and payment access - independent QA

**Local release verdict: PASS; no confirmed blocker.** This is independent QA after builder freeze, including the final locale-chevron CSS correction. Hero/login coverage is recorded separately in `hero-login-independent-qa-2026-09-10.md`.

## Commands and evidence

- `node apps/console/scripts/workspace-language-independent-qa.mjs`: actual local demo API, 320/375/1440 viewport widths, VI/EN/ZH selection and reload persistence, route preservation and Profile navigation. No horizontal overflow. Mobile menu is modal; Escape returns focus; visible language controls are 44 px high with keyboard focus outline.
- `node apps/console/scripts/payment-role-independent-qa.mjs`: actual local administrator and finance identities; focused payment route access, cached-data isolation and unknown-profile fixtures. Results summarized in `scratchpad/qa/payment-access/role-summary.json`.
- `node apps/console/scripts/payment-mobile-chevron-qa.mjs`: final chevron inside selector (selector x28-150, icon x126-140); fresh 375 px finance load passes. The 900 px ledger scrolls inside its 337 px container; document overflow is zero.
- `pnpm exec vitest run apps/console/src/payout/payout.test.ts apps/console/src/payout/gate.test.ts`: **34 tests passed**, two files.
- `pnpm -F @playerone/console typecheck`: PASS.
- `pnpm -F @playerone/console build`: final post-chevron build PASS, **283 modules, 10.26 seconds**; existing large-chunk advisory only.

## Access behavior

The stored profile role distinguishes administrator from finance; the transport session role is `operator` for both. Actual administrator visits to Settle, Preflight, Exceptions, Bill detail and Risk made **zero restricted API requests**, displayed the access-required state, and hid financial content. A synthetic cached bill sentinel injected into the browser query cache was never rendered on any of those routes. A separate fixture retained finance profile data with query-error status: the page showed Unavailable, hid cached financial content and issued no restricted requests. These two cache/error cases are explicitly browser fixtures, not claims of a real backend fault or role change.

Actual local finance access loaded the batch and two collector-income endpoints through GET and rendered the seeded local demo bills. These are not production financial records. No payment/review action was invoked; recorded attempted financial mutations and page errors were both empty.

Before deployment, the existing cloud independently confirmed the underlying cause: administrator batch GET returned **403, finance role required**, while finance batch GET returned **200**. Both real form logins succeeded and both sessions were logged out. The backend finance restriction is preserved; the UI now explains and gates access correctly.

## Rendered contrast and screenshots

Measured text contrast against rendered backgrounds, light/dark respectively: active navigation **14.21/10.00**, secondary language label **6.49/7.96**, scope text **7.50/6.93**, language text **18.23/14.04**, active hover **13.01/8.84**, inactive hover **15.44/11.37**. These sampled functional text states exceed 4.5:1. Decorative logo colors are excluded. The raw probe's `language boundary` value includes control ink/icon; it is not a border-only measurement or a claim about the thin decorative border.

- `scratchpad/qa/workspace-language/chevron-fixed-1440.png`
- `scratchpad/qa/workspace-language/home-1440-dark.png`
- `scratchpad/qa/payment-access/finance-1440.png`
- `scratchpad/qa/payment-access/finance-375.png`
- `scratchpad/qa/payment-access/unknown-profile.png`

One initial desktop-to-mobile browser probe stalled and was terminated; no product failure was established. The focused desktop checks and a fresh, bounded mobile load subsequently completed. That stalled transition is not claimed as passed. No broad regression rerun or physical-device performance certification is implied.

## Deployed acceptance

**Cloud PASS** on Railway deployment `530d8f8a-f25e-4518-a8af-c1585613471b`, origin `https://playerone-web-production.up.railway.app`. Command: `$env:QA_DEPLOYMENT='530d8f8a-f25e-4518-a8af-c1585613471b'; node apps/console/scripts/hero-login-cloud-qa.mjs`. Public `/healthz` returned `{"ready":true}`.

Real administrator and finance form logins both returned 200 and entered the dashboard. Session cookies were HttpOnly, Secure and SameSite Strict; no values were recorded. VI/EN/ZH selection persisted through reload and preserved `/`; rendered languages were vi/en/zh-Hans. Actual administrator profile role was administrator: Settle displayed the translated access-required explanation, empty financial content and zero payout requests. Actual finance role was finance: batch GET returned 200 with zero bills, matching the intentionally empty cloud database, and no restriction banner or horizontal overflow. Both sessions were logged out and cookies cleared; administrator whoami after logout returned 401. No financial mutations were attempted and no page errors occurred. Browser closed.

The same bounded run confirmed the hero and login fixes, including actual keyboard traversal; see the hero/login report. Evidence: `scratchpad/qa/hero-login/cloud-results.json`, `cloud-admin-payment.png`, and `cloud-finance-payment.png`. Existing pre-deployment 403/200 observations above are baseline evidence, distinct from this deployed UI acceptance.
