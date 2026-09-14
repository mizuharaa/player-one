#!/usr/bin/env bash
# card-check.sh -- the on-site TF card check.
#
# Inventories the card (session listing, 4 GiB check) and proves one
# checksum-verified copy off it, per the "Card procedure" section of
# ../DEMO-SCRIPT.md. The copy-and-diff step below is that section's own
# script text, reused verbatim (only CARD/INBOX/SESSION come from arguments
# instead of being hand-edited) -- this is deliberately not a second method.
#
# The card is exFAT and both Linux and Windows automount it, so by default
# this script mounts NOTHING: it finds the mount that is already there.
# Measured on the hardware: label PlayerOne, 240 GB, Linux
# /media/<user>/PlayerOne, Windows a drive letter.
#
# Usage:
#   card-check.sh [--session NAME] [--dest DIR]              # the ordinary path
#   card-check.sh --card-root DIR [--session NAME] [--dest DIR]
#   card-check.sh --device /dev/sdX [--session NAME] [--dest DIR]
#   card-check.sh --dry-run [...]
#
# (no flag)   find the already-mounted card: /media/*/PlayerOne,
#             /run/media/*/PlayerOne, /Volumes/PlayerOne, or a drive letter
#             holding ego_* directories at its root. Exactly one candidate is
#             required -- two is a FAIL asking for --card-root, because
#             guessing which mount is the card risks the wrong data.
# --card-root DIR   use DIR as the already-mounted card. Says which mount when
#             detection finds more than one, and is the test hook that proves
#             the inventory and checksum-copy logic against a fixture.
# --device    NOT NEEDED FOR THIS CARD, and mounts only when asked for by
#             name. Whole-disk device of the reader, e.g. /dev/sdb; its first
#             partition is mounted read-only. For a card that does not
#             automount, or one that is not exFAT.
# --session   session directory name to copy. Default: newest ego_* by mtime.
# --dest      copy destination. Default: /mnt/c/PlayerOne/media (the doc
#             INBOX, PLAYERONE_MEDIA_ROOT).
# --dry-run   print the commands this script would run; mount, copy and
#             umount nothing.
#
# Nothing here writes to $CARD, on any path. That is now procedural rather
# than mount-enforced: an automounted exFAT card is read-write on both
# systems, so the protection is that no step below writes to it. The --device
# path still mounts read-only, and adds ext4 noload only on ext4 -- it means
# "do not replay the journal", which on an unclean ext4 card would itself be a
# write, and exFAT has no journal and refuses the option.
#
# Every step prints its own PASS/FAIL and the script keeps going, EXCEPT the
# copy-and-diff block, which runs as the doc own single atomic script and is
# one PASS/FAIL step -- that block whole point is that a pasted,
# step-by-step version of it hides a failed step behind an empty-looking diff.
#
# Exit: 0 if every step passed, 1 if any step failed or no card was found,
# 2 for a bad argument.

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

# Both manifests are written OUTSIDE the directories being hashed. A manifest
# inside the copy would turn up in its own file list and hash itself; a
# manifest inside the card would be a write to the card, which the automounted
# exFAT card would now allow and which nothing here may do.
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

# Every already-mounted card this machine could be showing. exFAT automounts
# on both systems, so this is the ordinary path: no sudo, no mount, no usbipd.
detect_card() {
  local found=() p d
  for p in /media/*/PlayerOne /run/media/*/PlayerOne /Volumes/PlayerOne; do
    [ -d "$p" ] && found+=("$p")
  done
  # Git Bash on Windows mounts a drive letter and puts no label in the path, so
  # the card is recognised by holding ego_* session directories at its root.
  # /c is the system disk and is never the card.
  for d in /d /e /f /g /h /i /j /k /l /m /n /o /p /q /r /s /t /u /v /w /x /y /z; do
    [ -d "$d" ] && compgen -G "$d/ego_*" > /dev/null 2>&1 && found+=("$d")
  done
  printf '%s\n' ${found[@]+"${found[@]}"}
}

