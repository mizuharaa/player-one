# Cloud go-live

Local Docker proof passed. No VM was provisioned, no deployment is live, and nothing was pushed.
Supply a Vietnam Ubuntu 22.04/24.04 VM, DNS pointing at it, ACME email, four GreenNode storage values, and the actual quota (at least 1,250,000,000 bytes).
On this checkout, make `git bundle create cloud-provision.bundle lane/cloud-provision`; transfer it to `/root/cloud-provision.bundle` on the VM.

Run from the VM's root console (provisioning enables ufw and adds only TCP 80/443):

```bash
sudo -i
set -e
umask 077
apt-get update && apt-get install -y git
git clone --branch lane/cloud-provision /root/cloud-provision.bundle /root/playerone-src
cd /root/playerone-src
read -rp 'DNS hostname: ' DOMAIN
read -rp 'ACME email: ' ACME_EMAIL
read -rp 'GreenNode HTTPS endpoint: ' STORAGE_ENDPOINT
read -rp 'Bucket: ' STORAGE_BUCKET
read -rp 'Storage key: ' STORAGE_KEY
read -rsp 'Storage secret: ' STORAGE_SECRET
printf '\n'
read -rp 'Allocated bytes: ' QUOTA_BYTES
bash deploy/cloud/provision.sh --domain "$DOMAIN" --acme-email "$ACME_EMAIL" \
  --local-db --storage-endpoint "$STORAGE_ENDPOINT" --storage-bucket "$STORAGE_BUCKET" \
  --storage-key "$STORAGE_KEY" --storage-secret "$STORAGE_SECRET" --quota-bytes "$QUOTA_BYTES"
cd /srv/playerone/deploy/cloud
bash up.sh
bash verify.sh
bash restore.sh "$(ls -t /srv/playerone/backups/*.dump | head -n 1)" po_restore_rehearsal
```

## From the laptop with one IP

Once the owner hands over only the VM's public IP, the manual recipe above can
run as one command from this checkout instead of at the VM's console:

```bash
bash deploy/cloud/go-live.sh 14.225.1.2
```

That derives `--domain` as `api.14-225-1-2.sslip.io` (dots to dashes; override
with `--domain`) — **sslip.io needs no DNS record**, it resolves any
`<anything>.<ip-with-dashes>.sslip.io` back to that IP, and Caddy's ACME
(HTTP-01) works against it exactly as it would against a real hostname. It then:
reads the three GreenNode storage values (endpoint, key, secret) from `.env.local` on this machine or
`~/.playerone/greennode.env`, and creates `--bucket` (default
`playerone-demo-<yyyymmdd>`) if it does not already exist, using the same S3
client call as `deploy/emu/ensure-bucket.mjs`; bundles this checkout
(`git bundle`, the same mechanism as the manual recipe) and copies it to the
VM with `scp -P 234` (GreenNode's default SSH port; `--ssh-port` overrides);
runs `provision.sh` over `ssh -p 234` with `--local-db` and those storage
values, then `up.sh`, then `verify.sh`, streaming each one's output and
stopping at the first failure, naming the step. It never prints
`STORAGE_KEY`/`STORAGE_SECRET`, masking them with `***` wherever a command
would otherwise show them. `--dry-run` (or `--plan`) prints every command it
would run, masked the same way, without touching the VM or the bucket.

For managed Postgres, replace `--local-db` with `--database-url 'postgres://OWNER:PASSWORD@HOST/po_demo_cloud?sslmode=require'`; pre-create that demo database and grant the owner migration, role, database-creation and checkpoint privileges.
Generated secrets print once and remain in `/srv/playerone/deploy/cloud/cloud.env` (600). Staff: `op-1`, `fin-1`, `rev-1`; corresponding `PLAYERONE_DEMO_*_SECRET` values are in that file.
A provision rerun needs `--force`, which preserves credentials. `up.sh --pull` uses the configured runtime/migration image pair. Never run e2e directly on the demo DB.

Measured locally: [full PASS/SKIPPED output and restore counts](cloud-docker-proof.md).

```text
PASS up.sh: build, owner migration, app bootstrap/seed, health, backup, preflight
PASS verify.sh: image revision/ID, headers, health, machine/operator and reviewer access, nested SPA
PASS bucket PUT, application-level SHA-256 read-back, probe deletion
PASS SIMULATION e2e: separate throwaway DB, cleanup, demo row counts unchanged
PASS restore: all 49 public-table counts match the backup
PASS root typecheck; 47 deployment Vitest tests; 20 Node deployment tests
SKIPPED local HTTP: certificate and HTTPS redirect
SKIPPED MinIO: GreenNode per-bucket CORS API
SKIPPED real Ego intake: no path supplied; verify.sh accepts --session plus explicit card declarations
SKIPPED Vietnam residency and remote reviewer network: owner verification required
```

Before go-live, rerun verification on the real domain, name the VN VM/DB/bucket, ingest the real card, and sign in from the reviewer location. Follow the [scoped certificate re-issue rehearsal](../deploy/cloud/README.md#certificate-re-issue-rehearsal-real-domain-only); preserve the ACME account and other domains.
Provisioning uses [Docker's signed Ubuntu repository](https://docs.docker.com/engine/install/ubuntu/). Local tests do not prove DNS/ACME, GreenNode CORS, residency, remote connectivity, ZNS delivery or a real payment.
