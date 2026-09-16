# PlayerOne handoff — 2026-09-16, evening (session stopped for quota)

Written at the point the session was stopped. Everything here was measured or
read in this session; anything I did not verify is marked. Demo is Thursday
morning Vietnam time.

**READ FIRST, in this order:** §1 (what is blocked on Daniel), §2 (the one
command that has to run), §3 (what is unfinished and where it is parked).

---

## 1. Blocked on Daniel

| # | Item | Detail |
| --- | --- | --- |
| 1 | **Run the deploy** | §2. Live server is 16 h old and lacks the console data fix. |
| 2 | **Reviewer playback** | He approved `PLAYERONE_REVIEWER_MEDIA=1` for the demo. It lives in `cloud.env` on the VM and needs SSH. §2 step 3. |
| 3 | Vietnamese copy approval | `Đã giữ lại nội dung bạn nhập dở. Chưa có gì được gửi đi.` / `Bỏ và làm lại` — the restored-draft banner. `en`/`zh` are written. |
| 4 | Hardware over RustDesk | That machine has **no Bluetooth adapter** — the TP-Link Archer T4U is Wi-Fi only. The Orbbec sensor **is** attached. |
| 5 | Build 49 intro check on his iPhone | Low Power on and off, Reduce Motion on, plus the landing film. |
| 6 | Delete stale App Store Connect invite | `1806113@lsts.edu.vn`. My ASC key is 403 on it. |
| 7 | Decide `lizzie.berriman@gmail.com` Admin access | His account. |
| 8 | One A record on `olus.sh` → `49.213.71.116` | The only workaround for Zalo domain verification; Zalo refuses the wildcard-DNS hostname. |
| 9 | OA papers + eSMS documents from Alois | 14-day window from OA creation. |
| 10 | Phone number for the ZaloPay sandbox | Sandbox requires one. |

## 2. The deploy command, and the bug that ate the first attempt

```
cd ~/pw/l1-closeout && bash deploy/cloud/go-live.sh 49.213.71.116 \
  --ssh-user playerone --ssh-key ~/.ssh/id_rsa_playerone \
  --bucket playerone-demo-20260916 --force
```

Then, before turning playback on, read two values:

```
ssh -p 234 -i ~/.ssh/id_rsa_playerone playerone@49.213.71.116 \
  "sudo grep -E '^PLAYERONE_(REVIEWER_MEDIA|SECURE_COOKIES)=' /srv/playerone/deploy/cloud/cloud.env"
```

Only if that printed `PLAYERONE_SECURE_COOKIES=1`:

```
ssh -p 234 -i ~/.ssh/id_rsa_playerone playerone@49.213.71.116 \
  "sudo sed -i 's/^PLAYERONE_REVIEWER_MEDIA=.*/PLAYERONE_REVIEWER_MEDIA=1/' /srv/playerone/deploy/cloud/cloud.env && sudo bash -c 'cd /srv/playerone/deploy/cloud && bash up.sh'"
```

