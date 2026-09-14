#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
[[ $# == 2 ]] || { echo 'Usage: bash restore.sh /absolute/backup.dump po_restore_NAME'; exit 2; }
dump=$1; name=$2
[[ -f $dump && -f $dump.counts.json ]] || { echo 'FAIL dump or counts manifest missing'; exit 1; }
# CREATE DATABASE refuses an existing target. No overwrite or DROP, even on retry.
step create-restore ops create-restore "$name"
restore_url=$(ops restore-url "$name")
step pg_restore dc run --rm --no-deps -T -e "DATABASE_URL=$restore_url" db-tools \
  sh -c 'exec pg_restore --exit-on-error --dbname="$DATABASE_URL"' < "$dump"
actual=$(mktemp); trap 'rm -f "$actual"' EXIT
ops counts "$name" > "$actual"
"$python" -c 'import json,sys
expected=json.load(open(sys.argv[1])); actual=json.load(open(sys.argv[2]))
for table in sorted(expected.keys() | actual.keys()):
 print(("PASS" if expected.get(table)==actual.get(table) else "FAIL")+" row counts "+table+": backup="+str(expected.get(table))+" restored="+str(actual.get(table)))
sys.exit(0 if expected==actual else 1)' "$dump.counts.json" "$actual"
echo "PASS restore $name; preserved for inspection, demo URL unchanged"
