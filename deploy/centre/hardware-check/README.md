# Hardware check

This checks the Ego camera and the TF card reader on the centre laptop, and
writes one report file you send back. It does not touch the card's data —
every read is read-only.

## What to plug in

1. Plug the TF card reader (with the card inside) into a USB port.
2. Plug the Ego camera into a USB port, powered on, normal mode (do not hold
   volume-plus).

## What to run

Open PowerShell **as Administrator**. `usbipd` needs that to bind and attach
the card reader.

```powershell
cd C:\PlayerOne\deploy\centre\hardware-check
.\hardware-check.ps1
```

It will show `usbipd list` and ask for the reader's **BUSID** (a value like
`2-3` from that list — pick the row that names your USB card reader). Type it
and press Enter.

If you would rather not be asked, pass it directly:

```powershell
.\hardware-check.ps1 -BusId 2-3
```

To see what the script would do without touching anything (no card reader
or camera needed):

```powershell
.\hardware-check.ps1 -DryRun
```

## What it does

In order: prints your `usbipd` version and device list; attaches the card
reader to WSL; reads the card (filesystem type, session folders, file
counts, a checksum-verified copy of one session); detaches the reader; asks
the Ego camera for its identity over the SDK. Each of those steps prints
`PASS`, `FAIL`, or `SKIPPED` — a failure in one step does not stop the rest.

## What the report looks like

A text file next to the script, named `hardware-report-<date>-<time>.txt`.
The script prints its path when it finishes, for example:

```
Report written: C:\PlayerOne\deploy\centre\hardware-check\hardware-report-20260914-153000.txt
```

It lists every step with PASS, FAIL, or SKIPPED, plus the raw output of
each command (the card's filesystem type, its session list, the checksum
copy result, and the camera's JSON identity).

## What to send back

The `hardware-report-<date>-<time>.txt` file. Send the whole file, not a
screenshot — it is plain text and has no card contents or personal data in
it.
