# Independent dashboard workspace QA — 9 September 2026

Independent non-author review of the operator-profile API, revised logo and forthcoming workspace UI. Worktree `C:/Users/user/pw/ui-integrate`, branch `sprint/ui-revamp`. This reviewer has not edited feature code. The release direction is `docs/design/dashboard-workspace-direction-2026-09-09.md`.

## Current scope

**Release verdict: PASS, with no blocking finding.** API/logo source and the completed workspace UI were independently checked after their respective freeze signals. The new workspace subsequently passed actual cloud acceptance on deployment `b88ecf9b-58a2-4a19-918d-3ab3f00d59a9`; see the final section. Earlier public/media/proxy checks remain covered by `cloud-showcase-qa-2026-09-09.md`.

## Independent API results

- `pnpm exec tsc --noEmit`: **exit 0**.
- Executed the actual Vitest CLI for `packages/api/test/operator-profile.test.ts --testTimeout=180000 --hookTimeout=180000`: **9 passed, 0 failed, 0 skipped; 1 file passed**, duration 15.81 seconds.
- Private owner credentials were read from `scratchpad/local-demo/local-config.json` inside an inline Node wrapper and passed only in the child environment. `DATABASE_URL` used owner `demo_owner`, host `127.0.0.1`, port `55432`, base database `postgres`; `PLAYERONE_DB_ROLE=playerone_app` restricted application requests. No secret value was printed.
- The existing test helper created fresh database **`postgres_api_operator_profile_26b2c177a8`**. A separate read-only connection independently confirmed `current_database()` equals that name, `current_user=playerone_app` and database timezone **America/New_York**. The tests' truncation/migration work was confined to their newly created test database, never `playerone_local_demo` or cloud data.

Checked `packages/api/src/operator-profile.ts`, registration in `index.ts`, central actor guards and the test implementation. No confirmed defect was found in the bounded source/API pass:

- Profile identity comes from the authenticated operator, not query parameters; projection excludes credential hashes, other people and audit payload/target data. Operator status is rechecked and current role comes from the row.
- The fixed **84 consecutive calendar dates** include today's date in **Asia/Ho_Chi_Minh**. UTC 17:00 rolls into the following Vietnam day, independently of the server/database timezone. Leap-day and year crossings are covered.
- SQL applies the same explicit Vietnam timezone for grouping and lower-midnight bound. It includes the lower bound and the request's actual `now`, excludes events even one millisecond into the future and excludes events before the first local midnight.
- Activity is own-operator audit-row count, excluding `*.login` and `*.login_failed`; collection `session.create` remains included. Same-centre peer and different-centre operator events do not enter the response. Supplied identity/from/to query parameters cannot change scope.
- Missing/invalid/incomplete credentials return 401; mismatched centres and reviewer/collector scope return 403. Retired operators return 401; admin and finance role changes are reflected without invented role names.
- Confirmed no-activity data yields 84 zero-valued days. An activity-query failure returns the standard referenced 500 with no `activity` member and no database-error disclosure, not a zero-filled success response.

The integration requests use Fastify injection with the real PostgreSQL database and restricted application role. They do not substitute for the upcoming real browser/profile HTTP pass.

## Logo source review

- `Discover` explicitly selects `playMode="always"`; the reusable intro's default is also `always`. That mode returns no persistence storage, so old once-per-session flags do not prevent the logo overlay. Restored nonzero scroll no longer suppresses an always-mode intro.
- Explicit skip, reduced motion and hash deep links still skip safely. Cleanup retains timeline kill/context reversion, listener removal, timeout cancellation, body/root overflow restoration, target visibility restoration and focus restoration when applicable. Fail-open deadline remains four seconds.
- The existing **32 vector pieces** keep their path geometry. Metadata assigns five non-letter-order beats; movement uses **steps(2), steps(3), steps(4)** before a short final lock. No render-time randomness or text replacement was introduced.
- Every piece remains black until assembled: identity lock at 1.58 seconds, color interpolation starting 1.6 seconds, color completion 1.98 seconds, docking from 2 seconds.

## Actual local browser acceptance

Used the existing preview `http://127.0.0.1:5190` and real local API/database, with actual login; no authentication/data-response fixtures. `withBrowser` and `newPage` enforced serial contexts. Local demonstration credentials were entered in the normal form. The sole fault-injection case aborted the profile network request to measure unavailable/retry behavior; it did not invent a success response.

