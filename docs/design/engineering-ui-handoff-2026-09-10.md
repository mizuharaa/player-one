# Engineering workspace and page tour — implementation handoff

Author implementation is frozen for independent QA. No commit, deployment, backend mutation or acceptance claim.

## Changed files

- `apps/console/src/engineering/api.ts`: typed read-only GET client; 20-second request timeout; server errors retain request references.
- `apps/console/src/engineering/EngineeringScreen.tsx` and `engineering.css`: service states and safeguards, explicitly synthetic sample-contract check, cursor-paginated episode and audit views, UUID lookup, escaped redacted JSON disclosures, visible retry/error/empty states.
- `apps/console/src/lib/engineering-copy.ts`: VI/EN/ZH interface and tour copy.
- `apps/console/src/lib/workspace-copy.ts`: merge engineering translations.
- `apps/console/src/router.tsx`: authenticated `/engineering` route.
- `apps/console/src/components/shell/PillNav.tsx`: engineering navigation only for active administrators.
- `apps/console/src/components/shell/AppShell.tsx`: role-aware navigation, persistent named page-tour trigger, static Panda (review retains its guide icon), measured bottom-content reserve.
- `apps/console/src/components/guide/Guide.tsx`: responsive measured card, pre-paint placement, bounded scrolling to targets, page title, wrapping 44px actions. Existing native dialog and review-key interception remain intact.
- `apps/console/src/components/guide/steps.ts`: dedicated engineering/profile/studio/preflight/bill/exception steps.
- `apps/console/src/styles/workspace.css`: fixed tour dock and measured reserve; responsive tour card.

## Data and authorization

Engineering requests mount only after the real operator profile reports `role === 'administrator'` and `status === 'active'`. This is presentation gating; the server independently authorizes every engineering endpoint. No credential, payment, review or ingestion flow changed.

Services distinguish checked, configured but unprobed, manual, unavailable and unknown states. The fixed sample check is labelled synthetic and does not claim external-service or pipeline end-to-end verification. Audit metadata omits payloads and service logs; an episode filter shows direct episode targets only, excluding events targeting reviews or other records. JSON is rendered as text inside `pre/code`, using the server's bounded redacted projection.

## Author evidence

- `pnpm --filter @playerone/console typecheck`: exit 0.
- `pnpm exec vitest run apps/console/src/components/guide/guide.test.tsx`: 14/14, including review-key safety.
- `pnpm --filter @playerone/console build`: exit 0, final build 6.40s; existing chunk-size warning remains.
- `git diff --check`: exit 0.
- Fixture-only browser script: `scratchpad/local-demo/engineering-author.mjs`, uses repository `withBrowser/newPage`; all contexts closed.
- Captures/results: `scratchpad/qa/engineering-author/`. 1440x900 EN, 375x812 VI, 320x640 ZH. Horizontal overflow 0; tour card remains inside viewport; Escape restores trigger; no page errors. Initial author capture exposed a placement flash, corrected by pre-paint measurement and recaptured.

These fixtures are not backend evidence. No real engineering API or cloud environment was exercised by this author session.

## Independent QA entry points

1. On a migrated/restarted local API, sign in as administrator and visit `/engineering`; verify actual status/safeguards, run fixed sample check, inspect real empty or populated episode/audit states. No financial or pipeline POST is required.
2. Finance/centre-operator: engineering nav absent; direct `/engineering` shows restricted access and starts no engineering fetch. Independently confirm direct API 403. Reviewer routing remains `/review`.
3. Intercept GET responses for populated pagination, missing UUID/404, unauthorized/403, 500 with reference, timeout and cached refresh failure. Verify request cursors, selected-episode filter and escaped hostile JSON text; fixtures must be labelled as QA data.
4. At 320/375/768/1440, VI/EN/ZH, dark and 200% text, verify tables scroll internally, JSON has bounded scroll, full bottom content remains reachable above the help dock, and dock labels wrap without covering actions.
5. Tour on Home, profile, studio, engineering, settlement subpages and review: explicit current-page label; keyboard open/close/next/back; Escape focus restoration; route-change cleanup. Review Enter/arrows must never trigger a verdict while the guide is open or closing.
6. Production proxy/CSP review belongs to independent QA. Static Panda adds no always-running 3D scene.
