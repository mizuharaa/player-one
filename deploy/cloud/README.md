# Cloud VM kit

Run on Ubuntu 22.04/24.04 in Vietnam. This is the staff-assisted demo: cloud
verification, metadata-only reviewers, manual payout, and sandbox gateways.
ZNS and ZaloPay account verification still need real credentials. No successful
simulation is a real transfer. Keep media, database and backups in Vietnam.

## Provision and start

See [the owner command sequence](../../docs/cloud-go-live.md). Clone the reviewed
revision before provisioning. Point DNS at the VM first. Run `provision.sh` as
root from that checkout; it copies the source to `/srv/playerone` and installs
Docker from its [signed Ubuntu repository](https://docs.docker.com/engine/install/ubuntu/).
It adds TCP 80/443 to ufw and preserves existing management rules. Docker publishes
only those web ports; neither Postgres nor the API has a published port.

Required flags: `--domain`, `--acme-email`, `--storage-endpoint`,
`--storage-bucket`, `--storage-key`, `--storage-secret`, `--quota-bytes`, and
exactly one of `--local-db` or `--database-url`. The latter is an OWNER URL for
an existing `po_demo*` or `playerone_demo*` database, with permission to migrate,
administer roles, checkpoint, and create the isolated verification/restore databases. Use
`sslmode=require` for managed Postgres. The script derives the restricted
`playerone_app` URL and generates its password. Use a dedicated demo cluster:
`playerone_app` is a cluster-wide role. Never point this kit at production.
Quota must be at least 1,250,000,000 bytes, matching the API's validation.

Generated credentials live in `deploy/cloud/cloud.env` (mode 600); printed only
on creation. A second provision is refused. `--force` refreshes source while
retaining that file and all secrets; it does not rotate logins or erase data.
Do not source cloud.env as shell code. Compose parses it, including literal `$`.

`bash up.sh` builds runtime and migrate images, waits for the optional local DB,
migrates as owner, enables the app login, bootstraps, seeds the stakeholder demo,
refreshes console assets, starts the API, backs up and runs preflight. Run again
to upgrade. `bash up.sh --pull` pulls `PLAYERONE_IMAGE` and
`PLAYERONE_MIGRATE_IMAGE` from cloud.env instead (both must be the same revision).
A failed seed writes a protected temporary diagnostic whose path is printed;
it can contain credentials. Do not paste it into a public report.

## Verify

`bash verify.sh` writes `deploy/cloud/verify-<timestamp>.txt`. It checks the
running image ID and source SHA, HTTP redirect, certificate trust/hostname and
expiry, headers, health, machine/operator and reviewer authentication, nested
SPA reload, real S3 PUT/body SHA-256/read-back/delete, and bucket CORS.
The e2e money loop is explicitly SIMULATION, in a new `po_e2e_cloud_*` database
with a filesystem bucket and fake rail. It checkpoints and drops only that DB;
it compares demo table counts before and after. A failed cleanup is a failure.

Optional real card proof (source mount is read-only; supply actual declarations):

```bash
bash verify.sh --session /absolute/ego_SERIAL_DATE_TIME --card CARD_ID \
  --collector COLLECTOR_REF --others-in-frame yes --sensitive no \
  --task TASK_NAME --scenario home --device CAMERA_SERIAL
```

No supplied path means SKIPPED. A reachable reviewer token on the host is not
proof of a remote reviewer's network: repeat sign-in from that location.
Name and independently confirm the VN VM, DB and bucket before go-live.
Per-bucket CORS replaces the whole rule set: use a bucket dedicated to this
origin. For multiple approved origins, run `bucket-cors.mjs` with all of them.

## Backup and restore

`bash backup.sh` writes dated custom-format dumps and public-table row counts to
`/srv/playerone/backups`, with a copy in the API backup volume for preflight.
It refuses a mismatched manifest if table counts change during the dump; retry
while the demo is idle. Schedule it and copy backups to separate storage in
Vietnam. Local copies do not protect against losing the VM.

```bash
bash restore.sh /srv/playerone/backups/po_demo_cloud-TIMESTAMP.dump po_restore_rehearsal
```

Restore creates a NEW database, never overwrites one, and prints expected/actual
counts for every public table. The target remains for inspection. A retry after
failure needs another fresh name. The demo URL is never changed automatically.

## Certificate re-issue rehearsal (real domain only)

Use the VM console during recovery. Preserve the ACME account and other domains.
Replace the domain below with the exact DNS hostname, without scheme or path.
Back up first, stop both services, remove only that domain's certificate entries,
then recreate Caddy and API together because they share a network namespace.

```bash
cd /srv/playerone/deploy/cloud
DOMAIN=console.example.vn
[[ $DOMAIN =~ ^[a-z0-9]+([.-][a-z0-9]+)*$ ]] || exit 1
docker compose --env-file cloud.env run --rm --no-deps -T --entrypoint sh caddy \
  -c 'tar czf - -C /data caddy' > ../../backups/caddy-before-reissue.tgz
docker compose --env-file cloud.env stop api caddy
docker compose --env-file cloud.env run --rm --no-deps -T --entrypoint sh -e DOMAIN="$DOMAIN" caddy \
  -c 'for entry in /data/caddy/certificates/*/"$DOMAIN"; do [ ! -d "$entry" ] || rm -r -- "$entry"; done'
docker compose --env-file cloud.env up -d --force-recreate caddy api
docker compose --env-file cloud.env logs --since 5m -f caddy
# After issuance appears, Ctrl-C the log follower, then:
bash verify.sh
```

Do not delete the caddy_data volume. Repeated issuance is rate limited; rehearse
once after DNS works. Keep the archive private (it contains certificate keys).

## Docker Desktop proof

Do not run provision.sh on Windows. Use Git Bash with `COMPOSE_PROJECT_NAME`
set to an isolated project. Generate cloud.env with `node configure.mjs` and the
same flags, plus `--domain localhost --http-local`; use a local MinIO bucket
(`quay.io/minio/minio`) and its endpoint. Then run up.sh, verify.sh and restore.sh.
HTTP certificate and redirect checks are SKIPPED. MinIO does not implement the
per-bucket CORS API (exit 3); that check is SKIPPED only for `http://localhost`.
GreenNode CORS, DNS/ACME, real residency and remote reviewer reachability remain
open until tested on the real host. No local PASS closes those gates.
