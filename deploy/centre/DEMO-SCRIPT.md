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

## 1. Card in, session declared

**Screen:** the counter console, or `packages/api/bin/counter.ts import`
(see [RUNNING.md](../../docs/RUNNING.md#the-operator-api)).
**Evidence:** a `batch_id` printed to stderr before upload starts, and a
`handover_id` from the same call. Say the batch id aloud; it is what step 2's
evidence traces back to.

## 2. Import, upload, cloud verify

**Command:** the same `counter.ts import` call finishes with
`cloud_verified: true` on stdout, or `counter.ts upload --batch <id>` if
resuming.
**Evidence:** `episode_id`, `verification_state: "verified"` (episodes table),
and one `cloud_verifications` row per file with its own `sha256`. This is the
byte read-back proof, not an ETag — do not accept a run that only shows
`cloud_verified_at` set without the per-file verdict.

## 3. Review

**Screen:** `/review` in the console.
**Evidence:** a decided `episode_reviews` row carrying `measured_duration_s`
(what the footage runs) and `effective_duration_s` (what is payable — the
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

## Card procedure, Windows, ext4 TF card — UNTESTED

**This procedure is for an ext4 card, and the measured card is not one.** The real TF card is exFAT, label `PlayerOne`, 240 GB, and it automounts on both Windows and Linux: no `usbipd`, no WSL, no `ro,noload` mount. Keep this section for the day an ext4 card appears; for Thursday follow [`../DEMO-RUNBOOK.md`](../DEMO-RUNBOOK.md).

**No card reader was attached when this was written.** Nothing below has been run end to end;
it is written from `usbipd`/WSL documentation and this machine's own tool
versions (`usbipd 5.3.0`, WSL distros `Ubuntu` and `Ubuntu-22.04`, both
present and stopped, checked with `wsl -l -v`), not from a completed transfer.
Treat every step as a plan to rehearse, not a proven procedure. Windows
cannot mount ext4 natively, which is why the card goes through WSL rather
than a Windows drive letter.

1. Plug in the reader with the card inserted. Find its bus id from an
   elevated PowerShell (`usbipd` needs Administrator to bind/attach):

   ```powershell
   usbipd list
   ```

   Identify the reader by its `DEVICE` name (not by guessing the busid — a
   wrong bind can attach the wrong device to WSL). Note its `BUSID`, e.g. `2-3`.

2. Bind it once (persists across reboots), then attach it to WSL for this
   session:

   ```powershell
   usbipd bind --busid <busid>
   usbipd attach --wsl --busid <busid>
   ```

   `--wsl` starts the default WSL distro if it is not already running. To
   attach into a specific distro instead of the default one, add
   `--wsl-distribution Ubuntu-22.04`.

3. In the WSL shell, confirm the device arrived and identify its partition:

   ```bash
   lsblk -f
   ```

   Expect one `ext4` partition on the card. Do not proceed if `lsblk` shows
   more than one candidate partition without being certain which is the card —
   mounting the wrong block device risks the wrong data, not the card's.

4. Mount it **read-only, and with the journal left alone**. This is the hard
   rule from CLAUDE.md Rule 6: no TF card is ever cleared, and nothing here
   may write to the card.

   ```bash
   sudo mkdir -p /mnt/tfcard
   sudo mount -o ro,noload /dev/sdX1 /mnt/tfcard   # replace sdX1 with the device from lsblk
   ```

   `-o ro` is not enough on its own, and this is the reason: a read-only ext4
   mount still **replays the journal onto the device** if the filesystem was
   not cleanly unmounted — which is exactly the state a card pulled out of a
   camera is in. That replay is a write to the card. `noload` tells the kernel
   not to load the journal at all.

   **If that mount fails, stop.** `noload` refuses a filesystem that needs
   recovery, and that refusal is the guard working rather than an obstacle to
   get around. Read the reason before doing anything else:

   ```bash
   dmesg | tail -20
   ```

   Do **not** re-mount without `noload`, and do not run `e2fsck` against the
   card. Recovery happens on a **copy**: image the partition to host storage
   and recover the image, never the original.

   ```bash
   sudo dd if=/dev/sdX1 of=/mnt/c/PlayerOne/recovery/card.img bs=4M status=progress
   sudo mount -o ro,loop /mnt/c/PlayerOne/recovery/card.img /mnt/tfcard
   ```

   The card then goes back in its envelope untouched, and the copy is what
   anybody argues about.

5. Copy the session directory to the centre inbox — the host path that
   becomes `PLAYERONE_MEDIA_ROOT` for the API — read-only from the card,
   read-write only on the destination.

   Run it as **one script**, not as four pasted lines: a pasted sequence
   carries on after a step fails. Save this as `/tmp/copy-card.sh` in the WSL
   shell and run `bash /tmp/copy-card.sh`.

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   SESSION=<ego_session_dir>           # the directory name, not a path
   CARD=/mnt/tfcard
   INBOX=/mnt/c/PlayerOne/media        # the centre's actual PLAYERONE_MEDIA_ROOT
                                       # (/mnt/c is how WSL2 reaches Windows)

   # Both manifests are written OUTSIDE the directories being hashed, on
   # writable host storage. The card is read-only so a manifest inside it is
   # impossible anyway, and a manifest inside the copy would turn up in its own
   # file list and hash itself.
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
       # `/mnt/tfcard/...` is never `/mnt/c/PlayerOne/media/...`. `-print0`
       # with `sort -z` keeps every name safe and the order identical; `-r`
       # means a vanished inventory cannot produce a manifest; `pipefail` means
       # a failed hash aborts the run instead of writing a short one. `find`
       # rather than `*`, so hidden files are included.
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
   `counter.ts import`: an empty `diff` after a run that failed earlier proves
   nothing at all.

6. Unmount and detach before removing the card:

   ```bash
   sudo umount /mnt/tfcard
   ```

   ```powershell
   usbipd detach --busid <busid>
   ```

7. Continue with the ordinary import (`counter.ts import --session-dir
   <path under PLAYERONE_MEDIA_ROOT>`), per [RUNNING.md](../../docs/RUNNING.md).

What is not proven by this write-up: that `usbipd attach` reliably reaches a
real card reader on this hardware, that the ext4 partition is `sdX1` and not
some other number, that permissions survive the copy into `/mnt/c` cleanly,
and how long a real multi-gigabyte session takes over this path. Rehearse
with an actual card and reader before relying on this at the centre.
