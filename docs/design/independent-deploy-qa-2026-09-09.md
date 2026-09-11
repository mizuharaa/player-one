# Independent deployment QA — 2026-09-09

The frozen package passed the local transport and startup checks below. This is
not a container-build, cloud-deployment or working-account acceptance. Reviewer
`native_ui` did not author or edit the deployment implementation; only this
report was added during this review.

## Scope and environment

Reviewed `Dockerfile`, `.dockerignore`, `railway.toml`,
`deploy/{http-server,proxy-identity,showcase,http-server.test}.mjs`,
`docs/deploy-showcase.md`, and the narrowly authorized proxy boot options in
`packages/api/src/index.ts` and `packages/api/bin/serve.ts`. Snapshot: shared
uncommitted `sprint/ui-revamp` worktree after the builder's freeze.

Execution environment was Windows, **Node v24.11.0**. The image targets Node 22;
that version and Linux were not executed. No secrets were read, no database was
contacted, no seed or migration ran, and nothing was committed or deployed.

## Findings resolved before the frozen test run

| Finding | Verified correction |
| --- | --- |
| Loopback proxy would put every visitor in one API sign-in source bucket. | `deploy/proxy-identity.mjs` strips caller forwarding chains; configured Railway mode accepts one valid edge `X-Real-IP`; direct mode uses the socket. The child binds loopback, and Fastify's optional trust is limited to loopback CIDRs (`packages/api/src/index.ts:389`). Standalone default remains false. Distinct edge addresses and spoofed chains passed transport tests. |
| HEAD incorrectly honored Range. | `deploy/http-server.mjs:154` applies ranges only to GET. HEAD returns 200, full length, no Content-Range and no body. |
| An unknown range unit returned 416. | Unknown units are ignored and return the full 200 representation. |
| A future If-Range date incorrectly accepted a partial response. | `deploy/http-server.mjs:153` requires an exact modification-date match. Future and older dates return 200; an exact date returns 206. |

The HTTP corrections follow [RFC 9110 Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-range)
and [If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-range).
No unresolved defect was reproduced in the bounded local checks.

## Independent execution evidence

| Check | Result |
| --- | --- |
| `node --test deploy/http-server.test.mjs` | Exit 0; 7 reported tests passed, 0 failed. Six subtests plus their enclosing test cover SPA/API routing, cookie/body transport, forwarding identity, byte ranges, static containment and health/upstream failure. |
| `node --check` on all four deployment `.mjs` files | Each exited 0; checked individually with asserted process status. |
| `node --input-type=module -e "await import('./packages/api/src/index.ts')"` | Exit 0. Current checkout's API module graph loads under Node 24 without opening a database. This does not verify image workspace links. |
| Separate inline raw-HTTP fixture probes | 19 passed: encoded NUL, malformed escapes, encoded traversal/backslash, double slash, HEAD with unsatisfiable Range, unknown/multiple ranges, future If-Range, clamped/suffix/unsafe integer ranges, `/api/session`, bare `/episodes` and `/episodes/stuck`. Fixture removed after checking its resolved temporary path. |
| Separate subprocess startup probes with an isolated dummy environment | Six passed: missing database variable, missing token variable, invalid port, port collision, HTTPS without explicit ingress mode, and API startup failure. The last used a deliberately invalid URL, caused no database connection, and confirmed parent exit 1 after child failure. |
| Scoped `git diff --check` | Exit 0 for tracked API changes; only existing LF/CRLF notices. New package files were reviewed directly because untracked files are absent from `git diff`. |

The fixture API deliberately returned synthetic transport responses. Cookie
preservation includes multiple Set-Cookie values, HttpOnly, Secure and
SameSite=Strict; it is not evidence that a real operator can authenticate.

## Source review and remaining deployment evidence

- The allowlist includes API/store/contracts sources, analysis modules, console
  source/public assets, design inputs and migrations. Environment files, local
  node_modules, corpus, docs media and seed scripts are excluded. Runtime COPY
  includes the inspected workspace dependencies. Docker's actual build context,
  pnpm links, Node 22 boot and image contents still require a real image build.
- `/healthz` measures the API listener's credential-free `/whoami` 401 response.
  It does not continuously check database health or sign-in; the documentation
  now states this limit. Startup database/schema work precedes API listening.
- The image intentionally omits FFmpeg/Python and spawned
  `packages/api/scripts/moov.ts` / `packages/hardware-checkout/corpus_check.py`.
  It is not a complete analysis runtime, even if recordings are later mounted.
- Railway mode requires exclusive managed HTTP ingress. Validate actual
  X-Real-IP replacement and distinct visitor identities on the chosen host;
  local forged-header tests cannot establish the remote trust boundary. Render
  remains blocked on its own verified client-address adapter.
- The daemon was unavailable for this review, and no remote host/database or
  account credentials were supplied. Still required: Linux image build/run,
  isolated owner migrations, runtime-role permissions, non-destructive account
  provisioning, real HTTPS sign-in/logout, playback seeking, and host restart.
- Graceful SIGTERM while requests are active, the ten-second forced-shutdown
  deadline, and child cleanup in the Linux container were reviewed in source
  but not executed. API startup-failure propagation was executed locally.

See [deployment instructions](../deploy-showcase.md) for the configuration and
remaining owner-hosting steps. Public UI/browser acceptance is separate.
