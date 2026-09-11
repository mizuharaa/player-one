# Independent recheck — collector native correction batch (2026-09-09)

Auditor: Claude (independent QA). I did not write any of the code under review.
Repo rule 2: whoever made the thing never checks the thing. Every claim below was
reproduced against source and against test evidence, not accepted on the builder's word.

## Measurement boundary

| Item | Value |
| --- | --- |
| Worktree | `C:\Users\user\pw\ui-integrate` |
| Branch | `sprint/ui-revamp` |
| HEAD sha | `fc84a984527b6cd587ca34c64ca3fb358b4c4d2a` |
| State measured | **Working tree, uncommitted.** All collector corrections are unstaged modifications on top of HEAD. Nothing in this batch is committed. |
| Collector diff vs HEAD | 26 modified collector files + 1 untracked (`apps/collector/src/api/session-entry.ts`); whole-tree `git diff --stat` = 33 files, 848 insertions, 2373 deletions. |

Constraints honoured: **no browser** (no Playwright, no chromium, no headless shell, no
playwright MCP), **no database** (no psql, vitest run with `env -u DATABASE_URL`), **no
server/port**, **no product code edited** (read-only on `apps/collector/**` and all other
product source), no commits, no stash, no branch operations. The only file I wrote is this report.

Known NUL-byte grep trap: checked explicitly. I scanned every `.ts`/`.tsx` under
`apps/collector/src` for grep-binary detection — **zero files detected as binary**, so no
absence reported here is a silently-skipped file. All source scans used `grep -a` regardless.

## Gates — my own numbers, observed at this step

| Gate | Command | My observed result |
| --- | --- | --- |
| Typecheck | `pnpm exec tsc --noEmit -p apps/collector/tsconfig.json` | **Exit 0.** No output. (`apps/collector/tsconfig.json` is the correct path.) |
| Unit tests | `env -u DATABASE_URL npx vitest run apps/collector` | **4 files, 4 passed, 0 failed. 42 tests, 42 passed, 0 failed, 0 skipped.** Exit 0. Files: `phone.test.ts` (2), `i18n.test.ts` (3), `device.test.ts` (6), `api.test.ts` (31). |
| Tree state | `git status -sb`, `git diff --stat` | As in the boundary table above. |

### Renderer check — this governs how much any test proves

**There is still no renderer installed.** `react-test-renderer`, `@testing-library/react-native`
and `react-native-testing-library` appear in neither `apps/collector/package.json` nor the
installed `node_modules` (app-local or root). `apps/collector/tsconfig.json` `include` is
`["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts"]` — the test glob is `.ts` only, so a `.tsx`
test could not even be typechecked as written. All four suites are data-layer suites
(`api`, `device`, `i18n`, `phone`); **not one test mounts a screen component.**

Consequence, stated plainly: for F1, F2, F5, F6, F7 and F12 the passing suite is **not**
evidence about rendered output. It proves the API layer and the message catalogue. The
rendering claims below are verified by **source reading only**, and that is a weaker grade
of evidence than a green test implies.

## Claim-by-claim verdicts

