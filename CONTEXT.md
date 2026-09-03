# CONTEXT — PlayerOne

The orientation file for anyone, human or agent, arriving at this repository.
`CLAUDE.md` holds decisions and traps. `docs/RUNNING.md` holds mechanics. This
file holds what the system *is*: the vocabulary, the shape, and where the work
had reached when it was last written down.

The authoritative specification is **not in this repository**. It is
`Player One — Engineering Brief v1.0` at `~/Downloads/`. Part 6 holds the
requirement IDs the code cites. Read it before answering a scope question.

---

## 1. What the system does

VNG PT Lab builds the platform. PaXini supplies the Ego head-worn camera and,
in Phase 1, reviews the data. Members of the public in Vietnam wear the camera,
record ordinary activity, and are paid **per reviewed effective minute**.

The whole platform exists to make one sentence true and auditable:

> This person is owed this many dong, because a named human watched this
> recording and judged this many minutes of it usable.

Phase-1 targets: 500 collectors, 40,000 hours, ~640 TB, 85–90% qualification
rate. The pilot runs about 20 devices.

---

## 2. Vocabulary

Use these words. They are the ones the code, the schema and the brief share.

| Term | Means |
|---|---|
| **Collector** | A member of the public who wears the camera and is paid. |
| **Operator** | VNG staff at a staffed upload centre, working a counter. |
| **Reviewer** | PaXini staff in Shenzhen who watch footage and judge it. |
| **Session** | What a collector set out to record, against a declared task. |
| **Handover** | The moment a TF card crosses the counter. An operator records it. |
| **Episode** | One recording as the platform stores it. Its id comes from the **directory basename only**, never from content. |
| **Effective minutes** | The reviewer's judgement of usable footage. **The only number money comes from.** |
| **Payable time** | The **intersection** of stream coverage, never the union. |
| **Verdict** | A reviewer's decision. Writes its settlement row in the same transaction. |
| **Settlement** | The debt a verdict creates. Reachable only through a review. |
| **Bill** | Settlements grouped for a period. Total floors to a whole dong. |
| **Payout attempt** | One try at moving money to one collector. |
| **Flag** | Something the ingest engine measured and wants a human to see. |
| **Hold** | The risk engine stopping a bill before it pays. |
| **Quarantine** | An episode the engine will not vouch for. Visible, never deleted. |

Requirement ID prefixes, cited throughout the code: `APP-` collector app,
`BO-` back office, `UPL-` upload, `QR-` quality review, `SET-` settlement,
`PLT-` platform, `LOC-` localisation, `PRV-` privacy, `SEC-` security,
`NFR-` non-functional, `P2-` phase two.

---

## 3. The shape

```
Ego camera ──► TF card ──► counter ──► ingest ──► episode store
                                                        │
                                                        ▼
                                                 session resolver
                                                        │
                                                        ▼
                                                   review lane
                                                        │
                                                   ┌────┴────┐
                                                   │ VERDICT │  ← the only source of money
                                                   └────┬────┘
                                                        ▼
                                    settlement ─► bill ─► risk hold ─► payout ─► ZaloPay
```

There is deliberately **no foreign key from a payment to a recording**. The only
route to money is through a review.

### Packages

| Path | What it is | Size |
|---|---|---|
| `packages/ingest` | Reads a session directory, measures it, emits an `EpisodeRecord`. **Must never need a database.** | ~4.8k lines |
| `packages/store` | Postgres schema, migrations, the invariants. 46 tables. | ~5.8k lines |
| `packages/api` | Fastify server: counter, review, settlement, payout, risk, collector app, cloud leg. | ~54.6k lines |
| `packages/contracts` | The shared `EpisodeRecord` type and episode-id derivation. | ~350 lines |
| `packages/design` | Design tokens, consumed by console and app. Contrast is tested. | ~710 lines |
| `apps/console` | React 19 SPA back office. 12 routes. | ~9k lines |
| `apps/collector` | React Native collector app. 14 screens. | ~4.3k lines |
| `packages/hardware-checkout` | Python probes for the real device and corpus. | 2 scripts |

