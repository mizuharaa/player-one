# Running PlayerOne

From a fresh clone, on any machine. Every command is run from the repo root.

## What you need

| | Why |
|---|---|
| **Node ≥ 22.18** | The repo runs `.ts` files directly, which needs native type stripping. `node -v` |
| **pnpm 9 or 11** | Workspace. `npm i -g pnpm@9`. On pnpm 11 the repo already carries what it needs: `allowBuilds: esbuild: true` in `pnpm-workspace.yaml` and `confirm-modules-purge=false` in `.npmrc`, without which install stops on an interactive prompt that has no TTY in CI. |
| **ffmpeg** on PATH | `ffprobe` is the container-timing fallback when a PTS sidecar is unusable. Six tests fail without it, and an upload centre without it measures durations wrong. `ffprobe -version` |
| **Postgres 16+** | Only for the store, the API and their tests. Everything else runs without one. |
| **A Chromium** | Only for `apps/console/scripts/shots.mjs`, the screenshot round. `npx playwright install chromium` once. Nothing else needs a browser. |

## First run

```
pnpm install
pnpm typecheck
pnpm test
```

`pnpm test` passes on a clean machine with no database and no sample data — the
tests that need either skip themselves. That is deliberate: the ingest engine
runs at upload centres with the link down, so it must never need a database.

Expect roughly `182 passed, 160 skipped`. With a database and the sample corpus,
`342 passed, 2 skipped`.

Some ingest tests shell out to `ffprobe` over real media and are slow on Windows;
`--testTimeout=90000` if the default trips them.

## Adding a database

Any Postgres will do. A throwaway one is safest, because the test suite
truncates every table and creates a database per test file.

```
docker run -d --name playerone-pg -e POSTGRES_PASSWORD=playerone -p 5432:5432 postgres:16
```

That is the once-per-machine command. Every day after, the container already
exists and `run` fails on the name — start it instead:

```
docker start playerone-pg
```

Then point `DATABASE_URL` at it and apply the migrations:

```
# bash
export DATABASE_URL='postgres://postgres:playerone@localhost:5432/postgres'
# PowerShell
$env:DATABASE_URL = "postgres://postgres:playerone@localhost:5432/postgres"
# cmd
set DATABASE_URL=postgres://postgres:playerone@localhost:5432/postgres

pnpm db:migrate
pnpm test
```

**A password with `@` or `:` in it must be percent-encoded** — `@` is `%40`.
An unencoded one parses as part of the host and fails to connect.

The suite creates `<database>_store`, `_spine`, `_api`, `_audit`, `_counter`,
`_episodes`, `_review` and `_backoffice` beside whatever `DATABASE_URL` names, one per test
file, because vitest runs files in parallel and each truncates. Nothing else uses
them.

## Adding the sample sessions

Five real sessions from device `AZER76400FE`, recorded 13 August 2026. **Not in
the repo** — 630 MB of H.264 — and `.gitignore` excludes them. Ask Alois.

Extract so that the `ego_AZER76400FE_20260813_*` folders end up under
`docs/sample_data/`. One wrapper directory is fine; the tests look through it.
No environment variable needed:

```
docs/sample_data/EgoCamera Sample Data/ego_AZER76400FE_20260813_072310/...
docs/sample_data/<anything>/EgoCamera Sample Data/ego_AZER76400FE_.../...   also works
```

Anywhere else, set `PLAYERONE_SESSIONS` to the directory *containing* the
`ego_*` folders.

Set `PLAYERONE_REQUIRE_CORPUS=1` as well and the test run fails outright unless
all five sessions are there with their media — otherwise a missing or half-copied
corpus just skips, and the run still looks green.

Sanity check — all five must ingest, none quarantine:

| Session | Duration | Notes |
|---|---|---|
| 072310 | 8.500 s | 3 clean sessions |
| 072415 | 9.333 s | |
| 072516 | 10.400 s | IMU clock fault, streams excluded |
| 072538 | 20.980 s | never closed, zero-byte camera PTS |
| 073055 | 132.961 s | never closed, all statistics zero, 437 MB of good video |

That is acceptance 10.3.9, and the brief calls it the test to build first.

## The CLI

