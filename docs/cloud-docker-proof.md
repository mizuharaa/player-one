# Docker Desktop proof - 2026-09-14

Worktree: `lane/cloud-provision`. Runtime source revision: `92d5d85473163d311b18a0271dbb386356292fe0`.
Image ID: `sha256:27ba6cdfa965e8907eaa1bff8de8e6876214ad9399f995911cda13cce0962524`.

Unchanged `up.sh`, `verify.sh`, `backup.sh` and `restore.sh` ran under Git Bash
on Docker Desktop. Project `playerone-cloud-proof`, Compose Postgres 16,
`http://localhost`, and `quay.io/minio/minio` at `http://minio:9000`, bucket
`cloud-proof`. MinIO is an isolated container on this project's network;
existing `playerone-pg` and `playerone-minio` services were not changed.
`configure.mjs --http-local --local-db` generated the test environment;
`provision.sh` was NOT executed (Ubuntu VM only). Quota: 2,000,000,000 bytes.
No real card path was supplied. No live payment or collector OTP delivery is claimed.

## Startup

Final full `bash deploy/cloud/up.sh` run, including an idempotent reseed.
PASS/SKIPPED lines below are extracted from its output; Compose/build progress is omitted.

```text
PASS configuration
PASS images
PASS postgres
PASS caddy
PASS database-ready
PASS migrate
PASS grant
PASS bootstrap
PASS seed-stakeholder.mjs
PASS console-assets
PASS api
PASS healthz
PASS backup /c/Users/Khang/pw/cloud-provision/backups/po_demo_cloud-20260914T214625Z-17599.dump
PASS row counts manifest po_demo_cloud-20260914T214625Z-17599.dump.counts.json
PASS backup
PASS demo-database: DATABASE_URL names the demo database 'po_demo_cloud'.
PASS seed-collector: the demo collector is seeded, trained and exam-passed.
PASS seed-tasks: 4 published tasks.
PASS seed-session: 1 declared collection session(s).
PASS seed-staff: administrator, finance and reviewer sign-ins all exist.
PASS seed-payout: payout destination declared, verify_status='unverified' - the honest ending is awaiting payment, destination unverified.
PASS healthz: http://localhost/healthz answers ready.
SKIPPED certificate: the origin is plain HTTP (http://localhost), so there is no certificate to expire. Correct for the centre-PC LAN variant only.
PASS storage: bucket 'cloud-proof' answers a HEAD at http://minio:9000.
PASS backup: newest dump po_demo_cloud-20260914T214625Z-17599.dump, 0 hour(s) old.
PASS demo-preflight
PASS console: http://localhost
PASS credentials: /c/Users/Khang/pw/cloud-provision/deploy/cloud/cloud.env (op-1 administrator, fin-1 finance, rev-1 reviewer)
```

## Verification

Final `bash deploy/cloud/verify.sh` output, progress/fixture detail omitted.
The e2e loop explicitly labels its entire output SIMULATION, uses a filesystem
bucket and fake rail, and only opens its independently generated test database.
Its database was checkpointed and dropped; all demo table counts stayed equal.

```text
Cloud verification 2026-09-14T21:48:10Z
Origin: http://localhost
PASS Source SHA (running image): 92d5d85473163d311b18a0271dbb386356292fe0
sha256:27ba6cdfa965e8907eaa1bff8de8e6876214ad9399f995911cda13cce0962524
PASS image-id
SKIPPED VN VM/DB/bucket residency: owner must name and verify their Vietnam locations; DB=po_demo_cloud, bucket=cloud-proof
SKIPPED HTTPS redirect: non-TLS local origin; real DNS and ACME required
SKIPPED certificate: non-TLS local origin; real DNS and ACME required
PASS headers: verified
PASS /healthz: verified
PASS authenticated console machine + operator tokens: verified
PASS reviewer role reaches origin: reviewer token accepted from this host; remote reviewer network still needs an owner check
PASS nested GET /episodes SPA: verified
PASS web
PASS bucket PUT + read-back SHA-256 58878f605b1c6e418eef2a739a1ae15284c9ff2a794f2a470203512da3f2311e
PASS probe cleanup cloud-probe/643dd4ba-8090-4aef-b8c9-86458cf613ab
PASS bucket
SKIPPED bucket-cors.mjs: local MinIO has no per-bucket CORS API; GreenNode must pass this check
SIMULATION e2e database po_e2e_cloud_1789422499595_92d083c484b3; demo /po_demo_cloud is excluded
SIMULATION all checks passed
PASS isolated database cleanup po_e2e_cloud_1789422499595_92d083c484b3
PASS SIMULATION e2e-loop.mjs isolated database
PASS demo row counts unchanged by e2e
SKIPPED real Ego session: pass --session /absolute/ego_* plus card-intake.mjs declarations
SKIPPED remote reviewer network: repeat the console sign-in from the reviewer location
Report: deploy/cloud/verify-20260914T214810Z-17840.txt
PASS available checks (SKIPPED items are not go-live evidence)
```

