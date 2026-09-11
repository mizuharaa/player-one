# Independent acceptance — collector native + correctness lanes, 9 September 2026

Auditor: Claude (Opus), independent of both builder lanes.
Tree: `C:/Users/user/pw/ui-integrate`, branch `sprint/ui-revamp`, changes uncommitted.
Method: source read, repository gates, and one runtime probe of `@tanstack/query-core`.

**No browser was opened. No dev server, no Playwright, no screenshots, no database, no UI
edit, no commit.** A concurrent web audit holds the browser lock; nothing here touched it.

Every number below was measured by this session at this step. Nothing is quoted from
either handoff as evidence.

---

## 1. Gates I ran myself

| Command | My observed result |
| --- | --- |
| `pnpm exec tsc --noEmit -p apps/collector/tsconfig.json` | **exit 0**, no diagnostics |
| `env -u DATABASE_URL pnpm exec vitest run apps/collector/test --testTimeout=180000` | **42 passed, 0 failed, 0 skipped**, 4 files, 1.13 s, exit 0 |

Per-file: `i18n.test.ts` 3, `phone.test.ts` 2, `device.test.ts` 6, `api.test.ts` 31.

`apps/collector/tsconfig.json` is the only tsconfig under `apps/collector` (checked by
`find apps/collector -maxdepth 2 -name "tsconfig*.json"`); it is what
`pnpm --filter @playerone/collector typecheck` invokes, so the author's exit-0 claim and
mine are the same gate. **The skip count did not change**: the correctness handoff recorded
42/0/0 and I measured 42/0/0. No silent skip drift.

Line-count deltas against `HEAD` for the claimed files, since the handoff quotes none:

```
ui.tsx            1354 -> 1406  (+52)     TaskDetail.tsx    136 ->  138  (+2)
TabBar.tsx         240 ->   59  (-181)    SessionCreate.tsx 185 ->  214  (+29)
Home.tsx           515 ->   82  (-433)    MyTasks.tsx        41 ->   46  (+5)
TaskHall.tsx        98 ->  109  (+11)     Devices.tsx        62 ->   75  (+13)
Income.tsx         198 ->  199  (+1)      Forum.tsx         275 ->  276  (+1)
i18n.ts            918 ->  984  (+66)     Uploads.tsx       197 ->  207  (+10)
```

---

## 2. Verified and passed

### 2.1 Income's false review checkpoint is removed at the root, not hidden — PASS

**Source.** `apps/collector/src/screens/Income.tsx:67-89` (`lifecycle`). The removed line,
from `git diff`:

```
-    { key: 'review', label: tt('income.step.underReview'), done: true },
```

It was `done: true` unconditionally, for every entry, with no server input. That is what
made it false: the app told every collector "Đang duyệt / Under review" had happened,
whether or not anyone had ever opened the footage.

The new array is `uploaded -> reviewed -> paid` and the step is **gone from the array** —
not recoloured, not conditioned, not moved into a note. `income.step.underReview` is now
referenced nowhere outside `i18n.ts` (grep over `src/**` excluding `i18n.ts`: zero hits).

**The justification checks out against the server, which I read independently.**
`packages/api/src/me.ts:265`:

```ts
if (row.reviewState === null || row.reviewState === 'pending') return 'uploaded';
```

`reviewState === null` (nobody holds it) and `reviewState === 'pending'` (a reviewer holds
it, undecided) both collapse to the single collector-facing state `uploaded`. So
`/api/me/income` genuinely carries no review-start signal, and the client could not have
drawn a truthful checkpoint from it. The fix removes a condition the data cannot support.

**Collector-facing behaviour now:** an episode shows `Đã tải lên` ticked, `Đã duyệt`
un-ticked with the estimate hint, and `Đã thanh toán` un-ticked carrying the server's own
settlement sentence. Nothing claims a human has looked at the footage until
`kind === 'confirmed'`, which is the server's `confirmed` flag verbatim
(`apps/collector/src/api/http.ts:403`).