| Claim | Verdict | Evidence |
| --- | --- | --- |
| **F1** — cold vs stale cache error on Uploads, MyTasks, Devices | **VERIFIED (source only)** | All three use the same predicate `data === undefined ? 'common.loadFailed' : 'common.refreshFailed'`: `apps/collector/src/screens/Uploads.tsx:92`, `apps/collector/src/screens/MyTasks.tsx:23`, `apps/collector/src/screens/Devices.tsx:44`. The predicate is sound: no `placeholderData` or `initialData` is configured anywhere in the app (grepped `-a`, zero hits), so under react-query v5 `data === undefined` is exactly "nothing was ever loaded". Same fix also present on `Income.tsx:119`, `Home.tsx:45`, `TaskHall.tsx:38`. |
| **F5** — Devices does not claim "empty" when the fetch errored | **VERIFIED (source only)** | `Devices.tsx:46` — `!devices.isError && devices.data !== undefined && devices.data.length === 0` gates the `Hatch text={tt('devices.empty')}`. The error branch is a separate, earlier node at `Devices.tsx:44`. Diff confirms the added guard: previously the line was `devices.data !== undefined && devices.data.length === 0` with no error handling on the screen at all. |
| **F12** — absent/invalid size → localized "Not supplied"; real zero preserved | **VERIFIED (source only)** | Predicate is `toSizeBytes` at `apps/collector/src/api/http.ts:454-459`, applied at `http.ts:362`. It returns `null` for non-number/non-string, for a whitespace-only string, and for any non-finite or negative `Number(value)`; it returns `0` for a real `0` (`bytes >= 0` admits zero). Render site `apps/collector/src/screens/Uploads.tsx:118` branches on `sizeBytes === null`, so `0` falls through to `gb(0)` → `"0.0 GB"`. Type is `number \| null` at `api/types.ts:141`, so `undefined` cannot reach the render site. The string is localized in all three locales: `i18n.ts:273` (vi `Chưa có thông tin`), `:598` (en `Not supplied`), `:900` (zh `未提供`). |
| **F2** — per-row staleness indicator on Income | **VERIFIED (source only)** | `apps/collector/src/screens/Income.tsx:146` — `{income.isError ? <Note text={tt('income.stale')} /> : null}` sits **inside** `renderItem`, per row, not in the `header` slot (header is lines 116-122). Key exists in all three locales: `i18n.ts:27`, `:364`, `:681`. Diff confirms the previous version had only a single `common.loadFailed` note in the `empty` slot. |
| **F6** — `common.refreshFailed` accurate for empty caches | **VERIFIED (source only)** | The string ("The last loaded result is retained; please retry", `i18n.ts:363`) is now reachable **only** when `data !== undefined`, i.e. only when a load actually succeeded at some point. Every one of the six call sites is guarded (`Uploads.tsx:92`, `MyTasks.tsx:23`, `Devices.tsx:44`, `Income.tsx:119`, `Home.tsx:45`, `TaskHall.tsx:38`). No unguarded `refreshFailed` exists anywhere in `apps/collector/src` (grep `-a`, whole tree). |
| **F7** — compact prep caption out of the a11y tree and tab order; main button still accessible | **VERIFIED (source only)** | `apps/collector/src/shell/TabBar.tsx:53` — the caption `Pressable` carries `accessible={false}`, `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`, `focusable={false}` and `tabIndex={-1}`, all four RN-relevant mechanisms. `tabIndex` is a genuine RN 0.82 core View prop (`react-native/Libraries/Components/View/ViewPropTypes.d.ts:125`, `tabIndex?: 0 \| -1`), not a react-native-web-only prop. The main raised button at `TabBar.tsx:44-47` carries `accessibilityRole="button"`, `accessibilityLabel` and `accessibilityHint` and **none** of the hiding props — confirmed NOT also hidden. The enlarged-type branch (`TabBar.tsx:39-41`) renders no caption at all, so the concern is compact-branch-only and is addressed there. |
| **F4 disclosure** | **PARTIAL** | See below. |

### F4 disclosure, in detail

The doc is `docs/design/native-refinement-handoff-2026-09-09.md` (87 lines). The disclosure
section is titled "Deliberate Home composition removals (QA F4 disclosure)" at line 27.

What it **does** disclose, and what I confirmed against the diff:

- It names the removed Home elements by identifier: `Panda`, `Image`, `Frost`, `RingChip`,
  `Rule`, `Tag` (doc line 29). All six are genuinely gone — `git show HEAD:…/Home.tsx`
  imports them at lines 1, 12, 19, 22, 29 and uses them at lines 180, 216, 267, 379, 454, 498;
  the current `Home.tsx` imports (lines 1-10) contain none of them, and the
  `assets/landing-poster.jpg` import is gone too. The prose disclosure is accurate.
- It discloses the density changes (doc line 31: task target/progress, claimant-capacity
  detail, full-task shelf) and states outright that this is "not a claim that all former
  Home elements were preserved". That is honest framing.

Where it falls short:

1. **The doc states no line numbers at all.** The "515→82" and "240→59" figures are not in
   it — grep for `515`, `240`, `82`, `59` returns no such claim. So the doc cannot be said to
   "explicitly disclose" the magnitude of the removal; it discloses the *nature* of it in prose
   and leaves the size unquantified. Doc line 33 on TabBar says only "its line reduction
   includes removal of the old explanatory commentary".
2. **My own measurement of the magnitude**, which the doc should have carried:
   `Home.tsx` 515 → **82** lines (`git diff --numstat`: 50 added, 483 deleted).
   `TabBar.tsx` 240 → **61** lines (39 added, 218 deleted). Note **61, not 59** — if 240→59
   was asserted anywhere, it undercounts the surviving file by 2 lines. Trivial in magnitude,
   but it is an unverified number, and the correct pair is 515→82 and 240→61.
3. TabBar's disclosure attributes the reduction largely to "removal of the old explanatory
   commentary". 218 deleted lines against 39 added is a rewrite, not a decommenting. The
   characterisation understates what happened even though the retained behaviour claim
   (four destinations + preparation action, separate row at enlarged type) is accurate —
   confirmed at `TabBar.tsx:10-15` and `:39-41`.

**Non-finding I checked because the removal made it plausible:** the guide overlay targets
`home.ring` and `home.tasks` (`apps/collector/src/guide/Guide.tsx:47-48`). Both are still
registered by the rewritten Home (`Home.tsx:27-28`) and both refs are attached to real nodes
(`Home.tsx:43` and `:64`). The Home reduction did not orphan a guide step.

