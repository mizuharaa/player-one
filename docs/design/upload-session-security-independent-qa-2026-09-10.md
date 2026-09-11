# Independent upload and session security QA — 2026-09-10

Reviewer: independent QA agent; no application implementation. Scope: reported Studio upload stall, login input normalization, browser failure recovery, session/proxy/header boundaries. No financial mutations or production seeding.

## Live upload reproduction

Deployment at reproduction: `744e6fbf-d585-4ae5-9b7c-6e1cb5dbae40`, `https://playerone-web-production.up.railway.app`.

`node apps/console/scripts/showcase-upload-repro-qa.mjs` used the private showcase admin credentials in memory, then uploaded one synthetic 6,581-byte clip. The Studio form appeared 999 ms after navigation; profile/list GETs returned 200. Upload was disabled before file selection and enabled afterward. POST returned 201 after approximately 176 ms; progress cleared, library refreshed, and media returned 206. Actual UI deletion returned 204 and the media subsequently returned 404. The synthetic clip was removed, the session signed out, and the browser closed.

The reported live stall was **not reproduced**. No particular backend failure is established by this run. Earlier source had unbounded profile/list fetches and displayed 100% while waiting for the upload response; these were concrete recovery/feedback gaps, not evidence that this user's request failed for that reason.

Evidence: `scratchpad/qa/upload-repro/results.json`, `initial.png`, `uploaded.png`. A request-failed event recorded `net::ERR_ABORTED` on the deletion response, alongside confirmed HTTP 204 and subsequent media 404; this was not a reproduced deletion failure.

## Local failure recovery

`node apps/console/scripts/studio-fault-independent-qa.mjs`: **8/8 PASS**, browser closed, zero page errors. These are explicitly browser fixtures, not real network failure timing or backend acceptance. AbortSignal delays were accelerated to 400 ms while asserting the requested production deadlines (profile/login 20 s; Studio list 30 s). XHR terminal events were injected and the configured 120 s timeout inspected.

- Profile/list hangs expose retry and recover after the fixture responds.
- Upload progress 100% explicitly says the client is waiting for server persistence.
- Timeout, network failure and user cancellation clear progress, enable retry, give uncertainty guidance and refetch the library.
- Synchronous XHR open/send exceptions restore controls.
- Login blur and submission trim edge whitespace while preserving internal double spaces; request timeout restores submit and shows a service error.

Evidence: `scratchpad/qa/studio-fault-independent/results.json` and per-error screenshots.

## Independent API checks

`node scratchpad/qa/session-security-test-run.mjs`: **6/6 PASS**, 11.21 s. New test file `packages/api/test/session-security-independent.test.ts` uses a fresh randomly named `postgres_api_session_security_*` database on the isolated loopback cluster. API requests execute as `playerone_app`. It never truncates or seeds the operational demo database.

Verified real PostgreSQL/Fastify behavior: normalized session/machine/operator sign-in; literal internal whitespace; malformed credential types refused; SQL/HTML strings treated literally with opaque JSON refusal and no session; NUL and over-512-character credentials return 400 before lookup/audit; simple cross-origin form encodings cannot sign in and no CORS grant is returned. Secure login cookies contain HttpOnly, Secure and SameSite=Strict.

**Defect found and fixed by root:** JSON NUL in `external_ref` originally returned 500 when PostgreSQL rejected its text representation. It now returns 400 before DB work. The independent test includes session and both token endpoints, identifier and secret fields. The first test run also had a QA fixture setup error (omitted required UUIDs); this was corrected before assessing product behavior.

## Source and header review

Reviewed `packages/api/src/{session,cookies,credentials,index}.ts`, `deploy/{http-server,proxy-identity}.mjs`, login/profile/Studio request paths and frontend HTML sinks. Authentication lookups use parameterized Drizzle queries; inspected UI credentials/errors/filenames render as React text. Explicit bearer headers take precedence over cookies; operator status and centre matching are checked. Cookies are host-only, HttpOnly and SameSite=Strict, with Secure enabled in deployment. No CORS plugin/form parser was found in these paths. These bounded checks did not establish an SQL injection, XSS, CSRF or session bypass.

The proxy fixes its upstream to loopback, strips supplied forwarding identity chains and rejects static traversal/source-map/dotfile exposure. Railway mode still depends on the documented deployment boundary that only the platform edge reaches the web ingress and replaces X-Real-IP; this audit does not claim a fresh cloud log correlation.

Root added CSP and frame denial after review found them absent. `node --test deploy/security-independent.test.mjs`: **1/1 PASS**. The test checks script-self/no inline script/no eval, frame-ancestors none, object-src none, base-uri none, form-action self, X-Frame-Options DENY, nosniff and HSTS on SPA, API and error responses. Header absence alone was not presented as a proven authenticated clickjacking exploit.