- Independently reran console typecheck: **exit 0**. Console/design tests: **169 passed, 0 failed, 0 skipped, 11 files** with `DATABASE_URL` unset.
- **9 Home/Profile pairs:** VI/EN/ZH × 375/768/1440, height 900. All reported **0 horizontal document overflow, 0 page errors, no content images/video/canvas, no MP4/GLB requests**. Wide tables and the small-screen calendar keep overflow inside their own scroll containers.
- Home and profile headings consistently share left coordinates **18px at 375**, **24px at 768**, and **280px at 1440**. Desktop Home, mobile Profile and dark Profile screenshots were inspected. The design director also reviewed the Home1440/Profile375 composition and accepted it.
- Real `op-1` profile response and rendered identity agreed: Administrator, centre D7, region HCM, active. Calendar contained **84 date buttons**, June 19–September 10, explicitly `Asia/Ho_Chi_Minh`, with **42 recorded actions on one active day**, matching this local database. These are actual local seeded audit records, not activity invented by the UI and not cloud figures.
- Home/Profile initial and section headings share one reading edge; no Panda, marketing photo, video backdrop or count-up financial effect was present. A motion-enabled Home measured **0 rAF callbacks in 1500ms after settle**.
- Both compact widths rendered the native navigation dialog with seven route links, modal focus containment and Escape focus return. All tested destination/current-route states worked for Home, Counter, Episodes, Settle, Back office, Pipeline and Profile. Review was separately exercised with its real scoped account.
- Logo from Profile navigated to Home. Calendar Home/ArrowRight/End selected June19/June26/September10 respectively, kept focus on the selected button and updated the labeled day count.
- Profile theme changed to dark and survived reload; language changed to Chinese and survived reload with `lang=zh-Hans`. A valid image selection displayed in both profile/avatar instances and created only the account-specific local-storage preference. **No non-GET upload request** occurred. The visible browser-only disclosure was present, and Remove photo removed both images. A probe initially used the stale label "Reset photo"; only the probe selector was corrected and the action pass rerun.
- Actual profile Sign out navigated to `/login`, removed both session cookies and yielded `/whoami` **401**.
- Aborted profile fetch showed unavailable identity/activity and **0 calendar buttons**, with no fabricated zero-success calendar. Try again after restoring the real connection returned the actual **84 buttons**. API integration tests separately proved referenced 500 versus genuine empty zeros.
- Real `rev-1` login reached `/review`, made **0 operator-profile requests**, displayed no inaccessible `/profile` link, and provided a working Sign out. No review verdict or payment action was submitted.

## Actual revised-logo lifecycle

One ordinary first visit followed by **two normal reloads**, all with an empty query string, each mounted the intro after the page existed. Each began with **32 black paths**, completed with orange/blue paths, removed the overlay and restored body overflow to visible. Thus replay is not dependent on a debug/replay query or fresh session. Reduced motion mounted **0 intros**. A natural staccato frame is retained in `logo-staccato.png`; deterministic step timings are documented in the source review above.

## Sampled rendered text contrast

Bounded screenshot/glyph-difference measurements reused the existing contrast probe with transparent `!important` support. All seven functional text samples exceed 4.5:1; decorative logo fills were not treated as functional labels.

| Sample | Light | Dark |
| --- | ---: | ---: |
| Active sidebar label | 14.15:1 | 12.54:1 |
| Summary note | 7.50:1 | 6.93:1 |
| Primary action | 15.78:1 | 16.12:1 |
| Profile calendar date/timezone scope | — | 6.93:1 |

## Evidence and nonblocking follow-up

`node apps/console/scripts/workspace-independent-qa.mjs` ran the viewport matrix; `node apps/console/scripts/workspace-independent-qa.mjs actions` reran only the corrected interaction pass. A bounded inline Node module measured normal reloads, idle callbacks, rendered contrast and real reviewer signout. Results: `scratchpad/qa/workspace/results.json` and `extra-results.json`. Representative images in that directory: `home-1440.png`, `home-375.png`, `profile-1440.png`, `profile-375.png`, `profile-dark-1440.png`, `logo-staccato.png`.

One cosmetic English plural remains: **"42 actions across 1 active days"**. The design director classified it as nonblocking; fix singular active-day wording in `apps/console/src/lib/workspace-copy.ts` in a follow-up. No composition change or release-blocking issue was requested.

No feature code, live verdict, payment, ingestion or unrelated database record was changed by this reviewer. API tests use their isolated test database; local browser data is the existing demonstration database.

## Final actual cloud acceptance

Deployment **`b88ecf9b-58a2-4a19-918d-3ab3f00d59a9`** at `https://playerone-web-production.up.railway.app` passed the bounded post-deployment smoke on 9 September 2026, after the owner reported SUCCESS. This replaces the failed health-configuration redeploy `fbd33f96-abc3-4ff1-ae1e-998471a0e5b2` and older tested public deployment `eaa76de7-0706-4fee-b20a-6ea5e0f5d2b7` as the release checked here.

- `/healthz` **200**, `{ready:true}`.
- Actual visible-form administrator login **200**; `/whoami`, `/api/review/shift`, `/api/review/recent`, `/api/tasks`, `/api/operator/profile` all **200**. Private file credentials were read directly; no secrets or cookie token values were recorded.
- Both session cookies remained **Secure, HttpOnly, SameSite=Strict**.
- New desktop Home displayed the real fresh-cloud state: zero reviewed/queued/settled, unavailable approval/pace, no recent verdicts and no tasks. **0 content images/video/canvas, 0 horizontal overflow**. This does not copy the local seeded activity or financial figures.
- Real profile returned the signed-in showcase administrator and **PlayerOne showcase** centre, **84 dates from June19 through September10 in Asia/Ho_Chi_Minh**, **0 actions, 0 active days**, and all daily counts zero. UI rendered exactly 84 day buttons and the same explicit range/timezone. Desktop Home and mobile Profile screenshots were visually inspected.
- Profile logo returned to Home. At **375px**, profile had **0 horizontal document overflow**; drawer was modal, retained all seven route links, and returned focus after Escape.
- Actual visible Sign out removed all session cookies and subsequent `/whoami` returned **401**.
- Fresh ordinary `/discover` visit and one ordinary reload, both with **empty query strings**, each mounted **32 black paths** and completed the intro. Local acceptance above additionally measured two ordinary reloads.
- **0 page errors**. Final browser session was signed out and closed. No financial/review action was submitted.

Evidence: `scratchpad/qa/cloud-workspace/results.json`, `home-1440.png`, `profile-1440.png`, `profile-375.png`. The final cloud pass intentionally did not repeat the full locale matrix, all media ranges, or forged-header correlation; those prior bounded results and local source/API tests remain separately attributed. Actual ingestion, corpus-authorized review and payout processing remain outside this release acceptance.
