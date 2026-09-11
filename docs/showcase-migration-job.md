# Reviewed Railway migration job (0026 + 0027)

Preparation is local and performs no deployment:

```powershell
node deploy/prepare-showcase-migration.mjs
```

The printed ignored folder contains only Dockerfile, Railway configuration,
`apply.sql`, verbatim `0026_showcase_footage.sql` and `0027_showcase_review_grants.sql`, and a hash manifest.
It contains no credentials, application data, recordings or web application.
The wrapper locks the Drizzle migration journal inside one transaction, requires
the exact 0025 timestamp/hash and absence of the new table, applies 0026 and corrective 0027 atomically,
and records its exact source hash and timestamp. A retry verifies the already
applied 0026 and 0027 hashes/table and exits successfully. Any different schema state aborts
without changes. Lock and statement timeouts are bounded.

The live database service image was inspected read-only through
`railway environment config`: `ghcr.io/railwayapp-templates/postgres-ssl:18`.
The job uses the matching PostgreSQL 18 client from `postgres:18-bookworm`.
Its entrypoint is `psql`, so it does not initialize or serve another database.

## Actual available transport

The authenticated CLI is `npx --yes @railway/cli`. `railway run` executes locally
and cannot reach a private Railway hostname without an additional transport.
The installed local Docker client currently has no running daemon. Railway SSH
currently refuses because no local SSH keys exist. The prepared one-off service
therefore uses Railway's own remote Docker build and private network. It needs
no public database proxy, public HTTP domain, SSH key or local Docker daemon.

## Execution after independent review and release authorization

Use the IDs already verified for this deployment:

```powershell
$project = '5be6dfb6-0437-4a3d-ad33-b25b1a7f9eb6'
$environment = '040798be-43c1-40ef-95f4-a3f423bdd18a'
# Set this to the new preparation result, then enter that folder.
$jobFolder = '<absolute prepared job folder>'
Set-Location -LiteralPath $jobFolder
npx --yes @railway/cli link --project $project --environment $environment --json
npx --yes @railway/cli add --service playerone-showcase-migration-0026-0027 --json
# Copy ONLY the newly returned temporary service id, never the web/Postgres id.
$job = '<new temporary job service id>'
npx --yes @railway/cli variable set --project $project --environment $environment --service $job --skip-deploys 'PGHOST=${{Postgres.PGHOST}}' 'PGPORT=${{Postgres.PGPORT}}' 'PGDATABASE=${{Postgres.PGDATABASE}}' 'PGUSER=${{Postgres.PGUSER}}' 'PGPASSWORD=${{Postgres.PGPASSWORD}}' 'PGSSLMODE=require' 'PGCONNECT_TIMEOUT=15'
npx --yes @railway/cli up $jobFolder --path-as-root --project $project --environment $environment --service $job --detach --json
```

Those variables are private Railway references, not copied secret values. The
source service name is **Postgres**, ID `6dd60f05-485b-41d2-8095-a1d4aaca4d3b`.
The job receives owner access only for its lifetime. The existing web service
continues to use `playerone_app`; never change its DATABASE_URL for migration.
Do not assign a public domain or volume to the job.

Inspect the job deployment logs and process exit: an upload/build result alone
is not a migration result. Require `Showcase migration applied.` (or the verified
already-applied message), `COMMIT`, and `runtime_policy_verified=t` and `SHOWCASE_MIGRATION_EXIT=0`, with no SQL errors.
Then deploy the independently reviewed web snapshot and verify authenticated
showcase access. Remove only the temporary job service using its exact returned
ID and explicit selectors after retaining the sanitized result. The web service
is `a7913574-d4bb-46b7-a840-48b2ee0fccda`; neither it nor Postgres is a cleanup target.

## Local validation performed

The generated job SQL ran through the installed PostgreSQL 18 `psql` against a
new isolated local database migrated through 0025. First run applied 0026 and 0027 and
verified runtime grants; second run verified the recorded hash and performed no
duplicate insert. Both exited zero. No cloud service, variables, domain or
remote database were changed during preparation or validation.

The wrapper individually checks SELECT, INSERT and DELETE, denies table-wide UPDATE,
allows UPDATE only for verdict/note/reviewed_at and denies it for every other
column, before COMMIT. 0027 explicitly revokes the table UPDATE inherited from
existing default privileges; the previously applied 0026 is immutable.

The automated runner validates all artifact hashes and refuses unknown files:
```powershell
node deploy/run-showcase-migration.mjs --folder <prepared-folder>
# Only after release authorization:
node deploy/run-showcase-migration.mjs --folder <prepared-folder> --execute
```
It sets private reference values through stdin, checks terminal success and removes
only the exact service it created. A failure retains that service for inspection.

