# Demo acceptance script

> **Superseded for the Thursday 2026-09-17 stakeholder demo by
> [`../DEMO-RUNBOOK.md`](../DEMO-RUNBOOK.md).** That file is what the room is
> run from: it has the clock, the person responsible for each step, the state
> word each step must produce, and the recovery when it does not. Steps 1-10
> and the payment runbook below are the same story without any of that, and are
> kept as the reference for the evidence field each step produces.
>
> The **card procedure** at the end of this file is still the long-form
> reference and is NOT superseded - but read the runbook's card paragraph
> first: the measured card is **exFAT** and automounts (a drive letter on
> Windows, `/media/<user>/PlayerOne` on Linux), so the `usbipd`/WSL/ext4 route
> below does not apply to it.


Read this aloud in the room. It is the short path through the same story
[REHEARSAL.md](REHEARSAL.md) proves in depth; that file is what you rehearse
against beforehand, this one is what you say and press during the meeting.
Each step names the command or console screen and the exact evidence field it
produces, so a stakeholder can see the number appear, not take a claim on
trust.

Preconditions: the centre is up (`node deploy/centre/check.mjs health
deploy/centre/centre.env` exits 0), `PLAYERONE_PAYOUT_MODE=manual`, and you
have a card already handed in, or the real handset for step 1.

## 1-2. Card in, session declared, imported, uploaded, cloud verified

**Command:** one, on the copy or straight off the mounted card:

```bash
node packages/api/scripts/card-intake.mjs "$CARD/$SESSION" \
  --card <tf card id> --collector <collector's phone> \
  --others-in-frame yes|no --sensitive no
```

