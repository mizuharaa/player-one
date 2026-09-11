# PlayerOne Railway release

The first PlayerOne cloud build is live and passed bounded independent public
page, media and real HTTPS session checks. The subsequent operator-workspace
redesign and stepped-logo update are being prepared as the next source snapshot.

| Resource | Value |
| --- | --- |
| Public website | https://playerone-web-production.up.railway.app/discover |
| Console | https://playerone-web-production.up.railway.app/login |
| Project | PlayerOne — `5be6dfb6-0437-4a3d-ad33-b25b1a7f9eb6` |
| Environment | production — `040798be-43c1-40ef-95f4-a3f423bdd18a` |
| Web service | playerone-web — `a7913574-d4bb-46b7-a840-48b2ee0fccda` |
| PostgreSQL service | Postgres — `6dd60f05-485b-41d2-8095-a1d4aaca4d3b` |
| First accepted deployment | `eaa76de7-0706-4fee-b20a-6ea5e0f5d2b7` |

The web service runs the Vite build and Fastify API in the Node 22 Linux
container. The API connects over TLS through Railway's private PostgreSQL
hostname as restricted `playerone_app`. Owner credentials were used only for
migrations and first-login provisioning, never as the web runtime identity.
The temporary public database setup proxy was removed after provisioning.

One showcase centre, one machine, an administrator and a finance operator were
provisioned non-destructively. No local demo collectors, payment history or raw
sample recordings were uploaded. Strong cloud credentials and sign-in instructions
are in the Git-excluded, current-user-only local file
`scratchpad/local-demo/showcase-access.private.md`. The local `pw` credentials do
not work on the public service.

The first build uploaded a clean 276-file, 17.20 MiB source snapshot. The manifest
is outside that archive. It excludes credentials, scratchpad, raw corpus, docs,
node_modules, source maps and test files. No Git commit or push was required;
the deployed source includes the reviewed uncommitted worktree changes.

Independent evidence: [cloud QA](design/cloud-showcase-qa-2026-09-09.md).
The live edge test confirmed that forged forwarding headers did not replace
the actual client identity. Session cookies were Secure, HttpOnly and
SameSite=Strict. Actual sign-in, sign-out and re-login succeeded.

A later image redeploy (`fbd33f96-abc3-4ff1-ae1e-998471a0e5b2`) failed in Railway's
build-image stage before producing a compiler trace; the accepted deployment
stayed live. Readback confirmed runtime V2 and saved health settings. Do not
describe the failed replacement as accepted or blame application code without
evidence. Use a fresh source upload for the next reviewed build.

For updates, run the clean staging utility `node deploy/stage-release.mjs` and
upload its reported directory with `railway up <directory> --path-as-root`,
explicitly selecting this project, production environment and playerone-web.
Wait for SUCCESS and verify the actual public origin before announcing a release.
The configured readiness path is `/healthz`, timeout 120 seconds, with five
restart retries. Its readiness signal is the API listener, not an exhaustive
payment/provider health test.

Storage, production sign-in-code delivery, reviewer raw-media authorization,
payment-provider integration and the complete analysis runtime remain separate
dependencies. This deployment showcases the website and authenticated console;
it does not certify the full data-collection/payment operation.

## Operator workspace release, 2026-09-09 evening

The new source snapshot is `scratchpad/railway-release-0SaJNU`: 282 files,
18,044,398 bytes (17.21 MiB). Deployment `b88ecf9b-58a2-4a19-918d-3ab3f00d59a9`
was uploaded through `railway up --path-as-root` with explicit project,
production environment and playerone-web service. It has progressed beyond the
previous scheduling-only failure into the actual Docker dependency install and
Vite production build. Railway reports SUCCESS, with the web listener on 3000 and API on loopback 8081. Independent HTTPS interaction checks are the remaining acceptance step.

Independent local release gates passed: 169 UI/design tests, nine profile API
tests, TypeScript, real login/signout, own-operator 84-day Vietnam calendar,
VI/EN/ZH at 375/768/1440, keyboard/drawer/profile settings, referenced network
failure and retry, no marketing media in the workspace, and a home logo link.
The intro replayed on the first visit and two normal reloads without query flags;
reduced motion skipped it. The workspace recorded zero idle rAF over 1.5 seconds.
The seven rendered contrast samples passed, lowest 6.93:1.
See [workspace QA](design/dashboard-workspace-qa-2026-09-09.md).