### Three upload paths

| Path | Route | State |
|---|---|---|
| **A** | Device → phone app → cloud | **Blocked.** The device exposes no file API. |
| **B** | Device → cloud direct | Not started. Blocked on the storage decision. |
| **C** | TF card → staffed upload centre | **Built. The pilot runs on this.** |

---

## 4. Rules that must survive any change

These are settled. Do not re-litigate them; `CLAUDE.md` carries the reasoning.

- **Payable time is the intersection of stream coverage, not the union.** The
  brief's own appendix prints the union and reads ~3% high, 18% on one session.
  The engine is right and the appendix is wrong.
- **The device manifest is always advisory.** Its duration overstates media by
  about a third and its file list names files that do not exist.
- **The episode id derives from the directory basename only.** A
  content-derived id makes corruption look like a new episode.
- **Invariants belong in the schema**, as `CHECK` constraints and foreign-key
  shapes, not in TypeScript.
- **The server computes money.** A client never sends a duration or an amount.
- **Rounding happens in exactly one function**, `quantise` in `money.ts`.
- **A bill total floors to a whole dong; a bill line does not.** Flooring per
  line charges the loss per line.
- **A settlement is only reachable through a review.**
- **No TF card is cleared and no code path deletes source media.**
- **The engine must never need a database.** `env -u DATABASE_URL pnpm test`
  staying green *is* the counter working with the link down.
- **The app never starts or stops recording.** The camera's physical buttons
  do, and only they. The Bluetooth library has no record command.

---

## 5. Status — dated, and how to replace it

**Everything in this section is a snapshot taken 2026-09-03.** A previous
snapshot in `CLAUDE.md` went 92 commits stale and made agents rebuild shipped
work, which is why that file now refuses to hold status at all. Treat what
follows as evidence of a moment, and re-derive before you rely on it:

```sh
git fetch origin && git log --oneline -1 origin/main && git status -sb
git worktree list                                    # who is working on what
grep -c '"tag"' packages/store/drizzle/meta/_journal.json    # migrations
git ls-files '*.test.ts' | wc -l                     # test files
pnpm exec vitest run --testTimeout=180000            # the real numbers
```

### Measured on 2026-09-03

| | |
|---|---|
| First commit | 2026-08-19 |
| Commits on trunk | 225 |
| TypeScript | ~79,600 lines |
| HTTP routes | ~103 |
| Migrations / tables | 41 / 46 |
| Test files | 75 |
| Tests (CI, with Postgres) | **1,339 — 1,288 pass, 1 fail, 50 skip** |
| Marked shortcuts (`ponytail:`) | 68 |
| Locales | vi, zh, en |

The single failing test was `risk/engine.test.ts` asking the false-positive
report for `to=2026-09-01` while the fixture's hold is stamped at `now()`. It
went red on 2026-09-02 with no code change and is fixed by deriving the window
from the current date. It had been invisible because `pnpm audit` fails before
`pnpm test` in CI and had been red since 2026-08-30 on a new `fast-uri`
advisory — now pinned.

### Completion by area

Percentages are a judgement against the brief's requirement set, from what is
in the code.

| Area | State | Done |
|---|---|---|
| Ingest & measurement | Built | 95% |
| Episode store & spine | Built | 95% |
| Path C — counter | Built (no console screen; ADR 0003 cut) | 90% |
| Settlement & billing | Built | 90% |
| Identity & access | Built | 90% |
| Review lane | Built, incl. dispute + second review | 88% |
| Risk & anti-fraud | Built, thresholds unproven | 85% |
| Back office | Partial; BO-09 cut is deliberate | 80% |
| Operations & alerting | Partial; no alert reaches a person yet | 78% |
| Payout & ZaloPay | Code complete, **never run against ZaloPay** | 70% |
| Cloud leg (GreenNode) | Tested on MinIO only | 60% |
| Collector app | 14 screens, mock Bluetooth, no Android build | 55% |
| Reputation & tiers | Design written, schema drafted, no routes | 15% |
| Deposit & commitment | Schema drafted only, no decision behind it | 10% |
| Path A — device to phone | **Blocked** on PaXini | 10% |
| Path B — device to cloud | Not started | 0% |

