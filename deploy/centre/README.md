# One centre on Windows: LAN demo or HTTPS production

Choose `centre.env.example` for an in-room HTTP demo, or
`centre.https.env.example` for a real HTTPS hostname. Copy only the chosen
template to `centre.env`; both use the same Caddyfile. A template is not a
deployment: the host/interface, account, cloud configuration, sign-in delivery
and encrypted backup destination must be supplied by the deployment owner.
Neither mode enables remote reviewer footage or the real payout gateway.

Run `node deploy/centre/check.mjs preflight deploy/centre/centre.env` before
starting anything. It reports missing settings and tools without printing
credentials. Exit 0 means these local checks passed, 1 means a check failed,
and 2 means invalid arguments or an unreadable/malformed environment file.
It never connects to a database or writes to object storage.

Use [REHEARSAL.md](REHEARSAL.md) for health checks, backup/restore proof,
reboot checks, rollback and the final demo gate. Do not call the deployment
ready until that rehearsal has been performed on its actual host and handset.

Use a dedicated Windows account, shown here as `CENTRE-PC\centre`, and a fixed
LAN address, shown as `192.168.1.10`. The checkout is `C:\PlayerOne`. Replace
these examples with the centre's actual account, address and absolute paths.
Commands below use PowerShell, except the explicitly labelled cmd block.