**Exact validation step for F4** (for the builder): add the measured pair to the disclosure —
`Home.tsx` 515→82 (−483/+50) and `TabBar.tsx` 240→61 (−218/+39) — and reword the TabBar
sentence so it does not attribute a 218-line deletion to comment removal. Verify with
`git diff --numstat -- apps/collector/src/screens/Home.tsx apps/collector/src/shell/TabBar.tsx`
and `wc -l` on both files.

## F10 — recorded, not re-litigated

Asked to confirm in one grep that `packages/api/src/me.ts` around line 650 carries the
Income currency in the server envelope. **Confirmed with one correction to the wording:**
the field is `currency: 'VND'` at `packages/api/src/me.ts:650`, inside the income envelope
return. The identifier `currencyVND` (or `currency_vnd`) **does not exist anywhere in the
repo** — `grep -rain` over `packages` and `apps` returns nothing. The substance stands (the
envelope declares VND at that line); only the field name in the earlier note was wrong.
Closed, not re-opened.

## Test-backed versus source-backed — the blunt version

**Backed by a test that actually exercises the behaviour: none of F1, F2, F5, F6, F7, F12.**

There is no renderer. No test mounts `Uploads`, `MyTasks`, `Devices`, `Income`, `Home` or
`TabBar`. Every rendering verdict above is me reading a JSX predicate and reasoning about
what react-query puts in `data`. That is a real check, and the predicates are correct, but it
cannot catch a node that renders in the wrong order, a guard that a parent short-circuits, or
a prop the platform ignores at runtime.

Partial test backing exists for exactly one thing: **the strings**. `test/i18n.test.ts:23-25`
asserts `missingKeys(locale)` is empty for every locale, so `common.loadFailed`,
`common.refreshFailed`, `income.stale` and `uploads.sizeUnknown` provably exist in vi/en/zh,
and `:27-36` proves they are translated rather than pasted. That backs the *localized* half of
F12 and the string half of F2/F6. It says nothing about which string is chosen when.

`toSizeBytes` — the whole point of F12 — has **zero** test coverage. The only
`size_bytes` in the suite is a single real value, `test/api.test.ts:508` (`2684354560`).
The `0` / `null` / non-numeric distinction is never executed by a test.

### Exact validation steps to convert source-only into test-backed

1. **F12, no renderer needed, cheapest win.** In `apps/collector/test/api.test.ts`, extend the
   existing `GET /api/me/episodes` stub (around line 500) with four episodes carrying
   `size_bytes` of `0`, `null`, `"not-a-number"` and omitted, then assert
   `episodes[i].sizeBytes` is `0`, `null`, `null`, `null` respectively. This exercises
   `toSizeBytes` through the public `api.episodes()` surface — no component mount required.
   Run: `env -u DATABASE_URL npx vitest run apps/collector`.
2. **F1/F5/F6/F2/F7 need a renderer before any of them can be tested.** Install
   `react-test-renderer` (matching React 19) as a collector devDependency, widen
   `apps/collector/tsconfig.json` `include` to `test/**/*.tsx`, then add one suite that renders
   each screen inside a `QueryClientProvider` seeded three ways — no cache + error, warm
   cache + error, empty-array cache + error — and asserts on the rendered text: cold shows
   `common.loadFailed`, warm shows `common.refreshFailed`, and Devices shows `devices.empty`
   in neither error case. For F7, render `TabBar` at `fontScale <= 1.2` and assert the caption
   node's props include `accessible: false` and `focusable: false` while the raised button's do not.
   Until that exists, treat every rendering verdict in this report as source-reading.

## Observations outside the seven claims

Not defects against anything claimed; recorded so they are not lost.

- `Home.tsx:59` handles a `devices` fetch error with an unconditional `common.loadFailed`,
  with no cold/stale distinction — unlike `Home.tsx:45`, which does distinguish for `tasks`.
  Same unconditional pattern at `SessionCreate.tsx:104`, `TaskDetail.tsx:63`, `App.tsx:212`.
  This never lies in the dangerous direction (it never claims data was retained when it was
  not), so F6 stands; it is an inconsistency, not a fault.
- When a cache holds a successfully-loaded **empty** list and a later refresh fails, every one
  of these screens suppresses the empty state (`Uploads.tsx:107`, `MyTasks.tsx:28`,
  `Devices.tsx:46`) and shows only the refresh notice — so the collector sees a notice above
  a blank region with no "nothing here" marker. Defensible, and arguably correct, but it is a
  deliberate composition choice nobody wrote down.
- `Income.tsx:174` renders the currency glyph `₫` as a literal rather than reading the
  envelope's `currency` field. Correct under the current VND-only contract (see F10); it
  would need revisiting only if the envelope ever carries another currency.

## Scope limits

No browser was used. No database was used. No product code was edited. No server or port
was started. Nothing in this report is evidence about a physical Android device: no hardware
was available, nothing was built for or installed on a phone, and no production claim of any
kind is made here. Safe-area, cutout, rotation, edge-to-edge and keyboard behaviour remain
unvalidated on real hardware, exactly as the handoff doc itself states at its line 81.
