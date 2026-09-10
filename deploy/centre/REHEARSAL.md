# Demo rehearsal and recovery

These are operator instructions, not commands already run by an agent.
Use the actual named deployment. Do not point seed/test scripts at its data,
do not clear a source card, and do not enable the payout gateway for this demo.

## Before installation

Record the release commit, built console artifact, APK SHA-256, selected origin,
Windows account and encrypted backup destination in the deployment handoff.
Keep credentials separately in protected `centre.env`; never paste it into
screenshots, logs, tickets or this repository. Pick the same origin for the APK.
An HTTP LAN demo needs a deliberately configured Android demo build; it does
not justify allowing cleartext to arbitrary hosts in the production build.

Run the README preflight and Caddy validation. A passing preflight says only
that configuration, local paths and required commands are available. It does
not create the database role, populate catalogue rows, verify storage bytes,
deliver a sign-in code or prove that a phone can reach the host.

Preserve these settings in both modes:

- `REVIEW_VERIFICATION_GATE=cloud`.
- `HOST=127.0.0.1`, behind Caddy.
- `PLAYERONE_REVIEWER_MEDIA=0` until the separate legal decision.
- `PLAYERONE_PAYOUT_MODE=manual`; demonstrate a bill/awaiting payment, not a transfer.

HTTP demo: one deliberately selected demo account may use
`PLAYERONE_DEMO_PHONE`. Prepare it only against the named disposable demo
database using the existing seed-demo procedure. HTTPS production: remove that
variable from the file AND account environment, configure production ZNS, and
prove delivery to a real handset. Never use seed-console on retained data; it
truncates tables.

## Startup and health

Start the existing API, alerts and Caddy wrappers or registered tasks using the
README. The tasks trigger on logon, not merely power-on. They do not prove
reboot survival until a real reboot/sign-in has been rehearsed. Inspect the
three task results and their dated logs if any process stops.

```powershell
node deploy/centre/check.mjs health deploy/centre/centre.env
if ($LASTEXITCODE -ne 0) { throw 'The configured origin is not ready' }
```

The command GETs console HTML, its entry script and `/whoami` through Caddy.
It rejects a missing bundle served as SPA HTML, an API route swallowed by the
SPA, and an API error. Without tokens, expected JSON 401 proves routing and
the auth handler only; the output explicitly says the database is unproven.

For the authenticated check, sign in normally and put the existing short-lived
machine and operator tokens into `PLAYERONE_HEALTH_MACHINE_TOKEN` and
`PLAYERONE_HEALTH_OPERATOR_TOKEN` in this interactive shell. Do not save them
in `centre.env` or put them on the command line. Repeat the health command:
it must accept both through `/whoami`, which reads the machine/operator rows.
It does not sign in or write a session. Remove these temporary environment
variables afterward. Even this check is not a test of every database grant.

On the real handset, with mobile data disabled, verify sign-in, task selection,
an app restart and task recovery. Rehearse card -> local import -> cloud
upload -> byte verification -> human review -> bill -> collector earnings.
Record the episode and batch IDs, then disconnect/reconnect the upload link
and retry that same batch. Cloud verification must complete before review;
a failure must remain visible. Confirm no second delivery/payment is created.
Do not pretend camera-to-phone offload exists.

### Retry an imported batch without importing the card again

The import command prints `batch_id: ... (created; ...)` to stderr as soon as
the batch exists, before ingest/upload, and keeps its final JSON on stdout.
Retain both streams. Once episode submission succeeded, resume the same batch:

```powershell
node packages/api/bin/counter.ts upload --batch '<batch UUID>' --api http://127.0.0.1:8080
if ($LASTEXITCODE -ne 0) { throw 'Upload unverified; inspect the retained response before retrying' }
```

Run this on the centre host with its existing `PLAYERONE_MACHINE_IDENTIFIER`,
`PLAYERONE_MACHINE_SECRET`, `PLAYERONE_OPERATOR_REF` and
`PLAYERONE_OPERATOR_SECRET` environment values. The API still needs the local
media copy. Use the direct loopback API address for counter routes; Caddy does
not expose `/upload-batches`. No credentials go into command arguments.

This command only uploads an existing batch; it does not recreate handovers,
sessions or ingest records. After authentication it makes one upload request and exits successfully only
for `cloud_verified: true`. Keep the raw response on stderr, including episode
errors or an API problem reference. HTTP 200 alone is not successful verification.
The worker resumes missing multipart parts and preserves verified receipts;
there is no automatic `reverify` or local cleanup. Never clear the source card.

If the process was killed before the receipt was captured, the existing
machine-authenticated `GET /upload-batches?since=<ISO timestamp>&limit=100`
lists recent batches. For example, with the short-lived tokens already obtained
for the authenticated health check (do not put them in command arguments):