## Restore rehearsal

`bash deploy/cloud/restore.sh C:/Users/Khang/pw/cloud-provision/backups/po_demo_cloud-20260914T214117Z-16500.dump po_restore_cloud_rehearsal`

The restored database remains available for inspection; the live demo URL was
not switched. Counts compare against the backup manifest, not later demo writes.

```text
PASS create-restore
PASS pg_restore
PASS row counts audit_events: backup=4 restored=4
PASS row counts bill_lines: backup=2 restored=2
PASS row counts bills: backup=1 restored=1
PASS row counts cloud_verifications: backup=0 restored=0
PASS row counts collection_points: backup=0 restored=0
PASS row counts collection_session_devices: backup=1 restored=1
PASS row counts collection_sessions: backup=1 restored=1
PASS row counts collector_agreements: backup=6 restored=6
PASS row counts collector_uploads: backup=0 restored=0
PASS row counts collectors: backup=1 restored=1
PASS row counts commitment_events: backup=0 restored=0
PASS row counts defect_codes: backup=33 restored=33
PASS row counts device_assignments: backup=0 restored=0
PASS row counts device_types: backup=1 restored=1
PASS row counts devices: backup=1 restored=1
PASS row counts episode_clearings: backup=0 restored=0
PASS row counts episode_defects: backup=0 restored=0
PASS row counts episode_files: backup=10 restored=10
PASS row counts episode_ingests: backup=5 restored=5
PASS row counts episode_parks: backup=0 restored=0
PASS row counts episode_review_reasons: backup=1 restored=1
PASS row counts episode_review_spans: backup=0 restored=0
PASS row counts episode_reviews: backup=4 restored=4
PASS row counts episode_streams: backup=0 restored=0
PASS row counts episodes: backup=5 restored=5
PASS row counts handovers: backup=1 restored=1
PASS row counts operators: backup=3 restored=3
PASS row counts payout_accounts: backup=1 restored=1
PASS row counts payout_attempts: backup=0 restored=0
PASS row counts payout_events: backup=0 restored=0
PASS row counts payout_export_rows: backup=0 restored=0
PASS row counts payout_exports: backup=0 restored=0
PASS row counts recon_lines: backup=0 restored=0
PASS row counts recon_runs: backup=0 restored=0
PASS row counts review_disputes: backup=0 restored=0
PASS row counts review_reason_codes: backup=13 restored=13
PASS row counts risk_flags: backup=0 restored=0
PASS row counts risk_holds: backup=0 restored=0
PASS row counts risk_signals: backup=41 restored=41
PASS row counts scenarios: backup=1 restored=1
PASS row counts settlements: backup=4 restored=4
PASS row counts showcase_footage: backup=0 restored=0
PASS row counts task_claims: backup=1 restored=1
PASS row counts task_commitments: backup=0 restored=0
PASS row counts tasks: backup=4 restored=4
PASS row counts upload_batches: backup=1 restored=1
PASS row counts upload_centres: backup=1 restored=1
PASS row counts upload_device_status: backup=1 restored=1
PASS row counts upload_devices: backup=1 restored=1
PASS restore po_restore_cloud_rehearsal; preserved for inspection, demo URL unchanged
```

## Gates and additional checks

```text
PASS pnpm typecheck
PASS pnpm exec vitest run deploy/ - 47 tests
PASS node --test deploy/*.test.mjs - 20 tests
PASS generated dotenv preserves literal dollar, apostrophe and backslash in a real Compose container
```

The existing independent browser-policy test needs console assets; ran
`pnpm -F @playerone/console build` before the Node gate. No emulator was launched.

Failures found and fixed during the proof: missing Expo patch in Docker build
inputs; inactive Compose tool profile omitted from config; Windows newline in
configuration lookup; explicit local DB transport; root-owned console volume;
API minimum quota; preflight dependencies resolved from the API workspace;
reviewer authentication through the cookie session route.

Local HTTP cannot prove redirect or certificates. MinIO's 501 per-bucket CORS
response is a SKIPPED result, not a GreenNode success. The owner must still
supply the real VM/domain/keys, verify VN residency and remote reviewer access,
run real card intake, and rehearse scoped certificate re-issue. No cloud host
has been provisioned or released. No push was performed.

The local proof stack and restored database remain available for inspection at
`http://localhost`. Local logs are in `scratchpad/cloud-provision-proof/`;
credentials and backups are ignored by Git. The three isolated e2e databases
were removed; only `po_demo_cloud` and `po_restore_cloud_rehearsal` remain
besides the standard Postgres databases in this project.