**Observation, not a defect.** `/api/me/episodes` *does* carry an `under_review` state
(`apps/collector/src/screens/Uploads.tsx:29`, `EpisodeState`), and income rows and episode
rows share `episodeId`. A truthful checkpoint is therefore derivable in-app by joining the
two queries. The lane chose removal over derivation. Removal is the honest floor; deriving
it would be strictly more informative. Flagged so the choice stays deliberate.

**Exact validation:**
`git diff apps/collector/src/screens/Income.tsx` (the deleted line is visible);
`sed -n '260,270p' packages/api/src/me.ts`;
`grep -rn "income.step.underReview" apps/collector/src --include=*.tsx --include=*.ts`.

### 2.2 The cached-failure state is genuinely distinguished — on Home, Hall and Income — PASS

The pattern, identical in three places:

- `apps/collector/src/screens/Home.tsx:45`
- `apps/collector/src/screens/TaskHall.tsx:38`
- `apps/collector/src/screens/Income.tsx:119`

```tsx
{q.isError ? <><Note text={tt(q.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} />
  <Button label={tt('common.retry')} variant="secondary" disabled={q.isFetching}
          onPress={() => void q.refetch()} /></> : null}
```

The copy is two genuinely different statements (`apps/collector/src/i18n.ts:26` and `:51`):

- `common.refreshFailed` (en, line 361): *"Could not refresh. The rows below are from the previous load; please retry."*
- `common.loadFailed` (en, line 391): *"Could not load this. Check the connection and try again."*

vi / en / zh are all present for both.

**I did not assume the react-query semantics — I measured them.** `@tanstack/query-core`
5.102.2, driven directly under Node with `QueryClient` + `QueryObserver`, no browser:

```
A cold                : status=pending isError=false isPending=true  data=undefined
B after success       : status=success isError=false isPending=false data=["row1","row2"]
C after failed REFRESH: status=error   isError=true  isPending=false data=["row1","row2"]
D cold failure        : status=error   isError=true  isPending=false data=undefined
```

So `isError && data !== undefined` **is** exactly "we have stale rows and the refresh
failed", and `isError && data === undefined` **is** exactly "there is no data". The ternary
picks the right sentence in both. That is the distinction the brief asked for, and on these
three screens it is real.

The same run proves the retry **re-issues the request**: the probe flipped its mock from
`ok` to `fail` between the two `refetch()` calls and the second call observed the new mode,
so `refetch()` re-invoked `queryFn`. In the app `queryFn` is `() => api.income()` ->
`this.req('GET', '/api/me/income')` (`apps/collector/src/api/http.ts:395-396`) — a fresh
HTTP request, not a cache re-render.

Note for whoever tests this by hand: `App.tsx:92` constructs `new QueryClient()` with no
options, so the default `retry: 3` with exponential backoff applies. One press of Retry is
up to four requests over roughly seven seconds, during which the button is disabled
(`disabled={q.isFetching}`) and "Loading…" is shown. Correct, but slower than it looks.

### 2.3 Retry affordance is reachable at the source level — PASS (device-unverified, see §4)

`Button` (`apps/collector/src/ui.tsx:598-700`) is a `Pressable` carrying
`accessibilityRole="button"`, `accessibilityLabel={label}`,
`accessibilityState={{ disabled }}`, and `onFocus`/`onBlur` driving a colour-only focus ring
on a border that is always present, so gaining focus never reflows the row. Minimum height
is `space[12] + space[2]`.

`Note` (`apps/collector/src/ui.tsx:1227`) carries `accessibilityLiveRegion="polite"`, so the
failure sentence is marked to be announced rather than only drawn.

View order on all three screens is title -> intro -> failure Note -> Retry -> loading ->
rows, which is a sane reading order.

### 2.4 No client-side money arithmetic anywhere in the collector screens — PASS

`grep -rn "reduce(\|toFixed\|Number(\|parseFloat\|parseInt" apps/collector/src/screens/`
returns, excluding `lineHeight` multipliers, only:

- `Uploads.tsx:61` `gb()` — bytes to GB, a file size;
- `TaskHall.tsx:81` `done * 100` — a progress bar width, printed beside the raw
  `claimedMinutes/targetMinutes` figures it derives from.

