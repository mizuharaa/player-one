# Native collector refinement handoff — 9 September 2026

This records the completed native UI implementation in `C:/Users/user/pw/ui-integrate`, branch `sprint/ui-revamp`. Changes remain uncommitted. This is builder evidence, not independent visual acceptance or production certification. Claude owns independent QA.

Direction: `native-refinement-direction-2026-09-09.md`. Product coverage and constraints: `collector-feature-benchmark-2026-09-09.md`. Earlier client correctness ownership: `functional-fixes-2026-09-09.md`.

## Exact files changed by the UI pass

All paths below are relative to the repository root. Several files already contained the functional agent's uncommitted changes; this pass preserved that work rather than replacing the files from Git.

| File | UI change |
| --- | --- |
| `apps/collector/src/ui.tsx` | Wrapping button/choice/status labels; minimum 48dp button/chip/back regions; label/value rows stack at narrow widths or enlarged native text without truncation; shared server-amount presentation and plain navigation rows; scrolling screen headers; keyboard tap handling and iOS keyboard avoidance; bottom padding on detail screens; reactive reserve based on tab-bar layout; native font uses the theme's actual face rather than a CSS family list. |
| `apps/collector/src/shell/TabBar.tsx` | Keeps the four existing destinations and preparation action. Labels wrap. Above native font scale 1.2, the preparation action takes a separate row beneath the four destinations. Reports actual bar height to the shared content reserve. |
| `apps/collector/src/screens/Home.tsx` | Task hall and My Tasks are the first actions. Up to three available task previews show title, scenario/type and server rate. Device/preparation and recording history remain nearby; income, community, training and guide remain reachable through plain rows. Refresh errors preserve cached task rows and offer retry. |
| `apps/collector/src/screens/TaskHall.tsx` | Local title/scenario search and All/Available filtering use existing data. Server rate and reviewed-minute basis lead the monetary hierarchy. Cached rows remain visible beneath an explicit failed-refresh notice and retry. |
| `apps/collector/src/screens/TaskDetail.tsx` | Groups instructions and privacy content; already-claimed tasks offer the existing preparation route. Missing content stays explicitly missing. |
| `apps/collector/src/screens/SessionCreate.tsx` | Task, scenario and serial options occupy readable rows; yes/no choices wrap; the two declarations have distinct spacing. |
| `apps/collector/src/screens/MyTasks.tsx` | Shows the real claim name and claimed state, offers preparation and existing recording history, and gives the empty state a route to the task hall. |
| `apps/collector/src/screens/Devices.tsx` | Labels the binding section explicitly; serials/status use the shared wrapping layout. |
| `apps/collector/src/screens/Income.tsx` | Groups server amount, estimate/confirmation label, effective minutes and settlement status. Cached rows remain visible with failed-refresh notice and retry. Preserves the correctness agent's timeline correction. |
| `apps/collector/src/screens/Forum.tsx` | Only the existing compose button's bottom offset changed to subscribe to the measured tab reserve. No community redesign or behavior changes. |
| `apps/collector/src/i18n.ts` | Adds Vietnamese, English and Chinese search/filter/empty-result copy and `common.refreshFailed`; clarifies the device serial field label. Existing functional keys remain. |

## Preserved API and correctness behavior

### Deliberate Home composition removals (QA F4 disclosure)

The Home rewrite intentionally removed its decorative Trúc mascot, shared landing photograph, frosted photo strip, progress-ring graphic, separators and task-status tags. The previous Home-specific `Panda`, `Image`, `Frost`, `RingChip`, `Rule` and `Tag` instances are gone. The reviewed-episode information is now text beside the recording-history route; the mascot and photography were not moved elsewhere on Home. This makes finding and preparing work the primary reading path on a small working screen.

Home also no longer repeats task target/progress, claimant-capacity detail or the full-task shelf. It shows at most three claimable task previews, with the full Hall route immediately available. Task detail and Hall retain their existing task information and state. These are deliberate information-density and composition changes, not a claim that all former Home elements were preserved. The shared native palette and existing navigation routes remain.

TabBar was likewise rewritten around wrapping labels and measured spacing; its line reduction includes removal of the old explanatory commentary. It retains the four existing destinations and preparation action, with a separate preparation row at enlarged native text.

### Preserved behavior

- No API, backend, schema, money arithmetic, hardware transport, route registry, dependency, authentication or onboarding implementation changed in this UI pass.
- Task availability uses the preserved authoritative `claimable` state; rate and currency are displayed from the server. No task target is presented as a permitted recording duration. Home previews lead to task detail; claiming still happens through its existing gates and mutation.
- Real claim names, device serial/status, session selections, explicit scenario choice, both unanswered-by-default declarations, mutation locks, refusal messages and session replay behavior remain intact.
- Production QR/Bluetooth restrictions and demo-only simulation remain intact. The app still prepares a session; the camera's physical controls start and stop recording.
- Income remains per-episode history. It has no wallet, balance, withdrawal or client calculation. The correctness agent removed the unconditional “under review” checkpoint before handing off the file: the endpoint supplies no reliable review-start signal. This pass preserved that correction.
- A failed refresh on Home, TaskHall or Income retains cached rows and states that they are from the previous load. The separate correctness agent owned the corresponding Uploads recovery change; Uploads is not listed as a UI-pass file.
- Shared native identity remains lavender/ink with existing theme tokens. No GSAP, cinematic backgrounds, competitor branding or generated native assets were added.

## Author checks actually observed