```
pnpm ingest <session-dir>                   summary
pnpm ingest <session-dir> --json            the EpisodeRecord
pnpm ingest <session-dir> --json --out episode.json
pnpm ingest <session-dir> --store           also write it to Postgres
pnpm ingest --list                          stored episodes, newest first
pnpm ingest --show <episode-id>             one episode and its ingest history
pnpm bench --gb 2                           throughput and peak memory
pnpm fixtures                               regenerate fixtures/sessions
```

`pnpm ingest` only works from inside the repo. From elsewhere, call node
directly: `node packages/ingest/bin/ingest.ts <session-dir>`.

Paths must be in your own shell's format — `/c/Users/...` is Git Bash and
cmd.exe cannot resolve it.

Exit codes: `0` ok or flagged, `1` quarantined, `2` not a session directory or a
bad argument, `3` measured fine but the store could not be written.

## The operator API

`packages/api` is a Fastify app, built by `buildApi({ db, tokenSecret })`.

Two credentials are required on every mutation: a machine token and an operator
token. Seed a centre, a machine and an operator with `credential_hash` set from
`hashCredential()`, then `POST /auth/machine` and `POST /auth/operator`.
`packages/api/test/counter.test.ts` is the shortest worked example.

The one exception is `POST /upload-devices/:id/heartbeat`. The upload-centre
process sends current disk and queue state when no clerk may be signed in, so
that route accepts its machine token alone and only for the device id in that
token. It writes no audit row and changes no counter data. Every audited
mutation still requires both credentials.

Two more rules on those two credentials, both read from the row and not from the
token, so a change bites on the next request rather than at the twelve-hour
expiry:

- `operators.status` must be `active`. That is how a person is deactivated —
  `DELETE` is refused by the audit foreign key, and blanking `credential_hash`
  stops only their next sign-in.
- An operator reference and a machine identifier are each **unique across the
  whole platform**, not per centre, because neither login has a centre to
  narrow by. Two centres cannot both call their clerk `counter-1`.

## Running it

```
DATABASE_URL=...  PLAYERONE_TOKEN_SECRET=... pnpm serve
```

| Variable | | |
|---|---|---|
| `DATABASE_URL` | required | A database on another machine must say whether the link is encrypted — `?sslmode=require` or `?sslmode=disable` — or `open()` refuses to start. See "Encryption, in transit and at rest" below. |
| `PLAYERONE_TOKEN_SECRET` | required | Fails closed. A secret invented at boot would sign tokens that stop verifying on the next restart, which shows up as reviewers being randomly signed out. |
| `PLAYERONE_MEDIA_ROOT` | | The directory holding the imported `ego_*` folders. Without it the console runs and the stream route answers 503 saying so. |
| `PLAYERONE_MACHINE_IDENTIFIER` | | The fixed upload device this process runs on. When this, `PLAYERONE_MACHINE_SECRET` and `PLAYERONE_MEDIA_ROOT` are all set, the process sends its heartbeat once at boot and every minute. A back-office host leaves them unset and sends nothing. |
| `PLAYERONE_MACHINE_SECRET` | | The credential for `PLAYERONE_MACHINE_IDENTIFIER`, used only to obtain the machine token for that heartbeat. Set both machine variables, or neither. |
| `PLAYERONE_CURRENCY` | `VND` | What `tasks.unit_price` is denominated in. Configuration because there is no currency column — see the gaps in `docs/review.md`. |
| `PLAYERONE_SETTLEMENT_CYCLE_DAYS` | `7` | SET-07's settlement cycle. Weekly is `[ASSUMED]` in the brief's §13.2 rather than decided, so it is a setting and not a constant. It only supplies the *end* of a period whose start the caller gave. |
| `PLAYERONE_SECURE_COOKIES` | off | Turn on wherever there is TLS. Off by default because a `Secure` cookie is never sent over plain HTTP and the symptom is a sign-in that silently does nothing. It is also this repo's single "there is TLS in front of this process" signal: with it on, the API sends HSTS, and `PLAYERONE_REVIEWER_MEDIA=1` is allowed. |
| `PLAYERONE_REVIEWER_MEDIA` | **off** | Whether a PLT-10 reviewer session may stream raw footage. Leave it off. Brief D11 records remote online playback of raw video as unresolved and escalated, and Part 7.3 says the Phase 1 arrangement is remote access and not data transfer — so a reviewer gets review metadata and no bytes until Legal signs the playback architecture. With it off a reviewer session is also refused the claim and the verdict with `451`, because a verdict on footage nobody watched is a payment on a review that did not happen. Counter operators are unaffected. Setting it to `1` without `PLAYERONE_SECURE_COOKIES=1` refuses to start: a twelve-hour bearer cookie must not cross the internet in clear. |
| `PLAYERONE_DB_POOL` | `10` | A single connection serialises the claim queue: `for update skip locked` has nothing to skip. |
| `HOST` / `PORT` | `127.0.0.1` / `8080` | |
| `STORAGE_ENDPOINT` | | The S3-compatible endpoint of the cloud store (GreenNode, once the contract is signed). Unset, the upload routes answer 503 saying so and everything else runs. |
| `STORAGE_BUCKET` / `STORAGE_KEY` / `STORAGE_SECRET` | | Required together with `STORAGE_ENDPOINT`; a partial set fails closed at boot naming what is missing. |
| `PLAYERONE_ZNS_ACCESS_TOKEN` / `PLAYERONE_ZNS_TEMPLATE_ID` | | How a collector's sign-in code reaches their phone: Zalo Notification Service (`packages/api/src/zns.ts`). Set both, or neither. With neither, the server writes each code to its own log instead of sending it, so a pilot runs before VNG has issued a ZNS account — every such line says `NOT SENT`. With one of the two, boot fails naming the other. |
| `PLAYERONE_ZNS_ENV` | `sandbox` | `production` refuses to boot with no ZNS credentials, because production with no ZNS account is not a development mode — it is a server that prints live sign-in codes into a production log. |
| `PLAYERONE_ZNS_CODE_PARAM` | `otp` | The `template_data` key the six digits go in. Whatever the approved template names it. |
| `PLAYERONE_ZNS_BASE_URL` | Zalo's | Override only to point at a proxy or a test double. |
| `REVIEW_VERIFICATION_GATE` | `local` | Which integrity check QR-02's review gate reads. `local` is the ADR 0001 deviation; `cloud` requires read-back-verified uploads and retires that ADR. Do not set `cloud` before the settlement question in the ADR's exit section is answered. |

