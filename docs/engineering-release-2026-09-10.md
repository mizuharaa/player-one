# Engineering access, upload recovery and security release

The owner requested easier showcase login, whitespace handling, recovery from stalled uploads, protected diagnostics and an accessible page-specific tour. The working landing design is preserved.

Changes:

- Console blur/submission and all three sign-in endpoints trim edge whitespace only. Internal spaces stay literal. NUL and oversized credentials return 400 before database lookup/audit. Login/profile reads have 20-second deadlines.
- Studio list/review/delete requests have 30-second deadlines. Upload retains its 120-second deadline, distinguishes transfer completion from server persistence, clears pending state on synchronous exceptions and every terminal XHR event, and offers list reconciliation after uncertain cancellation/network/timeout results. The existing live upload did not reproduce a backend hang; the independently observed failure was inadequate recovery under stalled networks.
- Migration0028 adds forced RLS only to private showcase footage, with transaction-local authenticated identity, narrow column grants and fixed-purpose maintenance. Production episode/payment tables are unchanged. See [diagnostics and RLS contract](engineering-diagnostics.md).
- Administrator-only `/engineering` inventories14 pipeline/service capabilities, runs a fixed in-memory contracts probe, pages episode metadata and redacted record JSON, and pages audit metadata. Configuration is not health; external workers/provider calls remain explicitly unprobed or unknown. This is not an arbitrary execution console or a full end-to-end simulator. Audit episode filtering covers direct episode targets, not all cross-table events or raw service logs.
- A persistent panda help control names the current page's tour, reserves mobile space, supports keyboard/Escape and retains review shortcut safeguards.
- The production HTTP server adds CSP and framing protections. Inline scripts/event handlers are blocked; required inline styles and GLTF blob fetches remain supported. Parameterized SQL and React text rendering remain the injection/XSS boundaries, following [OWASP output-handling guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html). [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) is scoped defense in depth, not a claim that arbitrary SQL with compromised runtime credentials cannot set a custom setting.

The shorter credentials retain the exact existing machine, administrator and finance UUIDs/roles. IDs become `studio`, `admin` and `finance`; each key is a distinct generated12-character unambiguous code. Plaintext keys remain in private ignored files and are shared directly with the owner, never embedded in the site. Rotation records three attributed audit entries.

## Local evidence

Independent auth6, showcase12 and engineering5 integration tests passed against disposable PostgreSQL with the actual runtime role. Studio fault tests8 passed, as did guide keyboard tests14 and deploy tests8. The malformed NUL500 and legitimate GLTF CSP blob violation found by QA were corrected and retested. Real local Engineering reads, finance refusal and responsive/escaped JSON checks passed. Typecheck and production build passed.

The exact job artifact `scratchpad/engineering-migration-Rxy4UP` passed independent apply/retry validation: migration journal once, three credential audits once, unrelated identity unchanged, wrong head or wrong identity rolls back the complete transaction. It contains credential hashes only and receives database owner access through private Railway references. The web service remains `playerone_app`.

Reviewed web snapshot: `scratchpad/railway-release-3mgECk`,309files,19,258,971bytes. All source hashes matched before upload. No Git commit or push.

## Production rollout

The isolated Railway migration job `5b7aecae-d22e-49fa-8580-c6f64674b100` committed0028 and the three requested credential rotations with exit0. Runtime policy assertions passed before COMMIT. Temporary service `7a9292a2-049e-418c-b620-c8d19a81b740` was removed and absence verified. The web service retained its runtime database identity; owner credentials were private references used only by the temporary job. The short administrator login returned200 before the private access handoff was updated.

Web deployment `947d23ee-3377-4418-9be4-ff7744002927` reached SUCCESS and passed independent public acceptance. `/healthz` returned `ready:true`; all 309 source hashes still matched the uploaded snapshot. Migration evidence: `scratchpad/qa/engineering-migration-job-state.json` and `engineering-migration-job.log`.

Public browser and API sign-in accepted edge whitespace; previous credentials returned 401. Engineering confirmed forced showcase RLS without runtime bypass, 14 accurately labelled service states, four passing fixed sample checks and readable audit metadata. Finance issued no automatic engineering request and its direct request returned 403. Page-specific panda tours stayed within bounds at 1440 and 375 pixels, with Escape restoring focus.

A real synthetic clip uploaded through the public UI (201), played, served a byte range (206), saved a demo review (200), and was deleted through the UI (204); subsequent media access returned 404. The exact test clip was removed. No page errors, legitimate CSP violations or unexpected operational mutations occurred. Logout cleared all cookies and the independent browser closed. Public evidence: `scratchpad/qa/security-release-public/results.json` and adjacent screenshots. External provider/worker execution remains unprobed; these checks do not certify live payment execution or a complete production ingest cycle.

Evidence: `docs/design/upload-session-security-independent-qa-2026-09-10.md`, `scratchpad/qa/engineering-migration-local-validation.json`, and `scratchpad/qa/csp-independent/results.json`.
