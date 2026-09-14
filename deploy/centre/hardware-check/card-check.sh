#!/usr/bin/env bash
# card-check.sh -- WSL half of the on-site hardware check.
#
# Inventories the TF card (lsblk -f, session listing, 4 GiB check) and proves
# one checksum-verified copy off it, per the "Card procedure" section of
# ../DEMO-SCRIPT.md. The copy-and-diff step below is that section's own
# script text, reused verbatim (only CARD/INBOX/SESSION come from arguments
# instead of being hand-edited) -- this is deliberately not a second method.
#
# Usage:
#   card-check.sh --device /dev/sdX [--session NAME] [--dest DIR]
#   card-check.sh --dry-run [--device /dev/sdX] [--session NAME] [--dest DIR]
#   card-check.sh --card-root DIR [--session NAME] [--dest DIR]
#
# --device    whole-disk device of the attached TF reader, e.g. /dev/sdb.
#             Its first partition is mounted. Required unless --dry-run or
#             --card-root.
# --session   session directory name to copy. Default: newest ego_* by mtime.
# --dest      copy destination. Default: /mnt/c/PlayerOne/media (the doc's
#             INBOX, PLAYERONE_MEDIA_ROOT).
# --dry-run   print the commands this script would run; mount, copy and
#             umount nothing.
# --card-root DIR   test hook: skip usbipd/mount entirely and treat DIR as
#             the already-mounted card. Used to prove the inventory and
#             checksum-copy logic against a fixture, off real hardware.
#
# Never mounts anything but read-only (-o ro,noload), and never writes to
# $CARD. Every step below prints its own PASS/FAIL and the script keeps
# going, EXCEPT the copy-and-diff block, which runs as the doc's own single
# atomic script and is one PASS/FAIL step -- that block's whole point is
# that a pasted, step-by-step version of it hides a failed step behind an
# empty-looking diff.
#
# Exit: 0 if every step passed, 1 if any step failed or was skipped for lack
# of a device, 2 for a bad argument.

set -uo pipefail

DEVICE=""
SESSION=""
DEST=/mnt/c/PlayerOne/media
DRY_RUN=0
CARD_ROOT=""
CARD=/mnt/tfcard

while [ $# -gt 0 ]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2 ;;
    --session) SESSION="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --card-root) CARD_ROOT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

RESULT=0
step() { # step <label> <PASS|FAIL|SKIPPED> [detail]
  printf '[%s] %s%s\n' "$2" "$1" "${3:+ -- $3}"
  [ "$2" = FAIL ] && RESULT=1
}

# The DEMO-SCRIPT copy-and-diff block, written out so it runs as one script
# under its own set -euo pipefail -- see DEMO-SCRIPT.md "Copy the session
# directory" for why this must not be decomposed into separate steps.
write_copy_script() {
  cat > "$1" <<'COPYSCRIPT'
#!/usr/bin/env bash
set -euo pipefail

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
    # `xargs -r` quietly runs nothing and writes an EMPTY manifest -- and two
    # empty manifests diff clean, which would certify a copy of nothing.
    test -n "$(find . -type f -print -quit)"
    # Relative names on both sides, so the two manifests are comparable at
    # all. `-print0` with `sort -z` keeps every name safe and the order
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
COPYSCRIPT
}

if [ "$DRY_RUN" = 1 ]; then
  echo "-- dry run: printing commands only, nothing mounted, copied or unmounted --"
  echo "lsblk -f ${DEVICE:-<device>}"
  echo "sudo mkdir -p $CARD"
  echo "sudo mount -o ro,noload ${DEVICE:-<device>}1 $CARD"
  echo "find $CARD -maxdepth 1 -mindepth 1 -type d -name 'ego_*'   # inventory: files, bytes, largest file"
  echo "find $CARD -type f -size +4G                               # 4 GiB check"
  echo "CARD=$CARD SESSION=${SESSION:-<newest ego_*>} INBOX=$DEST bash /tmp/copy-card.sh"
  TMP_COPY=$(mktemp)
  write_copy_script "$TMP_COPY"
  echo "-- /tmp/copy-card.sh (the DEMO-SCRIPT text this step runs) --"
  cat "$TMP_COPY"
  rm -f "$TMP_COPY"
  echo "sudo umount $CARD"
  step "dry run" PASS "no usbipd, mount, copy or umount executed"
  exit 0
