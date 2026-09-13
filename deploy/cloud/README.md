# One Linux VM in Vietnam: the whole loop, behind HTTPS

Railway runs the public showcase and cannot run the rest: no ffmpeg, no
persistent media root, and nothing that may hold Vietnamese footage. This kit
is one Ubuntu 22.04/24.04 VM with Docker — Caddy with automatic HTTPS, the API,
a media volume, GreenNode object storage, `REVIEW_VERIFICATION_GATE=cloud`,
`PLAYERONE_REVIEWER_MEDIA=0` and `PLAYERONE_PAYOUT_MODE=manual`. The Railway
path (`deploy/showcase.mjs`, `railway.toml`) is untouched and still serves the
public site.

It is not the upload centre. A centre is a Windows PC with card readers and its
own API (`deploy/centre/README.md`); this VM is the platform the centre, the
collector app and the reviewers reach over the internet.

**Data residency.** Every byte stays in Vietnam: this VM, the Postgres it uses
and the GreenNode bucket are all in-country, and nothing is mirrored abroad.
PaXini's reviewers in China reach *this* origin over HTTPS — remote access, not
data transfer, which is Part 7.3's Phase 1 arrangement. While
`PLAYERONE_REVIEWER_MEDIA=0` a reviewer session receives review metadata and no
footage at all, and D11 has to be answered by Legal before that changes. Leave
it at `0`.

## What the owner has to supply

| | |
|---|---|
| A domain or subdomain, and control of its DNS | `console.example.vn`. Caddy asks Let's Encrypt for the certificate itself; there is nothing to buy. |
| The VM | Ubuntu 22.04 or 24.04, Docker Engine + compose plugin. 4 vCPU / 8 GB is enough for the pilot's review traffic; the disk is what matters — the media volume holds imported `ego_*` sessions, so size it against what the pilot will hold at once, not against the 640 TB total. |
| An operations email address | Let's Encrypt expiry and revocation notices. |
| GreenNode S3: endpoint, bucket, key, secret, and the allocation in bytes | The bucket needs its lifecycle rule set by hand **before the first upload** — [RUNNING.md](../../docs/RUNNING.md#the-bucket-needs-one-rule-set-on-it-by-hand). |
| A database decision | Managed Postgres (its host and password, `?sslmode=require`), or `--profile db` to run Postgres on this VM with a named volume. |
| Generated secrets | `PLAYERONE_TOKEN_SECRET`, the machine and operator secrets, the `playerone_app` password, and the owner password if Postgres runs here. |
| ZNS, when VNG has issued the account | Until then sign-in codes are written to the API's container log and delivered to nobody, so **no real collector can sign in on this VM**. Staff can walk the loop; collectors cannot. |
| ZaloPay's read-only Verify Account credential | Manual payout still refuses to record a payment to an account ZaloPay never confirmed — the G3 gate. |

## Install

1. **The VM.** Docker Engine and the compose plugin from Docker's own
   repository. Open inbound TCP 80 and 443 and nothing else; the API is never
   published, and Postgres — managed or local — is never on a public port.

2. **DNS.** One `A` record for the hostname at the VM's public address (and
   `AAAA` if it has IPv6). Let it propagate *before* the first
   `docker compose up`: Caddy's first HTTP-01 challenge needs the name to
   resolve, and a failed issuance counts against Let's Encrypt's rate limit.

3. **The checkout and the environment.**

   ```bash
   git clone https://github.com/mizuharaa/player-one.git /srv/playerone
   cd /srv/playerone/deploy/cloud
   cp cloud.env.example cloud.env && chmod 600 cloud.env
   $EDITOR cloud.env          # every REPLACE_ value
   ```

   `cloud.env` is git-ignored. Its paths are the *container's* — `/srv/console`,
   `/data/media`, `/data/backups` are volumes, not VM directories.

4. **The database, as its owner.** The application is not the owner: migration
   `0021` created `playerone_app`, and `packages/store/src/db.ts` refuses to run
   as a superuser at all. So migrate with the owner credential once, then never
   use it again.

   With the bundled Postgres (`--profile db`):

   ```bash
   docker compose --profile db up -d postgres
   docker compose build api
   docker compose run --rm \
     -e DATABASE_URL='postgres://postgres:OWNER_PASSWORD@postgres:5432/playerone' \
     api node_modules/.bin/drizzle-kit migrate --config packages/store/drizzle.config.ts
   docker compose exec postgres psql -U postgres -d playerone \
     -c "ALTER ROLE playerone_app LOGIN PASSWORD 'REPLACE_DATABASE_PASSWORD';"
   ```

   That is what `pnpm db:migrate` runs; pnpm itself is not in the runtime
   image, and drizzle-kit opens its own connection and never meets the
   superuser refusal. `0021` creates `playerone_app` as `NOLOGIN` — the
   `ALTER ROLE` is what makes it usable, and `DATABASE_URL` in `cloud.env`
   must name it with the password set here. With a managed database, run the
   same command from anywhere that can reach it, with `?sslmode=require`.

5. **Bootstrap the centre, machine and staff**, once, with the same role the API
   uses (it inserts rows; it does not own tables):

   ```bash
   docker compose run --rm api node packages/api/bin/bootstrap.ts \
     --centre-region HCM --centre-name 'Upload centre HCM-01' \
     --machine REPLACE_MACHINE_IDENTIFIER --machine-secret 'REPLACE_MACHINE_SECRET' \
     --operator 'op-1:administrator:REPLACE_ADMIN_SECRET' \
     --operator 'fin-1:finance:REPLACE_FINANCE_SECRET' \
     --operator 'clerk-1:centre_operator:REPLACE_CLERK_SECRET'
   ```

   The arguments and exit codes are the centre runbook's
   ([step 4](../centre/README.md)); it is the same command.

