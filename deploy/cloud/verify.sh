#!/usr/bin/env bash
source "$(dirname "$0")/common.sh"
umask 077
report="verify-$(date -u +%Y%m%dT%H%M%SZ)-$$.txt"
exec > >(tee "$report") 2>&1
failed=0
check() { if step "$@"; then :; else failed=1; fi; }
echo "Cloud verification $(date -u +%FT%TZ)"
echo "Origin: $(setting PLAYERONE_PUBLIC_URL)"
api_id=$(dc ps -q api)
echo "Source SHA (running image): $(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$api_id")"
check image-id docker inspect --format '{{.Image}}' "$api_id"
echo "SKIPPED VN VM/DB/bucket residency: owner must name and verify their Vietnam locations; DB=$(setting POSTGRES_DB), bucket=$(setting STORAGE_BUCKET)"
# probe.mjs: HTTPS redirect, certificate expiry, headers, /healthz,
# authenticated console via machine + operator tokens, nested GET /episodes SPA,
# reviewer role reaches origin; a remote reviewer network remains an external check.
check web dc run --rm --no-deps -T ops node deploy/cloud/probe.mjs web
# SDK PUT + read-back SHA-256 and probe cleanup, never metadata-only evidence.
check bucket dc run --rm --no-deps -T ops node deploy/cloud/probe.mjs bucket
origin=$(setting PLAYERONE_PUBLIC_URL)
if dc run --rm --no-deps -T ops node packages/api/scripts/bucket-cors.mjs "$origin"; then
  echo 'PASS bucket-cors.mjs applied and read back'
else
  status=$?
  if [[ $status == 3 && $origin == http://localhost ]]; then
    echo 'SKIPPED bucket-cors.mjs: local MinIO has no per-bucket CORS API; GreenNode must pass this check'
  else echo 'FAIL bucket-cors.mjs'; failed=1; fi
fi
# e2e-loop.mjs: SIMULATION inside the image, separately named throwaway DB; never demo DB.
before=$(mktemp); after=$(mktemp)
trap 'rm -f "$before" "$after"' EXIT
ops counts > "$before"
check 'SIMULATION e2e-loop.mjs isolated database' ops e2e
ops counts > "$after"
check 'demo row counts unchanged by e2e' cmp "$before" "$after"
if [[ $# == 0 ]]; then
  echo 'SKIPPED real Ego session: pass --session /absolute/ego_* plus card-intake.mjs declarations'
elif [[ ${1:-} == --session && $# -ge 3 ]]; then
  session=$2; shift 2
  [[ -d $session && $(basename "$session") == ego_* ]] || { echo 'FAIL real Ego session directory'; exit 1; }
  # The card is read-only; card-intake copies to the persistent media volume first.
  check 'real Ego session card-intake.mjs' dc run --rm --no-deps -T \
    -v "$session:/card/$(basename "$session"):ro" ops \
    node packages/api/scripts/card-intake.mjs "/card/$(basename "$session")" "$@"
else echo 'FAIL usage: verify.sh [--session /absolute/ego_* --card ID --collector REF --others-in-frame yes|no --sensitive yes|no ...]'; failed=1
fi
echo 'SKIPPED remote reviewer network: repeat the console sign-in from the reviewer location'
echo "Report: deploy/cloud/$report"
if [[ $failed == 0 ]]; then echo 'PASS available checks (SKIPPED items are not go-live evidence)'; else echo 'FAIL verification'; fi
exit "$failed"