1. Install **Node 24** from the [Node distribution](https://nodejs.org/dist/latest-v24.x/)
   (Windows MSI), then `npm install -g pnpm@9`. Install **Postgres 18** and
   **Caddy** with winget:

   ```powershell
   winget install --exact --id PostgreSQL.PostgreSQL.18
   winget install --exact --id CaddyServer.Caddy
   ```

   Install Git and ffmpeg if absent (`winget install --exact --id Git.Git`
   and `winget install --exact --id Gyan.FFmpeg`). ffprobe is required for
   correct ingest timing. Reopen PowerShell after installation and check
   `node -v`, `pnpm -v`, `ffprobe -version` and `caddy version`. Add
   `C:\Program Files\PostgreSQL\18\bin` to PATH for `psql` and `createdb`.
   The Postgres installer starts its Windows service; keep it automatic and
   listening on loopback. Set `PLAYERONE_CADDY_EXE` and `PLAYERONE_NODE_EXE`
   in `centre.env` to their installed absolute paths. The wrappers use those
   same paths; find them with `Get-Command caddy` and `Get-Command node`.

2. Clone and install:

   ```powershell
   git clone https://github.com/mizuharaa/player-one.git C:\PlayerOne
   Set-Location C:\PlayerOne
   pnpm install
   ```

3. Create and migrate the database as its owner. Replace the password
   placeholders; percent-encode special characters in database URLs.

   ```powershell
   createdb -h 127.0.0.1 -U postgres playerone
   $env:DATABASE_URL = 'postgres://postgres:REPLACE_OWNER_PASSWORD@127.0.0.1:5432/playerone'
   pnpm db:migrate
   psql -h 127.0.0.1 -U postgres -d playerone
   ```

   At the psql prompt, enable the application role that migration 0021 created:

   ```sql
   ALTER ROLE playerone_app LOGIN PASSWORD 'REPLACE_DATABASE_PASSWORD';
   \q
   ```

   Use this role for bootstrap and the running processes:

   ```powershell
   $env:DATABASE_URL = 'postgres://playerone_app:REPLACE_DATABASE_PASSWORD@127.0.0.1:5432/playerone'
   ```

4. Bootstrap the centre, machine and three staff roles. Use separate generated
   secrets, keeping the machine and clerk values for `centre.env` in step 6:

   ```powershell
   node packages/api/bin/bootstrap.ts `
     --centre-region HCM --centre-name 'Upload centre HCM-01' `
     --machine counter-1 --machine-secret 'REPLACE_MACHINE_SECRET' `
     --operator 'op-1:administrator:REPLACE_ADMIN_SECRET' `
     --operator 'fin-1:finance:REPLACE_FINANCE_SECRET' `
     --operator 'clerk-1:centre_operator:REPLACE_CLERK_SECRET'
   ```

   Each row prints `created` or `exists` and its id, after commit. An identical
   repeat changes nothing, including hashes and statuses. The existing machine
   fixes the centre; the supplied centre name and region must match. Without
   that machine, one matching centre is reused, no match creates a centre, and
   several matches are refused. An existing operator must match centre, role and secret;
   reviewer references are a separate namespace. Any refusal rolls back the
   whole run. Exit codes: 0 success, 1 database/row conflict, 2 invalid arguments
   or missing `DATABASE_URL`.

   To replace one credential deliberately:

   ```powershell
   node packages/api/bin/bootstrap.ts --rotate-machine counter-1 --machine-secret 'REPLACE_NEW_MACHINE_SECRET'
   node packages/api/bin/bootstrap.ts --rotate-operator op-1 --operator-secret 'REPLACE_NEW_ADMIN_SECRET'
   ```

   Each changes only that row's hash. Rotation refuses a missing row, both
   rotate flags together, or create flags alongside rotation. Update the matching
   environment secret when rotating the machine or clerk and restart the API
   after a machine rotation. Bootstrap never prints secrets or hashes.

5. Build the console:

   ```powershell
   pnpm -F @playerone/console build
   ```

6. Copy the chosen LAN or HTTPS template to `deploy\centre\centre.env` and
   replace every `REPLACE_...` value. Set the media root to the directory that
   will hold imported `ego_*` folders, and create it. Supply the actual storage
   endpoint, bucket, keys and allocation rather than carrying a previous POC
   quota into this installation. Apply and read back
   the [bucket lifecycle rule](../../docs/RUNNING.md#the-bucket-needs-one-rule-set-on-it-by-hand)
   before the first real upload.

   This is a line-based environment file: `KEY=value`, no surrounding quotes,
   no `export`/`set` prefix, no inline comments; `#` starts a comment. Use hex
   for generated local secrets so cmd quoting is unambiguous. Keep the file
   readable only by the centre account and administrators; it and `logs/` are
   ignored by git. Keep `PLAYERONE_REVIEWER_MEDIA=0`. Set
   `PLAYERONE_SECURE_COOKIES=0` for the HTTP LAN and `1` for HTTPS.
   The API stays at `127.0.0.1:8080`, with `REVIEW_VERIFICATION_GATE=cloud`.

   Set `PLAYERONE_PUBLIC_URL` to the actual origin, `PLAYERONE_BIND` to its
   interface IP and `PLAYERONE_CONSOLE_ROOT` to the build directory. Use
   forward slashes in the console path because Caddy quotes it. For LAN,
   the origin host and bind IP must match. For HTTPS, arrange the actual
   hostname, DNS, certificate issuance and inbound proxy ports with the host
   owner first. Never publish the LAN configuration on a public interface.

   Preflight, load the validated file into this PowerShell process without
   evaluating its contents, then validate Caddy (validation does not start it):

   ```powershell
   node deploy/centre/check.mjs preflight deploy/centre/centre.env
   if ($LASTEXITCODE -ne 0) { throw 'Fix preflight failures before starting the centre' }
   Get-Content deploy\centre\centre.env | Where-Object { $_ -and -not $_.TrimStart().StartsWith('#') } | ForEach-Object {
     $key, $value = $_ -split '=', 2
     [Environment]::SetEnvironmentVariable($key, $value, 'Process')
   }
   & $env:PLAYERONE_CADDY_EXE validate --config deploy\centre\Caddyfile --adapter caddyfile
   if ($LASTEXITCODE -ne 0) { throw 'Fix the Caddy configuration before starting it' }
   ```

   For LAN, allow inbound TCP 80 on the Windows private firewall profile,
   scoped to the local subnet. For HTTPS, expose only the proxy ports required
   by the chosen certificate/hosting arrangement. Keep the API on loopback. Caddy carries the five
   console API paths and cookies unchanged; unmatched routes use the SPA.
   `/episodes` is a console route. Counter traffic uses the API directly;
   the heartbeat uses Fastify inject inside the API process.

7. Configure the centre account to sign in automatically at boot with
   [Microsoft Sysinternals Autologon](https://learn.microsoft.com/en-us/sysinternals/downloads/autologon):
   enter the account, computer/domain and password, then Enable. These tasks
   trigger at **logon**, so boot without this sign-in does not start them.
   Keep the PC awake while serving and importing; locking the session is fine,
   signing out stops the interactive tasks.

8. Replace both `CENTRE-PC\centre` occurrences in each `task-*.xml` with
   `whoami`'s output from the centre account. Replace all `C:\PlayerOne` paths
   if necessary, and the Windows/Node executable paths if installed elsewhere.
   The account must read the checkout and console build and write media and
   `deploy\centre\logs`. Register the three tasks from that account (elevate
   for registration if Windows requires it), then start them now because the
   current logon has already happened:

   ```powershell
   schtasks /create /tn PlayerOne-api /xml C:\PlayerOne\deploy\centre\task-api.xml
   schtasks /create /tn PlayerOne-alerts /xml C:\PlayerOne\deploy\centre\task-alerts.xml
   schtasks /create /tn PlayerOne-caddy /xml C:\PlayerOne\deploy\centre\task-caddy.xml
   schtasks /run /tn PlayerOne-api
   schtasks /run /tn PlayerOne-alerts
   schtasks /run /tn PlayerOne-caddy
   ```

   Task Scheduler is the supervisor: no time limit (`PT0S`), restart after
   failure every minute up to 999 times, and `IgnoreNew` to refuse a second
   instance. The wrappers append stdout and stderr to `logs/<process>-YYYY-MM-DD.log`,
   dated at process start; a long-running process keeps that file until restart.
   Alerts go to that worker's log when no webhook is configured.
   Check `schtasks /query /tn PlayerOne-api /v /fo list` (and the other two)
   and the logs if a process does not stay running. To restart a task, use
   `schtasks /end /tn PlayerOne-api`, then `/run`; substitute the other names
   as needed. After a reboot, confirm all three start under the centre account.

9. Open `PLAYERONE_PUBLIC_URL` from an operator PC. Sign in with machine
   `counter-1` and its secret, then administrator `op-1` and its secret.
   Reload a nested console route such as `/episodes` to check the SPA fallback.

10. Verify one real card on the centre PC with
    `packages/api/bin/counter.ts import`, using the
    [documented card/handover arguments](../../docs/RUNNING.md#the-operator-api).
    Load the same environment in **cmd.exe**, from the checkout root:

    ```bat
    for /f "usebackq eol=# delims=" %L in ("deploy\centre\centre.env") do set "%L"
    ```

    Invoke the counter against `http://127.0.0.1:8080` directly, using
    `PLAYERONE_MACHINE_IDENTIFIER` / `PLAYERONE_MACHINE_SECRET` and
    `PLAYERONE_OPERATOR_REF` / `PLAYERONE_OPERATOR_SECRET` for `clerk-1`.
    Follow its import/upload/read-back verification through to a verified
    delivery and check the episode in the console. Never clear the source card.

The HTTPS template provides the proxy configuration, not a hostname or
certificate promise; follow
[RUNNING.md](../../docs/RUNNING.md#the-server-speaks-plain-http-and-always-will)
for that deployment boundary. Disk encryption is operations work
owned by Alois under [ADR 0004](../../docs/adr/0004-sec06-is-disk-encryption-at-the-upload-centre.md).
Remote reviewers remain blocked on D11; this kit does not enable their raw-media access.
