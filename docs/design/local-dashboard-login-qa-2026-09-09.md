# Real local dashboard login QA — 9 September 2026

**Passed against the actual local API, with no browser route fixtures or mocked responses.** Preview `http://127.0.0.1:5190`; API `127.0.0.1:8080`; parent-provisioned isolated PostgreSQL `55432/playerone_local_demo`. This is seeded local demonstration data, not production financial activity. The reviewer did not provision, seed or modify the database.

Used the existing serial `withBrowser`/`newPage` helper, reduced motion, 1440×900. Executed an inline Node module via PowerShell stdin; no application/probe code file was edited. Credentials were entered through the visible login form. No review verdict, payout, task edit, card intake or settlement-generation control was submitted.

- Machine `HCM-01` / `pw`, operator `op-1` / `pw`: actual `POST /api/session` **200**, browser navigation to `/`, `/whoami` **200**, `/api/review/shift` and `/api/review/recent` **200**.
- Visible dashboard matched the actual shift response: **4 reviewed**, **3/4 approved (75%)**, **0:11 payable**, **₫230 settled**, **1 waiting**, **3 needing a human**. Raw response contained payable seconds `11.356401` and settled amount `230.1144`. These numbers originate from the local demonstration seed, which includes stubbed payment activity.
- Both `po_machine` and `po_operator` existed as **HttpOnly, SameSite=Strict, session cookies**, domain `127.0.0.1`, path `/`. `Secure=false` on this local HTTP setup; no production HTTPS-cookie claim is made. Token values were not recorded.
- Actual `/episodes`, `/counter`, `/backoffice`, `/pipeline` navigation worked, with correct active navigation and **0 horizontal overflow**. Episode rows, the two collectors `c-1`/`c-2`, and Warehouse handling/Housework tasks appeared. `/episodes/stuck`, `/reference/sync`, `/api/tasks` returned **200**.
- No visible logout control exists in the shell. A same-origin `DELETE /api/session` returned **200** with `signed_out:true`, removed both cookies, and made `/whoami` return **401**. Navigating to protected `/episodes` then redirected to `/login`. Re-entering the visible form with `op-1` succeeded again with **200** and restored the populated dashboard.
- Finance `fin-1` / `pw` with the same machine also logged in through the form with **200**. `/settle` loaded the real local batch and two collector-income responses with **200**; the seeded rows showed `c-1` Paid and `c-2` No attempt. No payout control was used.
- The sole non-2xx response apart from intentional post-logout 401s was **400** from the console's automatic `/api/payout/attempts/probe/resolve` capability probe. `apps/console/src/lib/api.ts:860` documents this intentional invalid-ID request: finance permission reaches the handler and receives 400 before a bill read or mutation. It was not a payment failure.
- **0 page errors**. The isolated browser session was signed out at completion and closed; no frontend/API process was stopped or duplicated.

Evidence:

- `scratchpad/qa/showcase-independent/real-local-auth-results.json` — actual status codes, cookie metadata, shift response, rendered text, navigation and logout/relogin results; no cookie values.
- `scratchpad/qa/showcase-independent/real-local-dashboard-1440.png` — visually inspected populated dashboard.

This supersedes the earlier report's local-auth-unavailable limitation for this newly provisioned runtime only. Public deployment, production credentials, production financial figures, remote HTTPS sessions and actual payout processing remain outside this verification.