`Income.tsx` computes nothing: no total, no balance, no sum. Amounts and effective minutes
pass through as server strings (`http.ts:397-405`: *"Server strings, unchanged"*). Task
rates print `${unitPriceVndPerMinute} ${currency}` with the server's currency
(`Home.tsx:51`, `TaskHall.tsx:58`, `TaskDetail.tsx:103`) — no VND relabelling.

The server reinforces it: `/api/me/income` sets `amount: isDecided ? row.amount : null`
(`packages/api/src/me.ts`), so an undecided episode carries **no** amount and the row
renders `—`. A plausible-looking number cannot appear on an unreviewed episode.

### 2.5 A failed read never becomes a business answer — PASS

Checked every place a failure could be mistaken for a fact:

- `Home.tsx:31` — `ringLabel = episodes.isError ? tt('home.ringFailed') : …`. `isError` is
  tested **first**, so the reviewed-episode count is replaced by a failure string rather
  than showing the stale count or the `0` that
  `(episodes.data ?? []).filter(...).length` would otherwise produce. No zero standing in
  for unknown.
- `Home.tsx:59-61` — a failed device read shows `loadFailed`, **not** `home.gateDevice`
  ("bind a device first"). The gate is drawn only on `devices.data?.length === 0`.
- `Home.tsx:47` — the "no claimable tasks" hatch is guarded by `!tasks.isError`.
- `TaskHall.tsx:42` — the "no matches" hatch is guarded by `tasks.isError || tasks.isPending`.
- `TaskDetail.tsx:59-74` — all three of `task`/`profile`/`claims` gate the error screen, so
  a failed profile read cannot render "you have not passed the exam".
- `MyTasks.tsx:28` — the empty state is suppressed on error.

### 2.6 Authoritative availability — PASS

`TaskDetail.tsx:132` reads
`disabled={!examPassed || !task.data.claimable || alreadyClaimed || claim.isPending}`, and
`Home.tsx:29` / `TaskHall.tsx:24` filter on `task.claimable`. Spare capacity
(`claimants < maxClaimants`) is used only for the *label* `hall.full`, never to permit a
claim. `published` is surfaced separately at `TaskDetail.tsx:113`.

### 2.7 i18n parity — PASS, compiler-enforced

`i18n.ts:357` declares `export type MessageKey = keyof typeof vi;` with
`const en: Record<MessageKey, string>` and `const zh: Record<MessageKey, string>`. A missing
key in en or zh is a type error and a surplus key is a type error, so **tsc exit 0 is itself
the parity proof**; `i18n.test.ts` (`missingKeys`) re-checks it at runtime and passed. 262
keys in `vi`.

One gap worth naming: the "translated, not copied" test in `i18n.test.ts` compares `en`
against `vi` only. A pasted `zh` value would pass. Pre-existing, not this pass's doing.

---

## 3. Verified and failed

### F1 — MEDIUM — three screens keep cached rows under a notice that says the data could not load

The stale-versus-absent distinction of §2.2 was applied to exactly three screens. Three
more keep cached rows and print the *wrong* sentence.

| Screen | Line | Notice used | Cached rows still rendered? |
| --- | --- | --- | --- |
| `apps/collector/src/screens/Uploads.tsx` | 91 | `common.loadFailed` | yes — `data={episodes.data ?? []}` (line 87) |
| `apps/collector/src/screens/MyTasks.tsx` | 23 | `common.loadFailed` | yes — `data={claims.data ?? []}` (line 20) |
| `apps/collector/src/screens/Devices.tsx` | 44 | `common.loadFailed` | yes — `(devices.data ?? []).map(...)` (line 49) |

By the query-core measurement in §2.2 (state C), all three reach `isError === true` with
`data` still populated after a failed background refresh. The collector then sees stale
episode verdicts, stale claim names, or stale bound-device serials and statuses in rows,
sitting under the sentence *"Could not load this. Check the connection and try again."*

Both handoffs assert this is already right. `functional-fixes-2026-09-09.md` line 23:
*"Devices … preserves existing rows with a failed-refresh notice"* and *"MyTasks …
retains cached rows with an error/retry notice"*. The rows are retained; the notice is not a
failed-refresh notice. `native-refinement-handoff-2026-09-09.md` line 32 scopes the promise
to *"Home, TaskHall or Income"* only — which is accurate — so the two documents disagree
with each other about Devices and MyTasks.