```powershell
$headers = @{ Authorization = "Bearer $env:PLAYERONE_HEALTH_OPERATOR_TOKEN"; 'x-machine-token' = "Bearer $env:PLAYERONE_HEALTH_MACHINE_TOKEN" }
$since = [uri]::EscapeDataString((Get-Date).AddDays(-1).ToUniversalTime().ToString('o'))
Invoke-RestMethod -Headers $headers -Uri "http://127.0.0.1:8080/upload-batches?since=$since&limit=100"
```

Check the batch's handover and import time before choosing it. The list's
resolved/quarantined counts describe attribution, not successful cloud upload.
An interrupted handover/session/episode-submission stage needs inspection of
those saved IDs; `upload` does not complete an unfinished import. Rerunning
`import` creates new handover/session/batch IDs and is not the resume command.

## Archive tagging failures and bounded retry

`archive_tag_failures` counts **recorded failed tagging operations during the
preceding 24 hours**, and fires at one operation. An operation may fail on many
objects or before receipts can be read. It is not an unresolved-object count.
A successful retry does not erase its history; zero does not prove every
object is archived. Inspect `bill.archive_tag_failed` audit events for the
bill ID, actor, operation (`billing` or `retry`), attempted and confirmed tag
calls, failed object keys and `query_failed`.

An authorized support engineer can inspect these historical events with the
following bounded read-only query using the deployment's protected database
connection. This is not a request to give counter operators database access.
Include successful retries when reading the history; do not treat the last
failure as an unresolved-object register.

```sql
SELECT id, occurred_at, target_id AS bill_id, operator_id, action, "after"
FROM audit_events
WHERE target_table = 'bills'
  AND action IN ('bill.archive_tag_failed', 'bill.archive_tag_retry')
  AND occurred_at >= now() - interval '24 hours'
ORDER BY occurred_at DESC, id DESC
LIMIT 100;
```

An administrator with the existing machine and operator credentials may call
`POST /api/settle/bills/<bill UUID>/archive/retry`. This is an explicit storage
write; run it only on the intended deployment after checking its bill ID.
Do not generate the billing cycle again to retry tags: bill replay does not
retag existing bills.

Using the existing administrator and machine credentials in the environment:

```powershell
node packages/api/bin/counter.ts archive-retry --bill '<bill UUID>' --api http://127.0.0.1:8080
if ($LASTEXITCODE -ne 0) { throw 'Archive page has unconfirmed results; inspect the retained response' }
```

The command performs one page only. Its JSON says `page_status: more_pages`
when another explicit call is needed. Pass the returned `next_after` unchanged
as `--after '<next_after>'`; the command URL-encodes it once. `page_complete`
means the requested page completed, not that earlier failed pages were fixed
or that the provider has actually changed the storage tier. Failed keys,
query/audit failures, malformed replies and HTTP errors return a nonzero exit.
The raw response remains on stderr, including partial results from a 503.

Each call processes at most five distinct keys in order. If `next_after` is
non-null, URL-encode that value and pass it as the `after` query parameter on
the next call. A failed key is still passed by the cursor; finish the pages,
then start again without `after` to retry earlier failures. Previously
acknowledged keys are tagged again. There is no background retry worker or
durable record of each object's archive state.

Read `attempted`, `confirmed`, `failed_object_keys`, `query_failed` and
`audit_recorded` before continuing. `confirmed` means the tag call returned
success, not proof of the provider's actual storage tier. A 503 with
`audit_recorded: false` means tag calls may have completed but their audit
could not be saved; retain the response and inspect the service logs. A
receipt-query failure tags nothing on that page. A storage-unavailable 503
requires restoring configuration before retrying. Successful retries record
`bill.archive_tag_retry`; a failed retry records one `bill.archive_tag_failed`.

Selection uses the exact episode and ingest from the billed review, only
where a cloud receipt still exists. Exception/superseded settlements and open
disputes are excluded. Eligibility is checked when selecting keys; a later
verification failure cannot be made atomic with a remote tag call. Bills and
payment records remain unchanged even when tags or their audit fail.

## Backup and restore rehearsal

The deployment owner must provide a protected, encrypted destination with
enough free space. A database dump alone does not contain video: retain the
source cards and a separate copy of the media/cache or verified cloud objects.
Archive the release artifacts and protected configuration separately as well.

Configure libpq services `playerone_backup` and `playerone_restore` in a
protected service file, with passwords in the protected PostgreSQL password
file. `playerone_backup` selects the explicitly approved source database;
`playerone_restore` selects an **isolated rehearsal PostgreSQL instance**.
Never use a production service for restore. Service files and passwords are
machine configuration, not repository assets. Use compatible PostgreSQL tools;
`pg_dump` must not be older than the source server.

1. Stop accepting card imports/reviews and let active uploads finish. Stop the
   API and alerts tasks for the snapshot window; leave cards and media alone.
   Record that writes are stopped so the before/after row counts are meaningful.