fi

MOUNTED=0
if [ -n "$CARD_ROOT" ]; then
  # Test hook: treat CARD_ROOT as already mounted, read-only.
  CARD="$CARD_ROOT"
  step "card root (test fixture)" PASS "$CARD"
elif [ -n "$DEVICE" ]; then
  LSBLK_OUT=$(lsblk -f "$DEVICE" 2>&1)
  LSBLK_RC=$?
  echo "$LSBLK_OUT"
  if [ $LSBLK_RC -ne 0 ]; then
    step "lsblk -f $DEVICE" FAIL "device not found"
    exit 1
  fi
  step "lsblk -f $DEVICE" PASS

  # Report the filesystem of every partition on the attached disk.
  while read -r name fstype; do
    [ -z "$name" ] && continue
    case "$fstype" in
      ext4) label="ext4 (expected)" ;;
      exfat) label="exFAT" ;;
      vfat) label="FAT32/vfat" ;;
      "") label="no filesystem detected" ;;
      *) label="other: $fstype" ;;
    esac
    echo "  partition $name: $label"
  done < <(lsblk -no NAME,FSTYPE "$DEVICE" | tail -n +2)

  PART="${DEVICE}1"
  sudo mkdir -p "$CARD"
  if sudo mount -o ro,noload "$PART" "$CARD" 2>/tmp/mount-err.$$; then
    step "mount ro,noload $PART -> $CARD" PASS
    MOUNTED=1
  else
    step "mount ro,noload $PART -> $CARD" FAIL "$(cat /tmp/mount-err.$$)"
    rm -f /tmp/mount-err.$$
    exit 1
  fi
  rm -f /tmp/mount-err.$$
else
  step "device given" FAIL "no --device, --dry-run or --card-root"
  exit 1
fi

# Session inventory: file counts, total bytes, largest file, per ego_* dir.
SESSIONS=$(find "$CARD" -maxdepth 1 -mindepth 1 -type d -name 'ego_*' | sort)
if [ -z "$SESSIONS" ]; then
  step "session inventory" FAIL "no ego_* directories found under $CARD"
else
  step "session inventory" PASS "$(echo "$SESSIONS" | wc -l) session(s)"
  while IFS= read -r dir; do
    name=$(basename "$dir")
    count=$(find "$dir" -type f | wc -l)
    bytes=$(find "$dir" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')
    largest=$(find "$dir" -type f -printf '%s %p\n' 2>/dev/null | sort -rn | head -1)
    echo "  $name: $count files, $bytes bytes total, largest: $largest"
  done <<< "$SESSIONS"
fi

# Any file over 4 GiB.
OVER4G=$(find "$CARD" -type f -size +4G)
if [ -n "$OVER4G" ]; then
  step "files over 4 GiB" FAIL "$(echo "$OVER4G" | wc -l) file(s)"
  echo "$OVER4G"
else
  step "files over 4 GiB" PASS "none"
fi

# Default session: newest ego_* by mtime.
if [ -z "$SESSION" ]; then
  SESSION=$(basename "$(find "$CARD" -maxdepth 1 -mindepth 1 -type d -name 'ego_*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)")
fi

if [ -z "$SESSION" ]; then
  step "checksum copy" SKIPPED "no session directory to copy"
else
  mkdir -p "$DEST"
  TMP_COPY=$(mktemp)
  write_copy_script "$TMP_COPY"
  COPY_OUT=$(CARD="$CARD" SESSION="$SESSION" INBOX="$DEST" bash "$TMP_COPY" 2>&1)
  COPY_RC=$?
  echo "$COPY_OUT"
  rm -f "$TMP_COPY"
  if [ $COPY_RC -eq 0 ]; then
    step "checksum copy ($SESSION -> $DEST)" PASS
  else
    step "checksum copy ($SESSION -> $DEST)" FAIL "exit $COPY_RC"
  fi
fi

if [ "$MOUNTED" = 1 ]; then
  if sudo umount "$CARD" 2>/tmp/umount-err.$$; then
    step "umount $CARD" PASS
  else
    step "umount $CARD" FAIL "$(cat /tmp/umount-err.$$)"
  fi
  rm -f /tmp/umount-err.$$
fi

exit $RESULT