The API refuses `REVIEWER_MEDIA=1` without TLS in front (`serve.ts:60` reads
it; `PLAYERONE_SECURE_COOKIES` is this repo's "there is TLS here" signal), so
do not skip the read.

**The first attempt failed and it was a real bug, now fixed in `6d09b9b`.**
With no optional flags, go-live built the provision command line ending
`--force ''`. The empty word came from `${opt_args[@]+"${opt_args[@]}"}` over
an empty array, which in Git Bash expands to one empty word rather than to
nothing; `printf %q` wrote it as two quote characters. `provision.sh` passed it
to `configure.mjs`, which takes no positionals:

```
FAIL configuration: Unexpected argument ''. This command does not take positional arguments
FAIL provision (line 46)
```

Cost: a 48 MB bundle uploaded over a 580 KB/s link for nothing. It failed
**before** configure wrote and before `up.sh` ran, so `cloud.env` and the
containers were untouched and the API kept serving throughout. The old test
matched `--force` as a *prefix* and stayed green through the whole failure;
the new test asserts the absence of `''` and of trailing whitespace across
three flag combinations. **`node --test deploy/cloud/go-live.test.mjs` — 11
tests, 11 pass, 0 fail**, observed in this session on `6d09b9b`.

## 3. Unfinished work, and exactly where it is parked

### 3a. State persistence Cut 1 — `wip/state-persistence-cut1`, commit `abc555e`

**INCOMPLETE AND UNVERIFIED. Do not merge.** Stopped mid-build; the builder's
last words were "Now the sign-out clear, then the tab test". The only
measurement that exists is **14/14 assertions on the `forbiddenField` guard**,
run standalone under node *before* the files entered the tree. No typecheck
and no vitest run was ever observed on this code.

Files: `apps/console/src/lib/draft.ts` + `draft.test.ts`,
`components/ui/DraftRestored.tsx`, `routes/counter-draft.test.tsx`, and edits
to `Wizard.tsx`, `profile-api.ts`, `router.tsx`, `BackOffice.tsx`,
`Counter.tsx`, `TaskAssign.tsx`, `packages/api/src/i18n.ts`.

Remaining: `clearAllDrafts()` inside `signOut()` at `lib/profile-api.ts:30`
(the one place `AppShell.tsx:67` and `Profile.tsx:54` both route through), then
the URL-as-state test, then the banner in three locales.

`pw/state-persistence` (branch `lane/state-persistence`) is an **empty
worktree I created by mistake** — the agent was bound to `l1-closeout` and
`worktree-guard.js` blocked it, so nothing was ever written there. Remove it:
`git worktree remove /c/Users/Khang/pw/state-persistence`.

### 3b. Real Ego footage in the reviewer console — NOT DONE

Daniel's requirement, stated twice: **5–6 real recordings from Alois in the
reviewer console, viewable and actionable. Not AI.** I got this wrong once by
substituting Demo studio without saying so; Review is the target.

**Why nothing is there.** `card-intake.mjs` says it in its own header:
*"Submitting the ingest record moves no bytes: the API must independently hold
the same session at its media root."* The server must already have the files
on disk. Only **1 of 5** sessions finished copying to `/srv/ego-real`, and
`card-intake.mjs` was never run. `/srv/ego-real` exists on the VM and is not
touched by a deploy.

**The corpus is on this laptop**, five sessions, ~39 MB each:
`C:/Users/Khang/OneDrive/Documents/player-one/docs/sample_data/EgoCamera Sample Data/ego_AZER76400FE_20260813_07{2310,2415,2516,2538,3055}`
(`PLAYERONE_SESSIONS` points here). Verified real: fisheye first-person view
of a VNG meeting room, the wearer's own hands. **They are short** — the right
camera runs 8.5 s, 9.4 s, 10.4 s, 21 s and 60 s+. That is what was recorded on
13 August, not a limitation of any cut. They show identifiable VNG staff.

**Two routes, and route B needs no SSH:**

- **A — on the VM, the way a counter really works.** Copy the five directories
  to the VM, then `card-intake.mjs` once per session. All five land on **one**
  handover and one declared session (the ids are derived from centre +
  collector + card + day, deliberately **not** the directory name), so each
  episode resolves `automatic_single`. Gives handover-origin episodes.
- **B — from the laptop over HTTPS, not started.** The Path A phone upload
  protocol already works end to end against the live cloud
  (`deploy/cloud/smoke-phone.mjs`, 10/10 PASS: register → PUT to signed URLs →
  complete → ingested → verified). That script uses a **committed synthetic
  fixture**, so it is not a general uploader — but the same three calls with a
  real session directory would move the bytes over HTTPS with the demo bypass
  key. ~60 lines. Gives phone-origin episodes.

Either way **playback still needs §2 step 3**. Without it Review lists real
episodes with real measured minutes and honestly refuses to play the video.

Five 60-second re-encoded excerpts are staged at `C:/build/demo-footage/`
(3.0–12.0 MB each, all under Demo studio's 20 MB cap) with thumbnails and
`contact-sheet.png`. **They are the wrong vehicle for Review** — a lone MP4 is
not a session and cannot be engine-measured. They are still valid for Demo
studio.

## 4. Lanes

| Lane | Worktree | Head | State |
| --- | --- | --- | --- |
| **Candidate / integration** | `pw/l1-closeout` | `6d09b9b` on `fix/candidate-gates` | 1 commit ahead of origin. Clean tree. |
| **Astra — mobile v3 revamp** | `pw/mobile-v3-polish` | `97e3644` on `lane/mobile-v3-polish` | Active, unpushed. **Never edit in here.** |
| **State persistence** | — | `abc555e` on `wip/state-persistence-cut1` | Parked, unverified. §3a. |
| `main` | — | `40596dd` | The candidate is **110+ commits ahead**. That range carries Astra's in-flight revamp, which is why I did not push to main. |

**`8de0ff9 Polish Discover review and theme controls` arrived on
`fix/candidate-gates` from another pane during this session** — it was already
HEAD when Daniel ran the deploy. It is on origin, not mine. Establish who
authored it before assuming the candidate is only my work.

### Astra's lane, landed since build 48
`9839600` English default + language switching on Home · `efe792b` boot intro
waits for foreground (the shaking/no-logo complaint) · `8eeab93` stalled
landing footage + explicit playback · `737152f` counter registration guide
(the button that "just spawns a text") · `51e5121` B2 landing gallery ·
`97e3644` gallery disclosure fix.

**I verified the gallery myself against his img34** — composition, pastel wash,
centred wordmark and round gradient down-arrow all correct, and the six
repeated "Illustrative photo" pills (clipping mid-word on four cards) are now
one centred line inside the safe area.

**D1 — the "Tùy chọn của tôi" sheet that shows a grabber and ignores the
gesture — is still uncommitted in that worktree.** It is the defect Daniel hit
on a real device and it is in no build yet. Watch for it next.

## 5. Findings worth more than the code

### 5a. Idempotency, measured against the server — not what I first said

Of the three client-generated ids Daniel was told about, **two were already
caught by a unique index** (`collectors_external_ref_key`,
`devices_hardware_serial_key`): a fresh key produced a baffling refusal, not a
duplicate row. The **payout declaration** (`BackOffice.tsx:800`) was **not**
caught — `payout/routes/payout.ts:456-476` sets the predecessor
`isCurrent: false` and inserts the new row as current in one transaction, so a
fresh id genuinely wrote a new current payment destination. It is also the only
uuid site in that file with **no rotation path at all**.

**The two nobody named are the severe ones**, because their tables have no
natural key — only plain indexes:

- `Counter.tsx:146` `sessionId` → **a duplicate `collection_sessions` row on
  one handover.** Settlement pays on that attribution. Most severe.
- `Counter.tsx:145` `handoverId` → **a second `handovers` row for one physical
  TF card**, compounded by `landed` (`:161`) being local state over a
  half-committed two-write intake.
- `TaskAssign.tsx:78` `taskId` → a duplicate task row. Its claim ids are
  protected by `task_claims_live_key`; the **device-assignment id is not** — a
  second custody period.
- `Review.tsx:55` `verdictId` → **safe.** `episode_reviews_delivery_key` blocks
  a second review of one delivery.

### 5b. Navigating away kills a live upload — worse than the bug he reported

`apps/collector/src/screens/Uploads.tsx:172`:
`useEffect(() => () => { transfer.current?.abort(); … }, [])`.
Every navigation in that app is a **full React unmount** —
`shell/RouteTransition.tsx:10` keys the child on `JSON.stringify(route)` and
`App.tsx:89-99` renders one screen; no `react-native-screens`, no
`freezeOnBlur`. So **tapping another tab mid-upload cancels the upload.**

Precisely how bad: **recoverable if hashing had finished** — `runDelivery`
writes the resume record at its top (`packages/delivery/src/delivery.ts:344`),
so the inventory, per-file sha256s and `uploadId` survive and `Uploads.tsx:374`
draws a Resume card. **Unrecoverable if it had not** — the record is only
written after `hashSession`. The real friction is that `deliveryStage` resets
to `-1` and **nothing tells the collector the upload was cancelled or that a
resume is waiting**. Not a persistence bug. Not fixed — `Uploads.tsx` is
Astra's file this week.

### 5c. `/impeccable critique apps/collector/src/screens/Uploads.tsx` — 19/40

Snapshot:
`.impeccable/critique/2026-09-16T20-55-50Z__apps-collector-src-screens-uploads-tsx.md`.
First run for the slug, no trend. Two isolated agents; they disagreed on a P0,
which is the point of running them apart.

- **P0, both agents:** the progress bar is invisible. `theme.tsx:22` remaps
  `color.muted` to `c.paper`, and `ui.tsx` draws `Progress`'s track at
  `color.muted` — both `#F6F2EA`, **1.00:1**. Fill vs track 2.34:1. At
  fraction 0 there is no geometry. And `step.sentFiles/totalFiles` counts
  *files*, so a one-file iOS upload reads `0/1` for the whole transfer. Fix:
  track at `c.muted` `#514B63` (7.38:1) — **not** `color.border` `#B8AFA0`,
  which is 2.17:1.
- **P1:** the transfer screen's back arrow renders at full `c.ink` and does
  nothing — `onBack` falls through to `close()`, which opens
  `if (running) return`. The "Close" ghost beside it is correctly disabled.
- **P1:** the row's `accessibilityLabel` collapses the subtree, so a screen
  reader **never hears the money**; and `greenInk` vs `c.muted` is **1.51:1
  against each other**, so in greyscale confirmed and estimated money are
  identical.
- **P1:** the card route — one of two top-level options — ends at a "Done"
  button that records nothing.
- **Retracted:** "the money is clipped at the right edge." One agent read it
  off screenshots; the other measured the DOM flush at `right=370.0`/`410.0`
  with `scrollWidth === viewport`. What it actually is: the bottom dock
  covering the last row at rest scroll.
- **Closed by measurement:** all 75 i18n keys resolve in vi/en/zh (0 missing);
  no touch target under 44×44; all 21 text contrast pairs pass 4.5:1. The real
  contrast failure is **surface separation** — white row on cream page is
  **1.12:1**.
- **`detect.mjs` returned `[]`, exit 0, and that means "not measured", not
  "clean"** — its 59 rules only match CSS/HTML syntax, and RN styles are plain
  JS objects. The agent proved the detector works by scanning a deliberately
  bad fixture (exit 2, `bounce-easing`).
- `DEFAULT_LOCALE` is **`vi`** in the candidate. The English-default fix is in
  Astra's lane, unmerged — a build cut from the candidate today comes up
  Vietnamese.

## 6. Two live deployments, and they are not the same thing

| | Railway | GreenNode VM |
| --- | --- | --- |
| URL | `playerone-web-production.up.railway.app` | `api.49-213-71-116.sslip.io` |
| Purpose | public **showcase** (`deploy/showcase.mjs`) | **the demo**; phone builds point here |
| Database | Railway Postgres | `po_demo_cloud` on the VM |
| Region | **EU West** | HCM-1C, Vietnam |
| State | Online, `/healthz` `{"ready":true}` | Online, image **16 h old** |

**Unresolved:** a Railway deployment succeeded at **16:51 EDT today**, ~13 min
after I pushed the branch, and the container restarted at 16:53. The service
has **no `RAILWAY_GIT_*` variables**, which a GitHub-triggered build injects —
so it is a CLI `railway up`, not auto-deploy from my push. **I did not run it
and I did not establish which commit is in that image** (no version endpoint;
`/api/version` 404s). The deploy log in the Railway dashboard is the answer.

Railway also now warns `railway.toml` is **deprecated**, working until
**2026-12-01** (`railway config migrate`). Not urgent.

## 7. Traps hit in this session

- **Bash heredocs in this harness mangle content and fail on quotes.** A
  `cat > f <<'BODY'` with apostrophes died with "unexpected EOF". Use the Write
  tool for any file with prose in it.
- **`cd` inside a Bash call changes the session's working directory.** One
  `cd` into `pw/mobile-v3-polish` moved this whole session into Astra's lane —
  the one place the rules forbid. Always `cd` back in the same command, or use
  absolute paths.
- **`worktree-guard.js` binds to the session's launch directory, not to the
  task.** A subagent launched in worktree X cannot write in worktree Y even if
  you tell it to. Launch it where it must write.
- **`bc` is not installed** in this Git Bash.
- **ffmpeg's mjpeg encoder refuses full-range YUV** from these MP4s
  ("Non full-range YUV is non-standard"). Write PNG thumbnails, or pass
  `-pix_fmt yuvj420p`.
- **ffmpeg here has no glob pattern support** (`pattern_type glob` →
  "globbing is not supported by this libavformat build"). List inputs.
- **A prefix-matching test hides a trailing-argument bug.** §2. Assert on the
  whole line, or on the absence of the junk.