if [ "$DRY_RUN" = 1 ]; then
  echo "-- dry run: printing commands only, nothing mounted, copied or unmounted --"
  if [ -n "$CARD_ROOT" ]; then
    CARD="$CARD_ROOT"
    echo "# --card-root given: $CARD used as the already-mounted card"
  elif [ -n "$DEVICE" ]; then
    echo "lsblk -f $DEVICE"
    echo "sudo mkdir -p $CARD"
    echo "sudo mount -o ro[,noload on ext4] ${DEVICE}1 $CARD"
  else
    echo "# default: nothing is mounted. Already-mounted card(s) detected:"
    CARD="$(detect_card | head -1)"
    if [ -n "$CARD" ]; then detect_card | sed "s/^/#   /"; else echo "#   none"; fi
    CARD="${CARD:-<no card mounted>}"
  fi
  echo "find $CARD -maxdepth 1 -mindepth 1 -type d -name 'ego_*'   # inventory: files, bytes, largest file"
  echo "find $CARD -type f -size +4G                               # 4 GiB check"
  echo "CARD=$CARD SESSION=${SESSION:-<newest ego_*>} INBOX=$DEST bash /tmp/copy-card.sh"
  TMP_COPY=$(mktemp)
  write_copy_script "$TMP_COPY"
  echo "-- /tmp/copy-card.sh (the DEMO-SCRIPT text this step runs) --"
  cat "$TMP_COPY"
  rm -f "$TMP_COPY"
  [ -n "$DEVICE" ] && echo "sudo umount $CARD"
  step "dry run" PASS "nothing mounted, copied or unmounted"
  exit 0
fi

MOUNTED=0
if [ -n "$CARD_ROOT" ]; then
  # The named mount: the operator saying which, or a fixture standing in for a
  # card. Already mounted either way, and only ever read from.
  CARD="$CARD_ROOT"
  step "card root (given)" PASS "$CARD"
elif [ -n "$DEVICE" ]; then
  # Asked for by name. Not needed for the exFAT card, which automounts.
  step "explicit --device mount" PASS "$DEVICE (not needed for an automounting exFAT card)"
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
  # noload is an ext4 option: it stops the kernel replaying the journal, which
  # on a card pulled out of a camera would itself be a write. exFAT has no
  # journal and refuses the option, so it is passed only where it exists.
  case "$(lsblk -no FSTYPE "$PART" 2>/dev/null | head -1)" in
    ext4) OPTS=ro,noload ;;
    *) OPTS=ro ;;
  esac
  sudo mkdir -p "$CARD"
  if sudo mount -o "$OPTS" "$PART" "$CARD" 2>/tmp/mount-err.$$; then
    step "mount $OPTS $PART -> $CARD" PASS
    MOUNTED=1
  else
    step "mount $OPTS $PART -> $CARD" FAIL "$(cat /tmp/mount-err.$$)"
    rm -f /tmp/mount-err.$$
    exit 1
  fi
  rm -f /tmp/mount-err.$$
else
  # The ordinary path: the card is already mounted, and nothing is mounted here.
  CANDIDATES=()
  while IFS= read -r line; do [ -n "$line" ] && CANDIDATES+=("$line"); done < <(detect_card)
  if [ "${#CANDIDATES[@]}" -eq 1 ]; then
    CARD="${CANDIDATES[0]}"
    step "card already mounted" PASS "$CARD"
  elif [ "${#CANDIDATES[@]}" -eq 0 ]; then
    step "card already mounted" FAIL \
      "no PlayerOne mount and no drive holding ego_* at its root; insert the card, or give --card-root DIR (or --device for a card that does not automount)"
    exit 1
  else
    # Never guess. Reading from the wrong volume risks the wrong data, which is
    # the same rule the old lsblk step carried.
    step "card already mounted" FAIL "more than one candidate (${CANDIDATES[*]}); say which with --card-root"
    exit 1
  fi
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