The four credentials from [RUNNING.md](../../docs/RUNNING.md#the-operator-api)
(`PLAYERONE_MACHINE_IDENTIFIER`, `PLAYERONE_MACHINE_SECRET`,
`PLAYERONE_OPERATOR_REF`, `PLAYERONE_OPERATOR_SECRET`) and
`PLAYERONE_MEDIA_ROOT` are in the environment. The two declarations are the
APP-17b answers the collector gave at the counter and have no default. Given a
path on the card, the command copies the session into `PLAYERONE_MEDIA_ROOT`
and compares every file's sha256 across the two before importing the copy; it
never imports in place and never writes to the card. Then it opens or reuses
today's handover, batch and declared session for this card, imports the
session, submits the episode and uploads it with cloud read-back. `--task` is
not needed: it defaults to the task the collector holds a live claim on.

**Evidence:** one table on stdout. Read the `batch` and `episode` rows aloud:

```
field         value
------------  ---------------------------------------------------------------------------
session       ego_AZER76400FE_20260813_072310
copy          10 files, sha256 matched
episode       3ed23c87-463e-8c3d-9a21-aca46c823f5c
ingest        new
verification  verified
attribution   automatic_single -> session 57f60e3b-cce5-5bfa-8363-3bd1ab37fdcc (resolved)
batch         ecd271f5-dc67-5495-9e31-190bf77ea462
reuse         handover opened, batch opened, session opened
```

`attribution automatic_single` is the row to watch on a card holding more than
one recording. **Every recording intaken for this card today joins the same
declared session**, so each one resolves by itself; the `reuse` row says
`session reused` from the second onwards. It used to declare a session per
recording, and then the resolver refused to choose between them — correctly,
because time matching is for app-declared sessions only — and every recording
after the first came back `unresolved -> session none (quarantined)` for an
operator to fix by hand. If you see that row, stop and say so: it means
something declared a second session for this card today.

`verification  verified` is the byte read-back verdict, and there is one
`cloud_verifications` row per file with its own `sha256` behind it — not an
ETag. Do not accept a run that only shows `cloud_verified_at` set without the
per-file verdict.

**The retry, on purpose.** Run the identical command a second time in the
room. It is the same batch, the same handover, the same episode and no second
bill line — the ids are derived from the centre, the card, the collector and
today's date, so a retry replays instead of importing again:

```
copy          10 files, sha256 matched
ingest        duplicate
verification  verified
attribution   automatic_single -> session 57f60e3b-cce5-5bfa-8363-3bd1ab37fdcc (resolved)
reuse         handover reused, batch reused, session reused
```

Exit 0 means the batch is cloud verified. Anything else prints the failed step
on stderr and the table shows how far it got; `packages/api/bin/counter.ts
upload --batch <id>` resumes the cloud leg alone from the batch id above.

## 3. Review

**Screen:** `/review` in the console.
**Evidence:** a decided `episode_reviews` row carrying `measured_duration_seconds`
(what the footage runs) and `effective_duration_seconds` (what is payable — the
intersection of stream coverage, always ≤ measured). Read both numbers aloud;
the gap between them is the answer to "why isn't the whole clip paid."

## 4. Settlement exists

**Evidence, no screen action needed:** the verdict writes a `settlements` row
in the same transaction, `settlement_state = 'pending_settlement'`, with its
own `unit_price` and `effective_minutes` copied at that moment — the price a
later edit to the task cannot change retroactively.

## 5. Declare the payout destination

**Command/screen:** the counter calls
`POST /api/payout/collectors/:id/accounts` (a centre-side action, not
finance's) with the collector's declared wallet or bank details.
**Evidence:** a `payout_accounts` row, `verify_status: "unverified"` until
ZaloPay confirms it — see the payment runbook below for what "unverified"
blocks.

## 6. Generate the bill

**Command/screen:** `POST /api/settle/bills` (the `/settle` console screen),
run by an operator who is **not** finance — the API itself refuses the call
with `settle_generate_by_finance` if a finance-role actor sends it, because
the person who generates a bill must not also be the person who can pay it.
**Evidence:** a `bills` row with `total` (the exact sum of its lines, never
rounded) and its `bill_lines`, one per settlement it collects.

## 7. Attempt to pay — the honest fallback

**Command/screen:** finance opens `/settle/bills/$billId`, then
`POST /api/payout/bills/:id/mark-paid`.

**If ZaloPay verification is absent** (no
`PLAYERONE_ZALOPAY_APP_ID` / `KEY1` / `PUBLIC_KEY` / `PAYMENT_ID`, so the
account is still `unverified`), the call is refused by name:
`payout_attempts_account_unverified`. Say this line to the room: **"This bill
is correct and ready. It shows as awaiting payment because ZaloPay has not
confirmed the destination yet — the platform will not send money to an
unconfirmed account, on purpose."** That is not a bug found live; it is the
G3 gate working. See the payment runbook for exactly where that refusal comes
from and what turns it off.

## 8. Pay it (only with real credentials and a real reference)

**Command/screen:** the same `mark-paid` call, now with a real
`manual_reference` — the bank/wallet transfer reference the finance operator
actually sent.
**Evidence:** the `payout_attempts` row: `amount_vnd` (the bill's total,
floored to the whole dong the transfer actually moves — see
`docs/RUNNING.md`/CLAUDE.md for why the floor is on the attempt and never on
the line or the bill), `manual_reference`, and `settled_at`.

## 9. The collector sees it

**Screen:** the collector app's earnings screen (`me.ts`'s income view).
**Evidence:** the settlement now reads `manually_paid`, and the amount shown
matches step 8's `amount_vnd` exactly.

## 10. Pull the evidence bundle

**Command:**
`DATABASE_URL=... node packages/api/scripts/demo-evidence.mjs --bill <bill id>`
(or `--episode`, `--collector`, or any other id named above — they all
resolve to the same collector).
**Evidence:** one JSON with every row from steps 1–9 in it, the file digests,
both durations, the unit price, the exact bill total, the floored attempt
amount, the transfer reference, every timestamp, and the running server's own
`git rev-parse HEAD` — so the bundle names the exact code that produced it.

---

## Payment runbook

The pilot rail is manual by design (`PLAYERONE_PAYOUT_MODE=manual`): a person
sends the money and records the reference, ZaloPay is used only to confirm
whose account it is. Three different people, three different steps:

1. **Counter declares the destination.** `POST
   /api/payout/collectors/:id/accounts`, run at the upload centre when the
   collector hands in their wallet or bank details. This never touches money;
   it only names where it should go.
2. **A non-finance operator runs the cycle.** `POST /api/settle/bills`
   refuses a finance-role actor by name (`settle_generate_by_finance`,
   `packages/api/src/settle.ts`) so the person who decides a bill's contents
   is never also the person who can mark it paid — separation of duty, not a
   permissions oversight.
3. **Finance marks it paid**, with the real transfer reference, once the
   money has actually moved: `POST /api/payout/bills/:id/mark-paid`.

**The four environment variables that unblock the real ZaloPay verifier:**
`PLAYERONE_ZALOPAY_APP_ID`, `PLAYERONE_ZALOPAY_KEY1`,
`PLAYERONE_ZALOPAY_PUBLIC_KEY`, `PLAYERONE_ZALOPAY_PAYMENT_ID`
(`packages/api/src/payout/zalopay/client.ts:452-455`,
`packages/api/src/payout/domain/config.ts:78-81`). Without all four, no
account can move past `verify_status = 'unverified'`.

**The exact refusal without them:** an attempt against an unverified account
is refused by the database itself, not by application logic that could drift
from it — `payout_attempts_account_unverified`, raised in the
`payout_attempts_guard` trigger,
`packages/store/drizzle/0012_payout.sql:279-282`:

```sql
IF acct_verify IS DISTINCT FROM 'verified' THEN
  RAISE EXCEPTION 'payout_attempts_account_unverified: account % is %, and only a verified account is paid',
    NEW.payout_account_id, acct_verify
    USING ERRCODE = '23514', CONSTRAINT = 'payout_attempts_account_unverified';
END IF;
```

The route surfaces it as a 409 with `constraint: "payout_attempts_account_unverified"`
(`packages/api/src/payout/routes/payout.ts:101`, listed in `PAYOUT_REFUSALS`
so the console maps it to a sentence rather than showing raw SQL). Consequence
stated plainly: a pilot with no ZaloPay credentials verifies nobody, and can
therefore pay nobody through this rail — every collector's bill sits
correctly generated and correctly unpayable until credentials exist.

---

## Card procedure — exFAT, auto-mounted, MEASURED

The card is **exFAT**, label `PlayerOne`, 240 GB. Measured on the hardware, not
inferred. Both operating systems mount it natively and automatically:

- **Linux:** `/media/<user>/PlayerOne` (on the on-site laptop, `/media/alois/PlayerOne`)
- **Windows:** a drive letter, e.g. `E:\`

Everything the earlier version of this section described — `usbipd bind`,
`usbipd attach --wsl`, `lsblk` hunting for a partition, `mount -o ro,noload`,
`e2fsck`, WSL as the only way in — was written for an **ext4** card and is
void. There is no journal to replay because exFAT has none, so the `noload`
argument and the whole WSL detour have nothing left to protect.

**The rule that does not change: never write to the card.** CLAUDE.md Rule 6 —
no TF card is cleared, and no step here writes to it. On Linux the automount is
read-write by default and on Windows the drive letter certainly is, so the
protection is now procedural rather than mount-enforced: **copy off it, and
issue no command that writes to it.** No delete, no move, no format, no
`chkdsk /f`, no "reorganise the folders". If Windows offers to scan and fix the
drive, decline.

1. Insert the card. Confirm the mount and find the session:

   ```bash
   ls /media/$USER/PlayerOne                     # Linux
   ```

   ```powershell
   Get-ChildItem E:\                             # Windows
   ```

   Expect `ego_*` session directories. If the label is not `PlayerOne`, stop:
   it is not this card.

2. Copy one session to the centre inbox — the host path that is
   `PLAYERONE_MEDIA_ROOT` for the API — with a checksum manifest on each side.
   Read-only from the card, read-write only on the destination.

   Run it as **one script**, not as four pasted lines: a pasted sequence
   carries on after a step fails. Save this as `/tmp/copy-card.sh` and run
   `bash /tmp/copy-card.sh`.

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   SESSION=<ego_session_dir>           # the directory name, not a path
   CARD=/media/$USER/PlayerOne         # the automount; no sudo, no mount call
   INBOX=/c/PlayerOne/media            # the centre's actual PLAYERONE_MEDIA_ROOT

   # Both manifests are written OUTSIDE the directories being hashed. A
   # manifest inside the copy would turn up in its own file list and hash
   # itself; a manifest inside the card would be a write to the card.
   manifest() {                        # manifest <directory> <absolute output file>
     (
       cd "$1"
       # Not a session directory: a symlink, device node, socket or fifo. A
       # symlink would make sha256sum hash whatever it points at on this
       # machine, which is not the card's content.
       test -z "$(find . ! -type f ! -type d -print -quit)"
       # The inventory must be non-empty, checked explicitly. Without this,
       # `xargs -r` quietly runs nothing and writes an EMPTY manifest — and two
       # empty manifests diff clean, which would certify a copy of nothing.
       test -n "$(find . -type f -print -quit)"
       # Relative names on both sides, so the two manifests are comparable at
       # all: absolute paths made the old `diff` impossible to satisfy, because
       # `/media/.../PlayerOne/...` is never `/c/PlayerOne/media/...`.
       # `-print0` with `sort -z` keeps every name safe and the order
       # identical; `-r` means a vanished inventory cannot produce a manifest;
       # `pipefail` means a failed hash aborts the run instead of writing a
       # short one. `find` rather than `*`, so hidden files are included.
       find . -type f -print0 | sort -z | xargs -0 -r sha256sum
     ) > "$2"
   }

   manifest "$CARD/$SESSION" /tmp/before.sha256
   cp -r --no-preserve=mode "$CARD/$SESSION" "$INBOX/"
   manifest "$INBOX/$SESSION" /tmp/after.sha256
   diff /tmp/before.sha256 /tmp/after.sha256
   echo "copy verified: $(wc -l < /tmp/before.sha256) files"
   ```

   **The proof is both halves.** The script must exit 0 — that is what says
   both directories were real session directories, both inventories were
   non-empty and every hash succeeded — *and* the `diff` must print nothing.
   If the script exits nonzero, stop and do not hand the copy to
   `card-intake.mjs`: an empty `diff` after a run that failed earlier proves
   nothing at all.

   `deploy/centre/hardware-check/card-check.sh --card-root
   /media/$USER/PlayerOne` runs this same inventory and copy against an
   already-mounted card, with the step-by-step PASS/FAIL report. It is the same
   method, not a second one.

3. Import the copy (steps 1-2 above). Once per recording on the card; they all
   join the one declared session for this card today:

   ```bash
   node packages/api/scripts/card-intake.mjs "$INBOX/$SESSION" \
     --card <tf card id> --collector <phone> --others-in-frame yes|no --sensitive no
   ```

   The command also accepts the path **on the card** — `"$CARD/$SESSION"` —
   and then does the copy and the per-file sha256 comparison itself before
   importing the copy, printing `copy  <n> files, sha256 matched`. It never
   imports from the card in place. Use the shell script above when a stakeholder
   should watch the manifests being compared; use the card path when the point
   is one command.

4. Eject and remove the card:

   ```bash
   udisksctl unmount -b /dev/disk/by-label/PlayerOne    # Linux
   ```

   On Windows use Safely Remove Hardware. Then the card goes back in its
   envelope, still holding every byte it arrived with.

What is still not measured on this path: how long a full multi-gigabyte session
takes to copy off this card on this hardware, and whether the copy into a
Windows path preserves every filename exactly on a session containing unusual
characters. Rehearse with the real card before relying on the timings.
