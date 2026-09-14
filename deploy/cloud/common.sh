#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[[ -f cloud.env ]] || { echo 'FAIL cloud.env missing; provision first'; exit 1; }
# No eval/source of credentials. Compose is the single dotenv parser.
if python3 --version >/dev/null 2>&1; then python=python3; else python=python; fi
dc() { docker compose --env-file cloud.env "$@"; }
setting() { dc config --format json | "$python" -c 'import json,sys; print(json.load(sys.stdin)["services"]["ops"]["environment"][sys.argv[1]])' "$1"; }
ops() { dc run --rm --no-deps -T ops node deploy/cloud/ops.mjs "$@"; }
step() {
  local label=$1; shift
  if "$@"; then echo "PASS $label"; else echo "FAIL $label" >&2; return 1; fi
}