### Final public verification

Independent cloud smoke PASSED on deployment
`b88ecf9b-58a2-4a19-918d-3ab3f00d59a9`. Actual sign-in returned200;
whoami/shift/recent/tasks/operator-profile returned200. Session cookies were
Secure, HttpOnly and SameSite=Strict. Profile correctly displayed84Vietnam dates
with zero recorded activity in this newly provisioned showcase database.
Home/profile had no page overflow; Home requested no marketing media.
The mobile drawer, main-logo Home link, real signout/cookie clearing/401 and
first-visit plus ordinary-reload intro passed with zero browser page errors.
The deployed282-file manifest still matches the reviewed source exactly.

The updated site and console are ready to showcase. This is bounded website and
authenticated-console acceptance, not certification of external payment,
recording-storage or hardware integrations.

## Continuous logo choreography release

The owner replaced the stepped-scramble direction with a continuous 3.8-second
sequence: unfolding, opposing arcs, wide formation, compression/release,
asymmetric sweep, partial letters, exact lock and the existing color/docking
handoff. The dashboard and backend source are unchanged by this refinement.

Clean snapshot `scratchpad/railway-release-XIVbCE` contains 283 files and
18,054,052 bytes (17.22 MiB). It was uploaded as deployment
`b7f50c70-1dc4-42e0-b5eb-48ffcec09644`. The Docker build and image export passed;
final deployment status and public intro check remain to be recorded below.

Independent local QA passed: 32 unchanged SVG paths, 320 continuous interior
waypoint joins, 462 rendered viewport/time samples with no offscreen fragments,
exact final geometry, docking below 0.041px, ordinary reloads, reduced motion,
Skip/Escape/resize/route cleanup, real quarter-speed controls and production
debug exclusion. See [logo QA](design/logo-continuous-independent-qa-2026-09-09.md).

Final cloud acceptance: deployment b7f50c70-1dc4-42e0-b5eb-48ffcec09644 is SUCCESS.
Independent public first-visit, normal-reload and debug-query runs completed in
3.984/3.963/3.909 seconds from mount (including startup), with all32paths retained,
106–109 distinct sampled transform states, black-to-color after3.219–3.320s,
no production debug controls/labels and zero browser errors. The opening film
was ready and playing after each handoff; scroll overflow was restored. One
cold run used the existing story fail-open path without its optional revealed
marker, but actual film playback advanced. The service health returned200ready.
The full283-file source manifest matches the deployed snapshot with no changes.
See the independent logo QA report for the evidence and bounded scope.

## Stable scrolling and short logo release

The latest correction removes the global ScrollTrigger disable/enable cycle
that replayed entrances after idle. A4px scroll had reset visible headings to
opacity0/y24 and scaled gallery panels to0.975. The page now keeps headings
opaque with bounded one-shot GSAP entrances and does not transform whole photo
panels on scroll. The normal-reload logo uses a short1.6-second local modular
scramble, replacing the rejected swinging3.8-second choreography.

Snapshot scratchpad/railway-release-p0Dnwu:283files,18,048,811bytes(17.21MiB).
Uploaded deployment:ffcbaa02-c913-448a-9762-078403bedd63.
Independent local wheel regression at375/1440/1920 captured287/281/277samples:
headings remained opacity1, settled headings/scenes had no transforms, all8
headings stayed visible, and idle rAF was zero. Videos played when visible and
paused offscreen. Compact logo first/reload timings were1.716–1.765seconds
including startup. TypeScript and production build passed. Final cloud status
and public verification are recorded below when complete.

Final status: SUCCESS on deployment ffcbaa02-c913-448a-9762-078403bedd63.
Independent public QA passed 174 tiny-scroll and rapid-reversal samples with
all headings visible and gallery transforms stable. Idle animation callbacks
were zero over 1.2 seconds; browser errors were zero. Intro timing was 1.968s
cold and 1.650s on normal reload, including startup. Real film playback followed
all three checked handoffs. The health endpoint returned HTTP 200 / ready:true.
All 283 staged source hashes matched after upload. Full evidence and limits:
[Independent QA report](design/discover-scroll-compact-logo-qa-2026-09-09.md).