The remedy already exists in the tree: reuse the same ternary.

**Exact validation:** `grep -n "loadFailed\|refreshFailed" apps/collector/src/screens/*.tsx`
— three screens use the ternary, four use the bare `loadFailed`. Then re-run the query-core
probe in §2.2 to confirm `isError && data !== undefined` is reachable.

### F2 — MEDIUM — the only staleness marker lives in a scrolling header

`ui.tsx:308` puts the screen `Header` **and** the caller's `header` node inside
`ListHeaderComponent` of the `FlatList`; `ui.tsx:251-261` does the same for `Screen`'s
`ScrollView`. The `common.refreshFailed` Note and its Retry button are part of that header,
so they scroll off the top.

On Income the per-row content is money: `Amount` (`Income.tsx:171`), effective minutes,
settlement state, and a lifecycle timeline. **No row carries any staleness marker of its
own** — `renderItem` at `Income.tsx:128-196` never reads `income.isError`. A collector who
has scrolled two rows down is reading confirmed and estimated payment figures from a failed
refresh with nothing on screen saying so.

This is a structural fact readable from source. What I cannot state without a device or the
web harness is the scroll distance at which the notice leaves the viewport, or whether it
does so at realistic row counts. That is why this is medium and not the high-severity case
the brief describes: an indication does exist, it is just scroll-coupled.

**Exact validation:** read `apps/collector/src/ui.tsx:293-320` (ListHeaderComponent
composition) and `apps/collector/src/screens/Income.tsx:116-196` (no `isError` reference
inside `renderItem`). To exercise: fail `GET /api/me/income` after a successful load, then
scroll past the header.

### F3 — MEDIUM — no test covers either claimed correctness fix

Both fixes live in `.tsx` render bodies, and `lifecycle` is module-private — `Income.tsx`
exports only `Income`.

**Evidence I measured:** `apps/collector/package.json` devDependencies contain no
`@testing-library/react-native`, no `react-test-renderer`, no `jest`.
`ls node_modules/.pnpm | grep -i "testing-library\|react-test-renderer"` returns nothing.
`grep -rln "render\|@testing-library" apps/collector/test/` matches only a prose comment at
`api.test.ts:63`. **Zero components are rendered anywhere in the 42 tests.**

The 31 `api.test.ts` cases cover the HTTP client, token lifecycle and wire mapping — real
and valuable — but not one asserts the Income timeline shape or the
`loadFailed`/`refreshFailed` branch. The green suite is therefore not evidence for either of
the two headline claims. My §2.1 and §2.2 conclusions rest on a source read plus a library
probe, and I am saying so plainly rather than letting 42/0/0 stand in for them.

**Exact validation:** `grep -rn "lifecycle\|refreshFailed" apps/collector/test/` — no hits.
`grep -n "export" apps/collector/src/screens/Income.tsx` — only `Income`.

### F4 — MEDIUM — the handoff under-reports what the Home rewrite deleted

