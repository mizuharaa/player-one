#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
trap 'echo "FAIL startup (line $LINENO)" >&2' ERR
[[ $# == 0 || ( $# == 1 && $1 == --pull ) ]] || { echo 'Usage: bash up.sh [--pull]'; exit 2; }
step configuration dc config --quiet
if [[ ${1:-} == --pull ]]; then step images dc pull api migrate; else step images dc build api migrate; fi
if [[ $(setting PLAYERONE_LOCAL_DB) == 1 ]]; then step postgres dc --profile db up -d postgres; fi
step caddy dc up -d caddy
step database-ready ops ready
step migrate dc run --rm --no-deps -T migrate
step grant ops grant
step bootstrap ops bootstrap
# Seed output includes secrets even on reruns; keep it in the protected credentials file instead.
seed_log=$(mktemp); chmod 600 "$seed_log"
if dc run --rm --no-deps -T ops node packages/api/scripts/seed-stakeholder.mjs >"$seed_log" 2>&1; then
  rm "$seed_log"; echo 'PASS seed-stakeholder.mjs'
else
  echo "FAIL seed-stakeholder.mjs; protected diagnostic: $seed_log"; exit 1
fi
# Refresh the named console volume on upgrades; copying from the new image avoids stale assets.
step console-assets dc run --rm --no-deps -T ops sh -c 'cp -a /app/apps/console/dist/. /console/'
step api dc up -d --force-recreate api
step healthz ops health
step backup bash backup.sh
step demo-preflight ops preflight
echo "PASS console: $(setting PLAYERONE_PUBLIC_URL)"
echo "PASS credentials: $(pwd)/cloud.env (op-1 administrator, fin-1 finance, rev-1 reviewer)"
