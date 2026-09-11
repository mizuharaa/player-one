# Claude QA status — 2026-09-09

Role: independent QA/audit. I did not edit UI, merge, run a database operation,
start a server, or make an acceptance claim. Everything below I ran myself.

## 1. HEAD vs the commits named in the handoff — DISCREPANCY

The handoff named `b8b5d26` / `7e073dc` / `ba1be0b` as the "later verified
commits". **They are not the tip.**

```
HEAD = fc84a98   (branch sprint/ui-revamp, working tree clean)
```

| Commit | Ancestor of HEAD? | Date |
|---|---|---|
| `fc84a98` | **is HEAD** | 2026-09-09 |
| `b8b5d26` | yes | 2026-09-08 |
| `7e073dc` | yes | 2026-09-08 |
| `ba1be0b` | yes | 2026-09-08 |
| `1cf9cf7` | yes | 2026-09-08 |

So the named set is real and fully merged, but **one commit newer than all of
them exists and the handoff does not mention it.** `fc84a98` added the opening
sequence, the full-width wordmark ending, and a cursor fix. Any plan written
against `b8b5d26` as the tip is stale by one commit.

Branch position: **40 ahead of `origin/main`, 17 behind.** Nothing is pushed.
The 17 behind is unreviewed by me and is a merge risk nobody has assessed.

## 2. AGENTS.md vs what is built — LARGEST DISCREPANCY

`C:/Users/user/OneDrive/Documents/player-one/AGENTS.md` (25 KB, dated today)
specifies a **cinematic scroll-story website**: a pinned stage scrubbing an
image sequence, a Visual Story table before production, piecewise scroll-to-
frame mapping, and — under `# MOBILE EXPERIENCE — REQUIRED` — a **dedicated
portrait (9:16) animation** generated separately from the landscape one, with
mobile requesting only the portrait sequence and desktop only the landscape.

**None of that is what `/discover` is.** The built page is a type-led composition
with one `<video>` element, GSAP reveals and a hero timeline. There is no image
sequence, no pinned scrub, no portrait variant, no Visual Story table on record.

This is not a defect in the build — the build satisfied the briefs it was given.
It is a **specification conflict** that has to be resolved before more work:
either AGENTS.md governs and `/discover` is rearchitected, or AGENTS.md is
understood to describe a different deliverable. **I am flagging, not deciding.**

Second-order: AGENTS.md mandates Higgsfield MCP for generated assets and forbids
silently substituting another provider. Current page assets are a placeholder
film plus stills, some previously flagged for generation artefacts.

## 3. Baseline source / API discrepancies relevant to MVP

The user's competitor screenshots show a Chinese task hall, device
request/connect, My Tasks statuses, account, wallet and KYC. Against our actual
collector API surface:

| Screenshot capability | Our API today | Note |
|---|---|---|
| Task hall / browse | `/api/me/` , `/api/me/episodes` | no task-marketplace route exists |
| Device request / connect | none | BLE is mocked; `MockDeviceTransport`, no native module |
| My Tasks statuses | `/api/me/uploads`, `/api/me/uploads/:id` | upload states exist; task states do not |
| Account | `/api/me/` | partial |
| Wallet / balance | **none** | `/api/me/income` is history, not a balance |
| KYC | **none** | payout verification exists server-side only |

**Three hard boundaries the benchmark does not authorise, restated:**
1. **No invented balances.** `/api/me/income` returns history. There is no
   wallet balance in the system. A balance figure on a screen would be fabricated,
   and this is payout-bearing.
2. **No Chinese KYC flow.** Collector identity in this product runs through Zalo
   (`zns.ts`) by an explicit 2026-08-29 decision. A KYC screen copied from a
   Chinese competitor imports a regulatory model we have not adopted.
3. **No replacing the human-review contract.** Payment is per reviewed, approved
   effective minute, decided by a person. Any competitor pattern implying
   automatic acceptance or instant payout contradicts `docs/review.md` and the
   money rules in `CLAUDE.md`.

## 4. Known defects carried forward (measured, not fixed)

- **GSAP ticker never sleeps.** `/discover` idles at **64.2 rAF/s** with motion
  enabled, **0.0** under reduced motion, **0.0** on `/login` (imports no GSAP).
  Attributed by wrapping `requestAnimationFrame` and reading the call stack:
  all GSAP, none the cursor. One fix was written, measured ineffective, and
  reverted rather than shipped.
- **Sticky glass bar over ink gives the primary pill 2.45:1.** Pre-existing on
  both trees; a real contrast failure.
- **Collector CTA is a disabled control** because no APK exists. Honest, but the
  standing objection is that the most important CTA on the page is a grey
  rectangle with no alternative action.

## 5. What I have NOT done

- No acceptance claim on any commit. I re-ran gates on `fc84a98` earlier
  (tsc clean, 169 console + 36 collector tests) but that is evidence, not a pass.
- I have not reviewed the 17 commits this branch is behind `origin/main`.
- I have not verified anything on real hardware; all measurement is Chromium.
- No browsers were run outside `withBrowser`/`newPage`.

## 6. What I need to own QA properly when the build handoff arrives

1. The frozen spec the build was written against, so I can test against intent.
2. A statement of which document governs — AGENTS.md or the current brief.
3. The build agent's own measured numbers, so I can contradict them with mine
   rather than duplicate them.