### Blockers

1. **The device gives up no files over the network.** Measured on a real unit
   2026-09-03: BLE pairing and Wi-Fi handoff work exactly as documented, but
   the open ports are streaming and control only. The record/playback part of
   the SDK is explicitly outside the kit PaXini supplied. See
   `docs/hw-captures/FINDINGS-2026-09-03.md`. **Blocks Path A entirely.**
2. **No ZaloPay credentials exist on any machine.** The disbursement client is
   complete and exercised against a fake server; the sandbox suite is written,
   read-only by construction, and skips on every machine naming the four
   missing variables. Nothing between a reviewed minute and a real transfer has
   been proven.
3. **No ZNS template or access token.** Collector sign-in codes go over Zalo.
   The adapter is written; the channel has never carried a message. Blocks the
   collector app at its first screen.
4. **No ARM device**, so the BLE module is a mock behind a seam shaped 1:1 on
   PaXini's library. `apps/collector/DEVICE_DEPS.md` records the exact artifact
   and hash so a real build is reproducible.
5. **GreenNode never touched in anger.** The storage-target decision is
   recorded as "may now be resolved — confirm" and has not been confirmed.
6. **The review standard does not exist.** PaXini said on 2026-08-13 it must be
   rewritten during the pilot. Every risk threshold and reject reason is
   currently theory.

### Known documentation drift

`PRODUCT.md` still claims 342 tests, migrations 0000–0004, that reviewer
identity does not exist, and that dispute and second review are "P2 and
deliberately not built". All four are wrong. Do not treat that file's
*Capabilities and Constraints* section as current; its *Principles*, *Users* and
*Operating Context* sections are still good.

---

## 6. Traps that have already cost a day

Full list in `CLAUDE.md`. The four that bite first:

- **The corpus is per machine.** Five real sessions live in `docs/sample_data/`
  (gitignored). Without them 41 tests skip in silence and the run still looks
  green. `ls docs/sample_data | wc -l` should say 5. Set
  `PLAYERONE_REQUIRE_CORPUS=1` to make a partial copy fail instead of skip.
- **Never `git add -A` here.** The corpus is 630 MB of MP4.
- **Never edit an applied migration; append.** drizzle applies by the journal's
  `when` and never re-runs a tag. Numeric prefixes repeat deliberately —
  `0016_*` is six distinct migrations. Never renumber one.
- **`DROP DATABASE` is not hanging, it is waiting for a checkpoint.**
  `CHECKPOINT;` first, then drop, and clean up after yourself. Not doing so
  once left 2,219 `po_*` databases on the server.

---

## 7. How the work is made

One worktree per agent, one branch per job, one throwaway database each.
Branches are merged into a dated `integrate/*` branch and that goes to `main`
by pull request. Findings from QA agents are reproduced before they are
accepted — including findings against the agent's own work.

Two conventions worth knowing before you write anything:

- **Deliberate shortcuts are marked, not hidden.** A `ponytail:` comment names
  the simplification, its ceiling and its upgrade path. Several say in capitals
  that something is *not* a gate and must not be read as one. Respect those.
- **Commit messages are long and are read.** State what was measured, what
  changed and what did not. Retract a claim in the message if a measurement
  contradicts it.

**No assistant attribution in commits or pull requests.** No `Co-Authored-By:`
naming an AI, no session trailer, no "Generated with" line. The history was
rewritten once to strip these.