`Home.tsx` went 515 -> 82 lines (-433), measured in §1. The handoff's one-line table entry
describes only what is *present* ("Task hall and My Tasks are the first actions… remain
reachable through plain rows") and names no removal.

Comparing element sets between `HEAD` and the working tree, Home lost these components
outright: **`RingChip`, `Panda`, `Image`, `Frost`, `Rule`, `Tag`** — including the Trúc
panda mascot and the progress ring — plus the preview's `detail.target`, `hall.slots` and
`hall.full` lines. `TabBar.tsx` went 240 -> 59 (-181) on a table entry that reads as a
refinement ("Labels wrap… Reports actual bar height").

The remaining screen is coherent and I found no correctness fault in it. The finding is that
a 433-line deletion of approved brand and design elements is undisclosed, so the next
reviewer cannot tell removal-by-decision from removal-by-accident.

**Exact validation:**

```
git show HEAD:apps/collector/src/screens/Home.tsx | grep -oE "<[A-Z][A-Za-z]+" | sort -u
grep -oE "<[A-Z][A-Za-z]+" apps/collector/src/screens/Home.tsx | sort -u
```

### F5 — LOW — Devices contradicts itself on a failed refresh

`apps/collector/src/screens/Devices.tsx:46-48`:

```tsx
{devices.data !== undefined && devices.data.length === 0 ? <Hatch text={tt('devices.empty')} /> : null}
```

Unlike the equivalents on Home, Hall, MyTasks and Income, this is **not** guarded by
`devices.isError`. A cached empty list plus a failed refresh renders "Could not load this"
(line 44) directly above "No devices bound" — a definite business statement — at the same
time. Add `&& !devices.isError`, or fix it alongside F1.

**Validation:** `sed -n '43,50p' apps/collector/src/screens/Devices.tsx`.

### F6 — LOW — "the rows below are from the previous load", with no rows below

On Income and Hall, a cached **empty** result plus a failed refresh gives
`data !== undefined` -> `common.refreshFailed` ("The rows below are from the previous
load"), while `empty={… isError … ? null …}` suppresses the empty state, so nothing renders
beneath the sentence. Harmless, but it reads as a bug to a collector.
Source: `Income.tsx:119` with `:123-127`; `TaskHall.tsx:38` with `:42`.

### F7 — LOW — TabBar exposes the same action twice to a screen reader

`apps/collector/src/shell/TabBar.tsx:44` and `:51`, in the non-expanded branch, are two
separate `Pressable`s with identical `accessibilityRole="button"`,
`accessibilityLabel={tt('session.title')}`, `accessibilityHint={tt('tab.sessionHint')}` and
`onPress={prepare}` — the raised circle and the caption beneath it. Visually one control; to
TalkBack, two consecutive identical stops. One of them wants
`importantForAccessibility="no-hide-descendants"`.

**Validation:** `sed -n '42,56p' apps/collector/src/shell/TabBar.tsx`.

### F8 — LOW — three i18n keys newly orphaned

262 keys in `vi`; 14 are unreferenced outside `i18n.ts`. Of those, three became orphans **in
this pass** (referenced at `HEAD`, unreferenced now):

- `income.step.underReview` — the removed checkpoint (§2.1)
- `home.take`, `hall.perMinute` — the Home rewrite (F4)

The other 11 (`tab.tasks`, the four `shift.*`, `home.session`, `home.income`,
`guide.tasks.list`, `detail.payment`, `devices.serial`, `uploads.confirmCancel`) were
already unreferenced at `HEAD` and are not this pass's doing.

Because `MessageKey` derives from `vi`, dead keys cost three translations each and the
typechecker cannot see them.

**Validation:** a 10-line Node walk of `apps/collector/src` matching each `'key':` in the
`vi` block against the concatenated source, with dynamic `` tt(`prefix${...}`) `` prefixes
excluded. Re-run it against `git archive HEAD apps/collector/src` for the delta.

### F9 — LOW — `TabBar.tsx` gained a UTF-8 BOM

`head -c 3 apps/collector/src/shell/TabBar.tsx | xxd` -> `efbb bf`.
`git show HEAD:apps/collector/src/shell/TabBar.tsx | head -c 3 | xxd` -> `696d 70` ("imp").
It is the only BOM among the files I sampled (`ui.tsx`, `Home.tsx`, `Income.tsx` are clean).
tsc tolerates it; some tooling does not. Almost certainly an editor artefact of the rewrite.

### F10 — LOW — Income asserts ₫ with no server currency behind it

`apps/collector/src/screens/Income.tsx:173` — `` `${entry.amountVnd} ₫` `` — hardcodes the
dong sign at the same moment the task lane stopped doing that for rates (`TaskDetail.tsx:103`
now prints `task.data.currency`). `/api/me/income` carries no currency field at all
(`packages/api/src/me.ts`, the `IncomeRow` map), and the client type `IncomeEntry`
(`api/types.ts:146-154`) has none either. The symbol is not currently *wrong*, but the screen
states a currency the response never asserted — and it reaches the collector's eye on the
payout screen.

### F11 — LOW — Back scrolls off-screen

`ui.tsx:260` and `:308` moved `Header` inside the scroll container. On a long screen
(TaskDetail, SessionCreate) the Back control is reachable only by scrolling to the top.
Android system Back still works, so nothing is trapped; noted because the handoff lists
"scrolling screen headers" as a feature without naming this consequence.

### F12 — LOW, PRE-EXISTING — a missing size renders as `0.0 GB`

`apps/collector/src/api/http.ts:362` `sizeBytes: Number(e.size_bytes ?? 0)` feeding `gb()` at
`Uploads.tsx:61`. An absent or unparseable `size_bytes` prints "0.0 GB" — a zero standing in
for unknown, the pattern the brief names. Not money, not introduced by this pass, unchanged
in the diff. Recorded for completeness.

---

## 4. Could not verify, and why

Nothing in this section is a pass. Each item needs a surface I was instructed not to open or
that does not exist on this machine.

**Blocked by the no-browser instruction (a concurrent web audit holds the lock):**

- That the retry button is actually operable, that pressing it visibly re-issues the
  request, and that the failure notice appears where I read it in the tree. My evidence is a
  source read plus a library-level probe — **that is evidence, not a pass.**
- F2's real severity: how far a collector must scroll on Income before the staleness notice
  leaves the viewport.
- Layout at 320/360/390/412 dp, short height and landscape; the wrapping, 48 dp region and
  no-truncation claims across the eleven files; Vietnamese and Chinese line breaking.

**Blocked by the absence of a physical Android device or a native build:**

- Whether `accessibilityLiveRegion="polite"` on a **freshly mounted** `Note` announces under
  TalkBack. RN maps it to `View.setAccessibilityLiveRegion`, which announces on content
  change within an existing region; a view that appears already carrying the attribute is
  not reliably announced. This governs whether a blind collector learns the figures went
  stale, so it needs a device before shipping.
- TalkBack traversal order and D-pad / physical-keyboard focus order, and therefore whether
  F7's duplicate stop is merely noisy or actually confusing.
- `KeyboardAvoidingView` at `ui.tsx:250` passes
  `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`. On Android it is an inert
  `View`; correct keyboard behaviour depends entirely on `windowSoftInputMode`, which lives
  in a native project this repo does not contain. The handoff's "iOS keyboard avoidance" is
  untestable here in either direction.
- Elevation (`TabBar.tsx:45`), real safe-area insets and cutouts. `bottomInset`
  (`ui.tsx:74-81`) infers system chrome from
  `Dimensions.screen - window - StatusBar.currentHeight`, an approximation no safe-area
  module backs.
- Whether `measureTabBar`'s reserve (`ui.tsx:144-161`) is correct at native `fontScale > 1.2`,
  where TabBar takes its two-row branch. The mechanism is a module-level mutable
  `measuredTabHeight` plus a `useSyncExternalStore` fan-out; it reads correctly and has a
  computed fallback when unmeasured, but the resulting number is an on-device measurement.
- The System typeface. `ui.tsx:90` now returns `theme.font.sans` off web, per the known
  constraint — behaviourally sound in source, unverifiable in appearance.

**Not attempted by instruction:** any database-backed suite, any commit, any UI edit.

**Not exercised:** BLE (`MockDeviceTransport`; no native module), QR scanning, media
transfer, real `/api/me/*` responses. Every runtime conclusion above rests on mocked
transport or on direct library probes.

---

## 5. Bottom line

The two headline correctness fixes are **right in source**, and for the Income checkpoint I
confirmed the justification independently in the server (`me.ts:265`) rather than take the
builder's word for it. The stale-versus-absent distinction is real, correctly derived from
measured react-query semantics, and correctly worded in all three locales — **on the three
screens that received it**.

What stops this being a clean acceptance is not the fixes but their edges: the same
distinction is missing on Uploads, MyTasks and Devices while both handoffs imply otherwise
(F1); the only staleness marker on the payout screen scrolls away and no row carries one
(F2); and no test exercises either fix, so the green 42 is not evidence for the claims it is
being offered against (F3).

`tsc` exit 0 and 42 passed / 0 failed / 0 skipped are mine and they hold. Everything about
layout, TalkBack, elevation, insets, the system typeface and on-device timing remains
**unverified**, and I am not certifying any of it.