6. **Start it.**

   ```bash
   docker compose up -d --build                 # managed Postgres elsewhere
   docker compose --profile db up -d --build    # Postgres on this VM too
   docker compose ps                            # api must reach (healthy)
   ```

## Verify

Run all four. The first three take seconds; the fourth is the loop itself.

```bash
# 1. The deployment answers, and the answer means the API is up. /healthz asks
#    the API for /whoami with no credentials and reads 401 as ready, which is
#    what deploy/http-server.mjs does on Railway.
curl -sS https://console.example.vn/healthz          # {"ready":true}

# 2. The browser policy, on a static response and on a proxied one. Both must
#    carry the CSP, nosniff, DENY, the referrer policy and exactly ONE
#    Strict-Transport-Security line.
curl -I https://console.example.vn/
curl -I https://console.example.vn/whoami            # 401 is correct here

# 3. GreenNode, from this VM, with this deployment's own keys and its own
#    client: one small object up, then read back and hashed. It proves the
#    endpoint, the bucket, the credentials and the read-back that QR-02's
#    cloud gate depends on. Delete the probe key afterwards.
docker compose exec api node --input-type=module -e "
import { s3StoreFromEnv } from './packages/api/src/upload-worker.ts';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const store = s3StoreFromEnv();
if (!store) throw new Error('STORAGE_* is not configured in cloud.env');
const bytes = Buffer.from('playerone-cloud-probe\n');
const sha = createHash('sha256').update(bytes).digest('hex');
await writeFile('/tmp/probe', bytes);
const key = 'diagnostics/probe-' + Date.now();
console.log('put:', JSON.stringify(await store.put(key, '/tmp/probe', sha)));
const hash = createHash('sha256');
for await (const chunk of await store.read(key)) hash.update(chunk);
console.log('read-back matches:', hash.digest('hex') === sha);
"

# 4. The whole money path, in this image, on a THROWAWAY database. The script
#    truncates every table first, so never point it at the deployment's
#    database. It truncates as the schema owner, which playerone_app cannot do
#    and must not be able to do (migration 0021), hence the two overrides.
docker compose exec postgres createdb -U postgres playerone_e2e   # or on the managed server
docker compose run --rm \
  -e DATABASE_URL='postgres://postgres:OWNER_PASSWORD@postgres:5432/playerone_e2e' \
  api node_modules/.bin/drizzle-kit migrate --config packages/store/drizzle.config.ts
docker compose run --rm \
  -e DATABASE_URL='postgres://postgres:OWNER_PASSWORD@postgres:5432/playerone_e2e' \
  -e PLAYERONE_ALLOW_SUPERUSER=1 \
  api node packages/api/scripts/e2e-loop.mjs      # ends with: all checks passed
```

The loop makes its own footage with the ffmpeg now in the image. With the five
real sessions mounted and `PLAYERONE_SESSIONS` pointing at them it walks one of
them too, which is the only version of this check that says anything about
PaXini's encoder. Drop `playerone_e2e` when it passes.

Then sign in through the console as the administrator from step 5, and reload a
nested route such as `/episodes` to confirm the SPA fallback.

## Operating it

- **Restarting Caddy means restarting the API.** The API deliberately shares
  Caddy's network namespace (`network_mode: "service:caddy"`), which is how it
  keeps `HOST=127.0.0.1` while still being reachable by the proxy — and
  therefore how the forwarded client address stays trustworthy (see the "address
  is the socket" section of `packages/api/src/ratelimit.ts`). The cost is that
  `docker compose restart caddy` leaves the API with no network and every
  request answering 502. Measured on this kit. Restart both, in order:
  `docker compose restart caddy api`.
- **A console rebuild needs the volume dropped.** The `console` volume is seeded
  from the image the first time it is used and never again. After a console
  change: `docker compose down && docker volume rm playerone_console && docker
  compose up -d --build`.
- **Certificates live in the `caddy_data` volume.** Losing it means a fresh
  issuance on every start, which is how a deployment meets Let's Encrypt's rate
  limit and then has no TLS at all. Back it up with the database.
- **Backups.** `PLAYERONE_BACKUP_DIR` is a volume on this VM, which is not
  off-site. `pg_dump` into it on a schedule and copy it somewhere else in
  Vietnam. SEC-06 disk encryption is operations work and Alois owns it
  ([ADR 0004](../../docs/adr/0004-sec06-is-disk-encryption-at-the-upload-centre.md)).
- **Logs** are the containers': `docker compose logs -f api`. Sign-in codes
  appear there while ZNS is unconfigured, which is one more reason this VM is
  not a collector deployment yet.
- **The alert and risk workers are not in this compose.** One VM, three
  services, on purpose; `docs/RUNNING.md` has both workers and their
  environment when this deployment wants them.
- **The image carries ffmpeg**, pinned to bookworm's 5.1 series. It costs
  472 MB uncompressed (`docker history`) — a runtime image of 269.7 MB → 444.3 MB
  as `docker image inspect --format '{{.Size}}'` measures it. A static ffmpeg
  build would be smaller and would not be the distro's package; the distro's is
  what gets security updates without us noticing.

## What only the VM can prove

Everything above was run locally against Docker except these, which need the
real host: certificate issuance and the HTTP→HTTPS redirect for a real name
(locally Caddy was given `http://localhost`, which skips ACME); the GreenNode
round-trip, which needs the real endpoint and keys; a reviewer in China reaching
the origin at all; and disk sizing under real footage. `deploy/cloud/check.test.ts`
proves only that these files still agree with each other.