| Command | Observed result |
| --- | --- |
| `pnpm --filter @playerone/collector typecheck` | Exit 0 after the final Forum reserve adaptation. Earlier intermediate runs also exited 0. |
| `git diff --check -- apps/collector/src/ui.tsx apps/collector/src/shell/TabBar.tsx apps/collector/src/screens/Home.tsx apps/collector/src/screens/TaskHall.tsx apps/collector/src/screens/TaskDetail.tsx apps/collector/src/screens/MyTasks.tsx apps/collector/src/screens/Devices.tsx apps/collector/src/screens/SessionCreate.tsx apps/collector/src/screens/Income.tsx apps/collector/src/screens/Forum.tsx apps/collector/src/i18n.ts` | Exit 0. Git emitted line-ending conversion notices only. |

No test suite, database command, browser inspection, native emulator/device run, screenshot acceptance, commit or deployment was performed by this UI builder. Typechecking does not establish layout quality, native accessibility or hardware readiness.

### Bounded follow-up to Claude's native QA

Implemented after `claude-native-acceptance-2026-09-09.md`, without changing other app behavior:

- **F2:** Each Income row now displays localized `income.stale` beside its episode identifier when the query is in error. The row therefore carries its own previous-load warning after the list header scrolls away. Amounts, settlement states and lifecycle logic are unchanged.
- **F6:** `common.refreshFailed` now says the last loaded result is retained, without asserting that visible rows exist. Vietnamese, English and Chinese cover populated and empty caches. The separate `uploads.sizeUnknown` translations added by the correctness agent are preserved.
- **F7:** The compact preparation caption remains pointer-tappable but is explicitly excluded from accessibility traversal and keyboard focus. The raised preparation button is the single accessible preparation action in that branch. The enlarged-text branch retains its existing single button. TalkBack behavior still requires independent native validation.
- **F4:** The deliberate Home removals and TabBar rewrite are disclosed above; no additional Home or navigation redesign was performed in this follow-up.

Author commands after these three code fixes: `pnpm --filter @playerone/collector typecheck` exited 0; `git diff --check -- apps/collector/src/screens/Income.tsx apps/collector/src/shell/TabBar.tsx apps/collector/src/i18n.ts docs/design/native-refinement-handoff-2026-09-09.md` exited 0 with Git line-ending notices only. No browser, tests, database, commit or deployment was run. These findings await Claude's independent recheck.

## Independent QA scenarios for Claude

1. Inspect Home, Hall, Detail, My Tasks, preparation, Devices and Income at 320/360/390/412dp, short height and landscape. Use Vietnamese, English and Chinese. Check full task names, IDs, serials, refusal messages, currency/rate strings and financial values without clipping.
2. Inspect actual native text sizes 100/130/200%. Check the normal bar and the enlarged-text separate preparation row, all destination labels, touch regions, and content reserve after rotation or text-size changes. Reach the final action on every screen. Verify Forum's existing compose button remains above the bar.
3. Open the keyboard on serial entry and task search. Verify focused fields remain usable, scrolling reaches relevant controls, and a tap on an action is handled. Check both Android gesture and three-button navigation.
4. Home: verify Task hall and My Tasks are immediately discoverable; task previews use only authoritative availability; full browsing remains reachable. Device, preparation, recording history, income, community, training and guide destinations must still open.
5. Hall: search a task title and a scenario/type; clear the search; toggle All/Available; test no matches. Unpublished/unclaimable tasks must not become available because they have spare capacity. Test a non-VND task rate without relabeling its currency.
6. Fail initial reads and then fail refetches after cached rows exist on Home, Hall and Income. Require visible failure/retry, preserved cached rows with the previous-load notice, and loading feedback during retry. Recovery must restore the existing query content.
7. My Tasks: verify real server claim names, truthful claimed state, preparation and recording-history navigation, empty-state browsing and error recovery. Do not infer an aggregate review/payment state for a multi-episode task.
8. Preparation: verify all options and both declaration questions remain readable and explicit. Delayed mutation must retain locks, failure must retain input, and successful preparation must show the session ID and physical-camera instruction. Verify its existing retry/replay contract independently.
9. Devices: test loading, failure, empty and existing rows, active/faulty/retired/unknown states, long serials and delayed/rejected binding. Production must not expose a fixed QR serial or simulated Bluetooth success.
10. Income: inspect estimated/confirmed, uploaded, unpaid, held and paid entries. Amount/minutes/status must match server strings. No fabricated review-start checkpoint, computed total, balance or animation implying payment may appear.
11. Shared primitives also serve other screens: check sign-in, onboarding, Uploads and community for regressions from wrapping buttons and scrolling headers. Verify TalkBack labels, focus order, native Back and existing reduced-motion behavior.

## Native limits and remaining dependencies

- Top/bottom system spacing still uses the repository's React Native core fallback. A native safe-area module has not been added; cutouts, side insets, rotation, edge-to-edge and keyboard behavior require actual Android validation.
- Brand fonts are not linked in a native build. Native uses the theme's System face; the browser harness loads Be Vietnam Pro and does not prove Android font appearance or Vietnamese text behavior.
- React Native Web and CSS/browser zoom do not prove native Android font-scale behavior. The enlarged bar branch responds to native `fontScale`.
- No physical device, QR scanner, BLE connection or media transfer was validated. Existing hardware and approved-content dependencies remain as documented in the functional handoff and product benchmark.
- The collector web harness remains a review surface, not evidence of a shipping collector webapp or Android release readiness.

No further UI code changes are planned until independent findings arrive.