Independent reruns after backend freeze: `node scratchpad/qa/showcase-test-run.mjs` **12/12 PASS** (14.99 s), and `node scratchpad/qa/engineering-test-run.mjs` **5/5 PASS** (7.64 s), using fresh isolated databases and restricted runtime requests. The showcase tests include raw RLS without API predicates, local identity cleanup after commit/rollback, immutable fields, quotas, fixed expiry cleanup and suspicious text transport. Engineering tests include active administrator authorization, strict query/probe inputs, redacted episode/audit projections and truthful configured-versus-healthy states. Source review of migration 0028 confirmed forced RLS, transaction-local identity and fixed security-definer maintenance functions with `search_path=pg_catalog`. This RLS design does not claim to protect against an attacker already holding arbitrary SQL access as the runtime role and able to set the custom identity GUC.

`node apps/console/scripts/csp-production-independent-qa.mjs`: **PASS** against the latest production build using the actual deploy proxy on a temporary random loopback port. Initial run found a real CSP compatibility defect: the GLTF loader's embedded texture fetch was blocked by `connect-src 'self'`. Root added `blob:` to connect-src; the independent rerun passed with zero legitimate CSP violations or page errors. Intro completed with visible heading; opening/review videos returned 206 and review play/pause worked; Truc GLB returned 200 and rendered a canvas. Deliberately inserted inline script and onclick handler did not execute and emitted the expected script-src-elem/script-src-attr violations. Evidence: `scratchpad/qa/csp-independent/results.json` and `mascot.png`. Browser and temporary proxy were closed.

## Engineering UI and updated real Studio workflow

`$env:QA_ENGINEERING_REAL='1'; node apps/console/scripts/engineering-independent-qa.mjs` exercised the real restarted local API after authorized migration 0028. Operator `op-1` received actual status, episode list/detail, audit and fixed sample-contract GET responses, all 200; 14 service entries and four synthetic checks rendered. Finance `fin-1` saw the restricted UI and initiated zero automatic engineering reads; a deliberate direct GET returned 403. This only read existing local demo records and ran the fixed in-memory contract probe. Real evidence is preserved in `scratchpad/qa/engineering-independent/real-results.json` and `real-admin.png`.

The separate fixture pass (`node apps/console/scripts/engineering-independent-qa.mjs`) passed four cases: 1440 EN dark, 375 VI, 320 ZH, and 768 EN with root text size 200%. It verified populated episode selection, escaped malicious-looking JSON and audit text, cursor next/back, selected-episode audit filtering, invalid UUID refusal, cached refresh timeout with stale-data warning and successful retry. Page overflow was zero; mobile tables scroll internally. Tour Enter/open, arrow navigation, Escape/restore and settled card bounds passed. The checks allow 300 ms for step placement to settle; they are not a certification that every transitional frame is stationary. Screenshots are labelled fixtures under `scratchpad/qa/engineering-independent/`.

The first fixture attempt compared JSON-escaped quotes to an unescaped literal; the QA assertion was corrected to parse the rendered JSON. Immediate pre-settle bounds also differed from settled layout, so final geometry is measured after the bounded settling interval. These were not reported as established product defects.

`node apps/console/scripts/studio-rls-local-independent-qa.mjs`: **PASS**, 2.48 s, actual local API and migration 0028. Synthetic upload 201, media 206 with advancing playback, own demo review 200, actual UI delete 204, then media 404. The exact synthetic clip was removed; logout/browser teardown completed and page errors were zero. Evidence: `scratchpad/qa/studio-rls-local/results.json`.

## Public deployment acceptance

Deployment **`947d23ee-3377-4418-9be4-ff7744002927`** reached SUCCESS, independently observed through `npx --yes @railway/cli deployment list --service playerone-web --environment production --json`. The public checks then ran only against `https://playerone-web-production.up.railway.app` with the current private credentials read from disk in memory.

`node apps/console/scripts/security-release-public-qa.mjs`: **PASS**.

- Actual browser login and direct JSON session login accept surrounding whitespace. One attempt with the previous credentials returns **401**, without a rate-limit refusal. Session cookies are Secure, HttpOnly and SameSite=Strict.
- Public CSP/frame-denial headers are present. Intro and Truc render; no legitimate CSP violations or page errors were observed through the exercised public flows.
- Engineering status reports **showcase RLS true**, **runtime bypass false**. All 14 service entries render. Database is healthy; absent upload/object/media/sign-in integrations are unconfigured; archive/jobs remain unknown; payments are manual; risk is configured but unprobed. The four fixed in-memory sample checks pass; the audit endpoint returns 200 with payloads omitted. This does not establish external integration or worker health.
- Engineering page-tour controls identify the current page at 1440 and 375 widths. Cards remain within the viewport and Escape restores the trigger focus.
- Actual finance login succeeds, direct Engineering UI renders restricted access with **zero automatic engineering requests**, and an explicit status API request returns **403**.
- One own synthetic 6,581-byte demo clip uploads with **201**, plays, and serves an exact byte range with **206**. Its own demo review returns **200**, actual UI deletion returns **204**, and the media then returns **404**. The clip was removed; no production episode, financial or ingestion mutation occurred.
- Logout completed, remaining session cookies **0**, browser closed. No unexpected mutations were attempted.

Public evidence: `scratchpad/qa/security-release-public/results.json`, `engineering-tour-1440.png`, `engineering-tour-375.png`, `engineering.png`, and `studio.png`. The script does not write credential values or tokens into evidence.

All assigned local and bounded public gates are clear. This report is a bounded review, not certification against all security vulnerabilities.
