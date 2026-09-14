#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
umask 077
directory=../../backups
mkdir -p "$directory"
mkdir "$directory/.backup-lock" || { echo 'FAIL backup already running (or stale .backup-lock needs inspection)'; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
dump="$directory/$(setting POSTGRES_DB)-$stamp.dump"
trap 'rm -f "$dump.partial" "$dump.after"; rmdir "$directory/.backup-lock"' EXIT
ops counts > "$dump.counts.json"
if ! dc run --rm --no-deps -T db-tools sh -c 'exec pg_dump --dbname="$OWNER_DATABASE_URL" --format=custom' > "$dump.partial"; then
  echo 'FAIL pg_dump'; exit 1
fi
ops counts > "$dump.after"
# pg_dump is a consistent snapshot. Refuse a count manifest if writes changed counts during it.
if ! cmp -s "$dump.counts.json" "$dump.after"; then echo 'FAIL writes changed table counts; retry backup while idle'; exit 1; fi
mv "$dump.partial" "$dump"
dc run --rm --no-deps -T db-tools sh -c 'umask 022; cat > "/data/backups/$1"' sh "$(basename "$dump")" < "$dump"
echo "PASS backup $(cd "$directory" && pwd)/$(basename "$dump")"
echo "PASS row counts manifest $(basename "$dump").counts.json"