2. Choose a fresh backup filename under the approved destination. Refuse an
   existing filename so a failed backup cannot overwrite the previous good one.
   The following commands read the source database and write the new archive;
   the connection service keeps secrets off command lines:

   ```powershell
   $stamp = Get-Date -Format yyyyMMdd-HHmmss
   $dumpFile = Join-Path $env:PLAYERONE_BACKUP_DIR "playerone-$stamp.dump"
   if (Test-Path -LiteralPath $dumpFile) { throw 'Choose a new backup filename' }
   pg_dump --dbname=service=playerone_backup --format=custom --file=$dumpFile
   if ($LASTEXITCODE -ne 0) { throw 'Backup failed; keep the previous backup' }
   pg_restore --list $dumpFile | Out-Null
   if ($LASTEXITCODE -ne 0) { throw 'Backup archive cannot be listed' }
   (Get-FileHash -Algorithm SHA256 -LiteralPath $dumpFile).Hash |
     Set-Content -LiteralPath "$dumpFile.sha256" -Encoding ascii
   ```

   Listing checks the archive catalogue, not successful restoration. The
   SHA-256 detects a changed backup file, not the correctness of its data.
3. Record source row counts in `episode_ingests`, `episodes`,
   `episode_reviews`, `settlements`, `bills`, `bill_lines` and `audit_events`.
   A reusable read-only query is below. Also record the newest migration
   journal entry and one known reviewed episode/bill relationship; no money
   is recomputed or invented. Use `psql -X -v ON_ERROR_STOP=1` so a failing
   query cannot look successful.

   ```sql
   SELECT 'episode_ingests' AS table_name, count(*) AS rows FROM episode_ingests
   UNION ALL SELECT 'episodes', count(*) FROM episodes
   UNION ALL SELECT 'episode_reviews', count(*) FROM episode_reviews
   UNION ALL SELECT 'settlements', count(*) FROM settlements
   UNION ALL SELECT 'bills', count(*) FROM bills
   UNION ALL SELECT 'bill_lines', count(*) FROM bill_lines
   UNION ALL SELECT 'audit_events', count(*) FROM audit_events
   ORDER BY table_name;
   ```

4. Copy media into a new snapshot directory while writes remain stopped.
   Do not use mirroring/purge options that can delete files. Verify hashes
   against the ingest inventory for the episode that will demonstrate
   playback. Keep this media snapshot with the database snapshot. Resume the
   source services once the snapshot and row-count evidence have been secured.
5. On the isolated restore instance, prepare the existing application roles
   `playerone_app` and `playerone_risk` as NOLOGIN roles if absent. The dump does
   not create cluster-wide roles. Use a privileged restore account only for
   the restore, then test the application as `playerone_app`.
6. Create a **new empty** database named `playerone_restore_<timestamp>` on
   that isolated instance. Check its `current_database()`, `current_user` and
   server address/port before restoring. Never use `--clean`, never restore
   into an existing application database, and never edit an applied migration.
   Verify the archive hash before reading it:

   ```powershell
   if ((Get-FileHash -Algorithm SHA256 -LiteralPath $dumpFile).Hash -ne
       (Get-Content -LiteralPath "$dumpFile.sha256").Trim()) { throw 'Backup hash changed' }
   # Set to the new database you just created on the isolated restore instance.
   $restoreDb = 'REPLACE_NEW_playerone_restore_TIMESTAMP'
   if ($restoreDb -notmatch '^playerone_restore_[0-9-]+$') { throw 'Use a new rehearsal database name' }
   pg_restore --exit-on-error --no-owner --dbname="service=playerone_restore dbname=$restoreDb" $dumpFile
   if ($LASTEXITCODE -ne 0) { throw 'Restore failed; do not call this backup proven' }
   ```

7. Repeat the row-count query and compare every result with the snapshot.
   Check that the recorded review still joins to the same settlement/bill and
   audit rows. Check the migration journal; run a read-only application smoke
   check using the restored database and copied media, with no live ZNS,
   gateway or cloud-write credentials. Prove playback of the same hashed
   episode. Document elapsed backup/restore times and the measured results.
   A green archive-list command alone is never the recovery gate.

## Rollback and demo freeze

Keep the previous tested API checkout, console build and signed APK. Record
which schema version each supports. Before a release, complete the snapshot
procedure, stop the tasks and update their checkout/build paths to the chosen
release together. Keep media, backups and protected configuration outside any
directory you replace. Do not overwrite the running checkout piecemeal.

If startup or the rehearsal fails, stop the new tasks. Return all three tasks
and the console root to the previous tested artifact **only if it supports
the current schema**, then repeat preflight and health. Prefer a corrective
forward migration when the schema is incompatible. Restoring an old database
can lose later reviews and bills; it is incident recovery requiring the
operator's explicit decision, not an automatic rollback step.

Before the stakeholder session: reboot/re-sign-in, repeat health from another
PC and the actual phone, run the complete story twice, retain a spare handset
and a clearly identified recorded fallback, then freeze the artifacts. List
any missing domain, device, backup proof or ZNS delivery as an unresolved gate.
