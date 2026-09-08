# Player One

A platform for buying first-person video from the people who record it, and
paying them per reviewed minute of usable footage.

Collectors wear a head-mounted camera through an ordinary day. The footage
comes back on a memory card, is measured, reviewed by a person, priced by the
minute, and paid. Player One is everything between the card and the payment:
the measurement engine, the episode store, the review tool, the settlement and
payout ledger, the collector's phone app, the operator console, and the upload
path to cloud storage.

Targets it is built for: 500 collectors, 40,000 hours of footage, roughly 640
terabytes, at 85 to 90 percent of recorded time qualifying for payment.

---

## The problem this solves

Paying per minute sounds simple and is not. A recording is not one file, it is
several streams that start and stop at different moments. The device's own
manifest overstates duration by about a third, names files that do not exist,
and sometimes reports zero. A camera clock can be wrong. A card can be handed
in twice. A reviewer can change their mind. Money must come out the same every
time somebody asks.

So the engine never trusts what the device says. It measures the media itself
and pays for the **intersection** of stream coverage, not the union, because a
minute is only payable if every stream that matters was actually recording.
Every rounding decision happens in one function. Every rule that decides money
is a database constraint rather than application code, so a race or a retry
cannot get around it.

---

## The shape of the system

```
 camera  ──▶  memory card  ──▶  upload centre  ──▶  cloud storage
                                     │
                                     ▼
                         measure ──▶ store ──▶ review ──▶ price ──▶ pay
                                                  ▲
   collector's phone app ─────────────────────────┘
        (claim work, declare a session, watch earnings)
```

Three routes were considered for getting footage off the camera. Only one is
built, and the reason is in the code rather than in a plan:

| Route | State |
| --- | --- |
| Card to a staffed upload centre | **Built. Everything runs on this.** |
| Camera to phone to cloud | Blocked. The device exposes streaming and control ports only, and no way to list or fetch its own files. Measured on real hardware. |
| Camera straight to cloud | Not started. |

---

## What is in here

A pnpm workspace. TypeScript, strict, run directly on Node without a build
step. Fastify and Zod on the server, Postgres through drizzle, React on both
front ends.

| Package | What it is |
| --- | --- |
| `packages/ingest` | The measurement engine. A session directory in, one episode record out. Never touches a database, so it works with the network down. |
| `packages/store` | The schema and its migrations. Where the invariants actually live. |
| `packages/contracts` | The shared types both ends agree on. |
| `packages/api` | Routes, review, settlement, payouts, cloud upload and verification, alerting, and the operator command line. |
| `packages/design` | Design tokens, the single door colour and spacing come through. |
| `apps/console` | The operator and reviewer console. Review is the product; the rest supports it. |
| `apps/collector` | The collector's Android app. Fourteen screens, a real client against the server, and a device layer still mocked. |

Roughly 44 migrations, 86 test files, about 1,500 tests.

---

## Decisions worth knowing before you read the code

These look wrong until you know why, and each one cost something to learn.

- **Payable time is an intersection, not a union.** A reference table in the
  original brief prints the widest stream's span, which reads about 3 percent
  high and 18 percent high on one real sample. The engine is right; do not
  correct it to match the document.
- **A bill is paid rounded down, and only at the total.** Never per line.
  Twenty short lines rounded individually lose twenty times the money one
  rounding at the total loses.
- **An episode's identity comes from its directory name, never its contents.**
  A content-derived identity changes when bytes change, which makes corruption
  look like a new recording and hides exactly the error the checksum exists to
  catch.
- **Cloud verification re-reads every stored byte and hashes it.** The storage
  provider suggested reading a hash back from object metadata instead. That
  returns the hash we sent, not a hash of what they stored, so it proves
  nothing.
- **A payment made before the cloud copy failed verification stands.** The
  reviewer judged real footage and the collector did the work. The settlement is
  flagged for finance and the card is re-uploaded. Never a clawback.
- **The app cannot start or stop recording.** The camera's physical buttons do,
  and only they. No screen, route or test should assume otherwise.
- **No source media is ever deleted, and no card is ever cleared.** This is a
  hard gate at acceptance, not a preference.
- **Collector routes carry no collector identifier.** Not in the path, the
  query or the body. It comes off the sign-in token, so there is no identifier
  to substitute and no ownership check anyone can forget to write.

Longer form: `CLAUDE.md` for decisions and traps, `CONTEXT.md` for current
shape, `docs/adr/` for the ones with formal records.

---

## Running it

```
pnpm install
pnpm ingest <session-dir>            measure one recording
pnpm ingest <session-dir> --store    and persist it
pnpm serve                           the API and both front ends
pnpm lanes                           what every worktree is doing right now
pnpm test
```

Full instructions, including both machine setups, are in
[`docs/RUNNING.md`](docs/RUNNING.md). Deploying an upload centre is
[`deploy/centre/README.md`](deploy/centre/README.md).

### Postgres, for the tests

The store is opt-in. The engine runs at upload centres with the link down, so
without `--store` it opens no connection and needs no database. The suite
passes without one, skipping the store tests the same way the real-session
tests skip when no corpus is present.

```
docker run -d --name playerone-pg -e POSTGRES_PASSWORD=playerone -p 5432:5432 postgres:16
export DATABASE_URL=postgres://postgres:playerone@localhost:5432/postgres
pnpm test
```

In PowerShell the second line is
`$env:DATABASE_URL = "postgres://postgres:playerone@localhost:5432/postgres"`.

The suite applies migrations itself and gives every test file its own database,
so it needs an empty server and no other setup. Migrations are generated with
`pnpm db:generate` after editing `packages/store/src/schema.ts` and applied with
`pnpm db:migrate`. **Never edit a migration that has been applied** — drizzle
applies by recorded order and never re-runs a tag, so an edit reaches only
databases migrated afterwards. Append a corrective migration instead.

---

## How this repository is worked on

Changes go through a frozen written specification, an adversarial read-only
review of that specification before any code exists, a build against it, and a
separate verification pass that runs the gates itself. Whoever wrote a change
never reviews it.

That sounds heavy for a small team and it earns its keep. Reviews of the
specification alone have caught a route that could never have been reached from
the browser, an authentication guard that would not have fired on the only
deployment that matters, and a screen that looked correct but replayed an
earlier record instead of creating a new one. All three were cheaper to find in
a document than in a diff.

Test counts are reported by whoever measured them, at the step they measured
them. A gate quoting the previous step's numbers has not run the gate.
