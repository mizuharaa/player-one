# ADR 0004 — SEC-06 is disk encryption on the centre PC, not encryption in the application

**Status** Accepted as the mechanism. **Not delivered**: the deployment step
below has no named owner and no date, and this ADR cannot supply either. It is
an operations task, and until somebody's name is on it SEC-06 is open.
**Date** 2026-08-27
**Affects** SEC-06 (P0); SEC-09's "encryption at rest" half; UPL-03 and UPL-06;
brief §4.4's upload-batch pipeline stage *"Encrypted local cache"*

## Context

SEC-06 (P0) reads: *"Encrypted local cache at upload centres."* The brief's
upload-batch pipeline names it as a stage of its own — *"Manifest read → Local
checksum → **Encrypted local cache** → Multipart upload"* — and UPL-03 (P0)
repeats the same list. Nothing in this repository has ever mentioned it. As of
this commit, `grep -ril encrypt` over the tree (excluding `node_modules`) hits
only the ZaloPay RSA code under `packages/api/src/payout/zalopay/` with its
tests, the sentence in `CLAUDE.md` that describes that client, and the Postgres
transport check added alongside this ADR. There is no code, no document and no
ADR behind a P0.

What the requirement is protecting is not abstract. The local cache is the
directory named by `PLAYERONE_MEDIA_ROOT` — the imported `ego_*` session
folders (`packages/api/src/index.ts:85-90`). At an upload centre that is
hundreds of gigabytes of head-worn video of ordinary people's homes,
workplaces and families, held on one Windows PC in a room, for as long as it
takes the cloud leg to verify it. Under ADR 0001 the cloud leg is not running,
so today the cache is not cleaned at all and the footage stays.

## Decision

**SEC-06 is met by full-volume disk encryption on the upload-centre PC —
BitLocker — and by nothing in this application.**

The application does not encrypt, decrypt, or hold a key for footage. No code
lands for SEC-06. What lands is this record and a deployment step.

## Why application-level encryption is the wrong answer here

**The review console streams the same directory.** One `mediaRoot` value is
handed to three registrars in `packages/api/src/index.ts` — the upload leg at
`:373`, the review lane at `:374`, and the media route at `:383`. The media
route resolves a file inside that root (`packages/api/src/media.ts:156`) and
sends its bytes straight to the reviewer's `<video>` element
(`packages/api/src/media.ts:199` and `:211`). If the application encrypted
those files on disk, the reviewer's picture would go black, and the review
lane is the only thing in the system that decides whether a collector is paid.

**Byte-range reads are the whole reason that route exists.** The comment at the
top of `packages/api/src/media.ts` (lines 13-19) records the property: a server
that cannot answer `Range` makes a browser download 437 MB to seek to the
eighty-percent mark, and at 40,000 hours that is a programme that cannot be
reviewed. Serving a range out of an application-encrypted file means decrypting
on every seek, in-process, for every reviewer — a rewrite of the one route the
pilot's throughput depends on, to defend against a threat it does not defend
against anyway.

**The key would sit next to the ciphertext.** The centre PC is the machine that
imports the card, the machine that serves review, and the machine that would
hold the key. An attacker who has the PC has the key. The only threat
application encryption would actually stop is an attacker who can read the
files but cannot read the process's configuration, and there is no such person
at an upload centre.

**The cache is not disposable.** ADR 0001 keeps the TF card as the only other
copy and forbids clearing it, and the cache-clean route refuses to record a
clean before cloud verification (`packages/api/src/upload.ts:303` and `:341`).
An encryption scheme that loses its key therefore destroys footage that has
already been reviewed and paid for.

Full-volume encryption has none of these problems. The file system above it is
ordinary; `createReadStream` and `Range` work unchanged; the reviewer sees the
same picture; nothing in this repository changes.

## What disk encryption does and does not defend

It defends the machine or the drive **leaving the centre**: theft, a disk
returned under warranty, a PC resold or scrapped, a drive pulled out of a
running machine. That is the realistic loss at a staffed room in Vietnam
holding 640 TB across the programme.

It does **not** defend a running, logged-in PC. An operator at the keyboard,
malware in the operator's session, or anyone with the Windows password reads
the footage in clear, because the volume is unlocked while Windows is running.
That is not a gap in the mechanism, it is what "at rest" means, and it is why
SEC-02 (role isolation) and SEC-03 (logged raw-data download) are separate
requirements. Do not let this ADR be cited as covering them.

It also does not defend the TF card, which is SEC-07, still unsolved, and
explicitly *"not to be silently accepted by default"* in the brief.

## The deployment step