The API serves JSON and media only. The back office is the SPA; see
[`The back-office console`](#the-back-office-console) below.

## The bucket needs one rule set on it, by hand

**Set this before the first real upload.** It is not something the code can do
for itself, and nothing else reaps what it reaps.

A large file goes up as a multipart upload. If the run is interrupted, the parts
already sent stay on the bucket — **stored, billed, and in no object listing**.
Measured against MinIO on 2026-08-27: an interrupted 200 MB upload left
`ListObjectsV2` reporting zero objects for the key while `ListMultipartUploads`
held 128.00 MB of parts. An operator looking at the bucket sees nothing.

The upload code aborts what it can prove is dead: when it resumes a key it
abandons every older open upload on that same key, because it would never adopt
one again. What it cannot judge is an upload for a delivery nobody comes back
to — the card goes home, the batch is dropped, the parts sit there. Only the
bucket can time that out.

GreenNode is S3-compatible, so the AWS CLI sets it. Seven days, which is far
longer than any legitimate resume (a 16 GB session is about 2.7 hours at the
13 Mbps the brief assumes) and short enough that a dropped batch is not still
billing next month:

```bash
cat > lifecycle.json <<'JSON'
{
  "Rules": [
    {
      "ID": "abort-incomplete-multipart-uploads",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
JSON

aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url "$STORAGE_ENDPOINT" --bucket "$STORAGE_BUCKET" \
  --lifecycle-configuration file://lifecycle.json
```

The empty prefix is deliberate: it is the whole bucket, so a prefix added later
is covered without anybody remembering to widen the rule. Today every key is
`episodes/<episode>/<ingest>/<file>`.

Read it back, and look at what is currently orphaned:

```bash
aws s3api get-bucket-lifecycle-configuration --endpoint-url "$STORAGE_ENDPOINT" --bucket "$STORAGE_BUCKET"
aws s3api list-multipart-uploads          --endpoint-url "$STORAGE_ENDPOINT" --bucket "$STORAGE_BUCKET"
```

The second command is the only way to see this cost. Run it when the storage
bill does not match what `ListObjectsV2` says the bucket holds.

## Forcing the cloud to prove one batch again

```
POST /upload-batches/<id>/upload?reverify=1
```

`POST /upload-batches/<id>/upload` skips any object it has a verification
receipt for (migration 0020), which is what makes a re-run cost only what it has
not already proved. It also means a file that verified once is never read again,
so nothing would notice the cloud damaging it afterwards — a lost replica, a bad
restore, bit rot.

`?reverify=1` clears that one batch's receipts before the run, so every object
on it is pulled back and re-hashed. Nothing else changes: it is the same route,
scoped to the machine holding the card, and it does not widen the general rule —
every other batch keeps its receipts. It is recorded as an audited
`batch.reverify` event naming the operator and how many receipts it dropped.

If an object now fails, the episode goes to `failed`: the review queue stops
serving it and the UPL-06 cache gate refuses, which is the same handling a
corrupt first upload gets. Re-running without the parameter re-sends and
re-verifies just that file.

## Encryption, in transit and at rest

### The server speaks plain HTTP, and always will

`pnpm serve` listens on plain HTTP. It does not terminate TLS, load a
certificate, or redirect. Something in front of it does that, or nothing does.
This was true before and was written down nowhere, which is what this section
fixes. Pick the deployment you actually have:

**A centre on its own LAN, operators in the same room.** This is the pilot.
Leave everything as it is: plain HTTP, `PLAYERONE_SECURE_COOKIES` off,
`PLAYERONE_REVIEWER_MEDIA` off. Turning the strict settings on here breaks the
centre and buys nothing — a `Secure` cookie is never sent over `http://`, so
sign-in silently stops working, and a browser ignores HSTS on a plain-HTTP
response anyway. Bind `HOST` to the LAN address the operators reach and to
nothing wider.

**Anything reachable from outside the room** — a PaXini reviewer in Shenzhen,
`PLAYERONE_REVIEWER_MEDIA=1`, or a centre PC with a public address. TLS in
front is mandatory, and the server already refuses the worst combination:
`reviewerMediaEnabled` with `secureCookies` off throws at boot
(`packages/api/src/index.ts:214`). Twelve-hour bearer cookies and raw footage
must not cross the internet in clear.

The configuration for the second case is a reverse proxy on the same machine,
with the app bound to loopback so nothing reaches it except through the proxy:

```
HOST=127.0.0.1 PORT=8080 PLAYERONE_SECURE_COOKIES=1 pnpm serve
```

Caddy, which obtains and renews the certificate itself:

```
centre-hcm.example.vn {
  reverse_proxy 127.0.0.1:8080
}
```

nginx, if the certificate comes from somewhere else:

```
server {
  listen 443 ssl;
  server_name centre-hcm.example.vn;
  ssl_certificate     /etc/ssl/centre-hcm.crt;
  ssl_certificate_key /etc/ssl/centre-hcm.key;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    # Range requests carry review video; do not buffer them.
    proxy_buffering off;
  }
}
```

**There is no certificate story for a centre with no public hostname, and this
document is not going to invent one.** A LAN machine cannot get a public
certificate, and nobody has decided whether the programme runs an internal CA.
Until that is decided, the answer is the one the code already enforces: remote
reviewers do not reach a centre server, and `PLAYERONE_REVIEWER_MEDIA` stays
off.

### HSTS

Sent as `strict-transport-security: max-age=31536000; includeSubDomains` when
`PLAYERONE_SECURE_COOKIES=1`, and not otherwise. It follows that variable
rather than being a switch of its own, so the two cannot disagree.

It is not sent unconditionally, and that is deliberate. On a LAN centre it
would be decoration, because a browser ignores the header on a plain-HTTP
response. Worse, if that centre later puts one hostname behind TLS, a header it
had been emitting all along pins every other path on that host to HTTPS for a
year — a centre-down event with no obvious cause. No `preload`: that is a
submission to a browser list which nobody here has made.

### The database link

`open()` refuses a `DATABASE_URL` that names a host other than loopback and
does not say whether the connection is encrypted. Add `?sslmode=require`, or
`?sslmode=disable` to state that the link is trusted. Either is accepted; only
silence is refused, because a Postgres link in clear carries every collector's
masked payout account, every operator credential hash and the whole PLT-08
audit trail.

The refusal is narrow on purpose. A loopback database — the pilot's shape and
every URL in this repo — needs nothing said about it, and defaulting to
`require` would brick a centre whose Postgres has no TLS, which gets the check
reverted rather than fixed. Measured against the local Postgres 18: no query
and `?sslmode=disable` both connect; `?sslmode=require` fails with
`ECONNRESET`, because that server has no TLS configured. If you want a real
encrypted link, configuring the Postgres server is the other half of the job.

This covers the API, both workers and the ingest CLI. It does not cover
`pnpm db:migrate`, which opens its own connection from
`packages/store/drizzle.config.ts`.

### At rest

SEC-06 — the encrypted local cache at an upload centre — is **disk encryption
on the centre PC, not anything this application does**. The mechanism, the
deployment step, the owner and the acceptance check are in
`docs/adr/0004-sec06-is-disk-encryption-at-the-upload-centre.md`. Read it
before provisioning a centre machine. Nothing in this repository will tell you
whether it has been done.

### The database user the API connects as

**Do not point `DATABASE_URL` at `postgres` on a deployment.** A superuser
bypasses every grant and owns every table, so the append-only audit trail is a
courtesy rather than a rule. Measured against the local Postgres 18, connected
exactly as the API connects:

```
TRUNCATE audit_events;                                              -- succeeded
ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only;  -- succeeded
UPDATE audit_events SET action = 'nothing happened';                -- succeeded
```

Migration `0021_app_role` creates the role to use instead. It has SELECT,
INSERT and UPDATE on every table, DELETE on `cloud_verifications` only (the one
table this codebase deletes a row from), USAGE on the sequences, and membership
of `playerone_risk`. It owns nothing, so it cannot TRUNCATE any table and
cannot disable any trigger — the three statements above all fail under it, and
so does every other route to rewriting history. It is created `NOLOGIN`,
because a migration cannot invent a password:

```
ALTER ROLE playerone_app LOGIN PASSWORD '<a password you generated>';
DATABASE_URL='postgres://playerone_app:<password>@host:5432/playerone?sslmode=require'
```

Two things to know:

- **A migration must still run as the owner.** `pnpm db:migrate` creates and
  alters tables, which `playerone_app` cannot do. Migrate as the owning user,
  then run the service as `playerone_app`. If a *different* user ever runs a
  migration, re-run the grant block in `0021_app_role.sql`: `ALTER DEFAULT
  PRIVILEGES` only covers tables created by the user that set it.
- **The whole test suite passes under this role**, which is how the grants were
  settled rather than argued about. `PLAYERONE_DB_ROLE=playerone_app pnpm test`
  hands **`buildApi`** a connection whose session role is that one, so every
  route, every audited write and every worker runs under the deployment's
  grants. The fixtures keep the ordinary connection, and that split is the
  point: creating a database, migrating it, truncating between tests and
  disabling a trigger to prove that the trigger is what refuses a write are all
  things the schema *owner* does. A test that asserts `bill_lines_immutable` by
  attempting a DELETE has to reach the trigger to be testing anything; run
  under a role with no DELETE grant it would pass for the wrong reason. Run it
  after adding a route that writes somewhere new.

## Operational alerts

`GET /api/alerts` answers PLT-12's nine conditions — PaXini's PRD §11.4 list,
adopted verbatim — as one derived query over rows the platform already writes.
Any operator session may read it. There is no alerts table, no worker and no
notification channel: for a twenty-device pilot it is a screen somebody looks
at.

```json
{ "at": "2026-08-29T…", "alerts": [
  { "id": "upload_failures", "state": "ok", "observed": 0, "threshold": 3 },
  { "id": "cloud_write_failures", "state": "ok", "observed": 0, "threshold": 3 } ] }
```

`state` is `firing` when `observed >= threshold`, `ok` when it is not, and
`no_signal` when **nothing in this system records the fact**. Two of the nine
are `no_signal` today and say so rather than reading a reassuring zero:
`review_cannot_read_cloud` (the review lane reads local media — ADR 0001 — so
there is no cloud read to fail) and `cross_border_timeouts` (nothing times the
link).

The other seven read rows. `cloud_write_failures` counts
`episode.cloud_transport_failed` audit events from the last day — an upload
centre's cloud leg that threw before it could record a verdict. A read-back
mismatch is not one of those: it does not throw, and it is
`checksum_failures`. A collector's Path A delivery is not one either; an
unlanded one sits in `collector_uploads` and is `upload_failures`.

`upload_centres_offline_or_backlogged` and `upload_devices_low_disk` read the
§11.3.2 rule 8 heartbeat, which the upload-centre process now sends (see
`PLAYERONE_MACHINE_IDENTIFIER` above). **An active `upload_devices` row with no
heartbeat counts as offline.** That is deliberate: the sender beats at boot, so
a configured machine leaves the count as soon as its process starts, and
treating a never-reporting machine as healthy is what would stop a centre that
has been dark since installation from ever firing the alert. A machine that
reports nothing has no disk figure, so it is condition 3's and not condition
4's; a `retired` machine is neither.

The thresholds are literals in `packages/api/src/alerts.ts` — the PRD gives no
numbers, and a setting invented before the first week of real data is a guess
with a knob on it. Tune them there.

## The risk worker

```
DATABASE_URL=... node packages/api/bin/risk-worker.ts          # one tick every PLAYERONE_RISK_INTERVAL_MS (60 s)
DATABASE_URL=... node packages/api/bin/risk-worker.ts --once   # one tick, a report, exit 0 (1 if any subject failed)
```

| Variable | | |
|---|---|---|
| `PLAYERONE_RISK_ENGINE` | `1` | Advisory evaluation. `0` makes every tick a no-op that says so. |
| `PLAYERONE_RISK_HOLD` | `0` | Whether a bill in the hold band gets a reversible hold that the payout rail refuses to pay past. Off until the false-positive report says the thresholds are right. |
| `PLAYERONE_RISK_INTERVAL_MS` | `60000` | |

The engine writes under the Postgres role `playerone_risk` (`SET LOCAL ROLE` at
the top of every evaluation), which can insert flags and holds and nothing
else. `0014_risk.sql` creates the role and `0016_risk_role_membership.sql`
grants it to **the user that ran the migration**. If the API or the worker connects as a different user, grant it by
hand once, or every evaluation fails on the same line:

```
GRANT playerone_risk TO <application user>;
```

The engine checks this at its first evaluation and names the statement to run.

## The back-office console

A React 19 SPA in `apps/console`, talking to the API over `/v1` and `/api` with a
cookie session. `DESIGN.md` at the repo root owns the visual system and
`docs/adr/0002-back-office-is-a-react-spa.md` says why it is a built SPA rather
than server-rendered markup. Read both before changing anything visual.

Three shells, in this order:

```
# 1. a real queue to develop against
DATABASE_URL=... node packages/api/scripts/seed-console.mjs

# 2. the API. The seed prints the PLAYERONE_MEDIA_ROOT to paste here.
DATABASE_URL=...  PLAYERONE_TOKEN_SECRET=dev  PLAYERONE_MEDIA_ROOT=...  pnpm serve

# 3. the console
pnpm -F @playerone/console dev
```

Then <http://localhost:5173>, and sign in with `HCM-01` / `pw` and `op-1` / `pw`.

`op-1`'s role is `administrator`. BO-11 (migration 0020) put the nine shaping
routes — tasks, collectors, devices, bind, unbind, assignments — behind that
role, and 0020 backfills every existing `centre_operator` to it, so an
administrator is what a seeded operator would be on a real deployment. Counter
work (the GETs, claim and release) is open to either role.

The seed makes a second operator, `fin-1` / `pw`, whose role is `finance`.
**Everything on the settle and payout screens needs that one**: a bill is what a
named person earns, so reading one, exporting one and paying one are all
finance's. `op-1` is deliberately not finance, because the operator who
generates a cycle is the one 0013 refuses when the bill is paid — the generate
is the one route on that lane which answers 409 for `fin-1` and 200 for `op-1`.

`seed-console.mjs` **truncates every table**, so point it at a throwaway
database. It puts six episodes through the real counter path and commits three
verdicts through the real endpoints, so Home's approval rate, payable time and
settled value are computed from rows the production code wrote rather than from
rows a fixture invented. It makes its own footage with ffmpeg and therefore says
nothing about PaXini's encoder — same caveat as `verify-review.mjs`.

**Always go through the Vite dev server, never straight at `:8080`.** The session
is two `HttpOnly`, `SameSite=Strict` cookies, so the browser only sends them to
the origin that set them; Vite proxies `/api`, `/auth`, `/media`, `/whoami` and
`/reference` through its own origin, and pointing the client at the API directly
drops every cookie and looks like an endless redirect back to sign-in.

### Seeing it

```
node apps/console/scripts/shots.mjs
```

Every screen at 1440 and 390, both themes, English and Chinese, into
`.impeccable/review/` (gitignored). Run it before claiming a visual change works:
a typecheck cannot see contrast, overflow, or an arc drawn from the wrong angle.

### Tokens

`packages/design/src/tokens.ts` is the only place a colour, radius, shadow or
duration is written down. After editing it:

```
pnpm -F @playerone/design build:css
```

which regenerates the committed `packages/design/generated/tokens.css`. The same
file also exports `nativeTheme()` for the React Native collector app, so a value
added straight into a component is a value that app cannot have.

## The review lane

`docs/review.md` is the design record. Two scripts go with it:

```
DATABASE_URL=... node packages/api/scripts/verify-review.mjs
```

Drives the whole lane over a real socket — sign-in, cookies, byte ranges, a
verdict, a replayed verdict — and makes its own footage with ffmpeg, so it needs
no sample corpus. Truncates every table, so point it at a throwaway database.

```
pnpm moov docs/sample_data/**/*.mp4
```

Says whether each MP4 has its `moov` atom at the front. Seeking is one small
range request when it is, and needs the tail of the file first when it is not —
which is a remux in the import path (`ffmpeg -c copy -movflags +faststart`), never
a UI fix. Exits non-zero if any file has it at the back. **The committed fixtures
are 32-byte stubs and cannot answer this**; run it over the real corpus.

## Migrations

```
pnpm db:generate     after editing packages/store/src/schema.ts
pnpm db:migrate      apply to $DATABASE_URL
```

Generated SQL lands in `packages/store/drizzle/` and is committed. Two things
drizzle gets wrong here and that a generated file may need fixing for by hand:

- It names constraints past Postgres's 63-byte limit and they get truncated into
  collisions. Name anything long explicitly in `schema.ts`.
- It emits every foreign key before other `ALTER`s, so a composite FK can be
  written before the `UNIQUE` it targets. `0001` is hand-ordered for this and
  says so in a comment; regenerating does not rewrite it.

## Where things are

| Path | What |
|---|---|
| `packages/contracts` | `EpisodeRecord` (zod), episode id and content fingerprint |
| `packages/ingest` | the measurement engine and the CLI |
| `packages/store` | Postgres schema, migrations, episode store, catalogues |
| `packages/api` | operator API: auth, counter workflow, session resolver, review API |
| `packages/design` | design tokens, once, for the console and the collector app |
| `apps/console` | the back-office SPA: React 19, Vite, TanStack, Tailwind |
| `DESIGN.md` | the visual system, recorded from the built console |
| `fixtures/sessions` | 22 synthetic sessions, one per failure mode, committed |
| `docs/episode-identity.md` | why the episode id is derived the way it is |
| `docs/matching.md` | how an episode is attributed to a collection session |
| `docs/review.md` | the review lane: the queue, the money, the screen |
| `docs/adr/` | decisions that deviate from the brief, with their expiry conditions |
| `docs/playerone-ingest-engine-spec.md` | the engine specification |

The authoritative requirements document is `Player One — Engineering Brief
v1.0`, which is **not in this repo**. Part 6 holds the requirement IDs that the
code comments cite (`PLT-`, `UPL-`, `QR-`, `SET-`, `APP-`, `BO-`, `P2-`).

## Two things that will bite

**The device manifest is always advisory.** Its `duration_sec` is wall clock and
overstates media by ~34%; its file list names files that do not exist; its
statistics go stale or read zero. Raw duration comes from stream timestamps
only. If you find yourself reading the manifest to decide something, that is the
bug.

**Payable time is the intersection of stream coverage, not the union.** Appendix
B of the brief prints an "actual media" column that is the IMU span — the widest
stream — so it reads ~3% higher than what this engine reports, and 18% higher on
072516. §5.3.3 and UPL-14 both require the intersection. The engine is right and
the appendix is the union; do not "fix" the engine to match it.