On each upload-centre PC, before it takes any footage:

1. **Check the Windows edition.** `winver`. BitLocker with a manageable
   recovery key needs **Windows 11 Pro** or better. Home has only "Device
   Encryption", which is not configurable and is absent on machines without
   the right firmware. A Home machine has to be upgraded or replaced; there is
   no software fix for it.
2. **Encrypt the system volume and every volume that can hold footage.** The
   data volume matters most — `PLAYERONE_MEDIA_ROOT` usually lives on a second,
   larger disk, and encrypting only `C:` leaves the footage in clear.
3. **Use full encryption, not used-space-only, on any disk that has already
   held footage.** `-UsedSpaceOnly` leaves deleted files readable in free
   space. A brand-new disk may use it; a disk that has been in service may not.
4. **Enable auto-unlock on the data volume** (`manage-bde -autounlock -enable
   D:`), or the API and the review console fail on every read after a reboot
   with no operator present.
5. **Escrow the recovery key off the machine.** A TPM change, a firmware
   update, or a motherboard swap locks the volume, and the recovery key is then
   the only way back to footage that has been reviewed and paid for but not yet
   uploaded. Print it, or store it in the same place the centre's other
   credentials live — not on the PC.

Steps 2-4, run as Administrator, are roughly:

```
manage-bde -on C: -RecoveryPassword
manage-bde -on D: -RecoveryPassword          # add -UsedSpaceOnly only if D: is new
manage-bde -autounlock -enable D:
manage-bde -protectors -get C: > recovery-C.txt   # escrow this off the machine
manage-bde -protectors -get D: > recovery-D.txt
```

## Owner

**Unassigned, and that is the open item.** This belongs to whoever provisions
and hands over the centre PC — VNG PT Lab operations, not this codebase. The
platform team cannot do it, cannot verify it remotely, and cannot make the
software depend on it (see "Alternatives considered").

The trigger is: **before the first upload centre imports a card in production.**
There are ~20 devices in the pilot and one centre, so this is one machine
today. At 500 collectors and a second centre it is a provisioning checklist
item, and it is much cheaper to write that checklist now than to retro-encrypt
a disk with 40 TB on it.

This ADR is not "done" until this section names a person and a date. Nothing in
the repository will tell you whether it has been done.

## The acceptance check

An auditor sits at the centre PC, opens an **Administrator** terminal, and runs:

```
manage-bde -status
```

For every volume that can hold footage — the system volume and the volume
holding `PLAYERONE_MEDIA_ROOT` — the output must read:

- `Conversion Status: Fully Encrypted`
- `Percentage Encrypted: 100.0%`
- `Protection Status: Protection On`
- `Encryption Method:` XTS-AES 128 or XTS-AES 256

`Percentage Encrypted: 100.0%` with `Protection Status: Protection Off` is the
failure that looks like a pass: the volume is encrypted with the key sitting in
clear on the disk, which is what a suspended BitLocker looks like after a
firmware update. Read both lines, not one.

Then, for the recovery key:

```
manage-bde -protectors -get C:
```

The numerical-password protector's ID must match the escrow record held off the
machine. A volume encrypted with a recovery key nobody has is a future outage,
not a control.

**The check needs local administrator rights.** Running `manage-bde -status`
and `Get-BitLockerVolume` as an ordinary user on Windows 11 both fail with
"access denied" — measured on the development machine while writing this. Give
the auditor an admin account, or have the operator run it while the auditor
watches.

## Alternatives considered

**Encrypt the media files in the application.** Rejected — the four reasons
above, of which the review console is decisive.

**Make the server refuse to start when BitLocker is off.** Rejected. It would
mean shelling out to `manage-bde` at boot: Windows-only, so the API stops
starting on the Linux box that runs CI; needing administrator rights the
service does not have and should not be given; and answering a question about
the machine rather than about the request, which is the kind of check that gets
commented out the first night a centre cannot start. The existing boot refusal
(`packages/api/src/index.ts:214`) is a different shape — it refuses a
*combination of settings the caller passed in*, which is always knowable and
always the caller's to fix. This one is not.

**Encrypt only the media directory with EFS or a container file.** Rejected.
EFS keys are tied to the Windows account, so the service account and the
operator each need one and neither can read the other's files; and a container
file has the same key-next-to-ciphertext problem as application encryption with
a worse failure mode. Full-volume encryption is one control, one recovery key,
and no per-file surface.

**Do nothing and note it at acceptance.** Rejected. SEC-06 is P0 and the data
is other people's homes. But the honest half of this alternative is kept: the
mechanism is an operations control, so writing code would have been a way of
looking finished without being finished.
