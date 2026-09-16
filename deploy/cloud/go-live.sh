#!/usr/bin/env bash
# One-command go-live: hand this the VM's public IP and it derives the domain,
# ensures the GreenNode bucket, ships this checkout, and runs provision/up/verify
# on the VM over SSH. See docs/cloud-go-live.md "From the laptop with one IP".
set -euo pipefail

usage() { echo "Usage: bash deploy/cloud/go-live.sh <ip> [--domain D] [--bucket B] [--acme-email E] [--ssh-port N] [--ssh-user U] [--ssh-key PATH] [--quota-bytes N] [--force] [--dry-run|--plan]" >&2; exit 2; }
[[ $# -ge 1 ]] || usage
ip=$1; shift
domain=; bucket=; acme_email=luong.alois@gmail.com; ssh_port=234; ssh_user=ubuntu; ssh_key=~/.ssh/id_rsa_playerone; quota=1250000000; dry_run=0; force=
# Zalo Login, owner's decision 2026-09-16. Empty leaves the three cloud.env
# values empty, and code delivery stays exactly as it is today.
zalo_app_id=; zalo_app_secret=; sign_in_channel=
while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) domain=$2; shift 2 ;;
    --bucket) bucket=$2; shift 2 ;;
    --acme-email) acme_email=$2; shift 2 ;;
    --ssh-port) ssh_port=$2; shift 2 ;;
    --ssh-user) ssh_user=$2; shift 2 ;;
    --ssh-key) ssh_key=$2; shift 2 ;;
    --force) force=--force; shift ;;   # provision.sh refuses a re-run without it
    --quota-bytes) quota=$2; shift 2 ;;
    --zalo-app-id) zalo_app_id=$2; shift 2 ;;
    --zalo-app-secret) zalo_app_secret=$2; shift 2 ;;
    --sign-in-channel) sign_in_channel=$2; shift 2 ;;
    --dry-run|--plan) dry_run=1; shift ;;
    *) usage ;;
  esac
done
[[ -n $domain ]] || domain="api.${ip//./-}.sslip.io"
echo "Domain: $domain (sslip.io needs no DNS record; Caddy's ACME resolves it directly)"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# fable-playerone-vm: the RSA key the GreenNode console accepted (ed25519 was refused).
# The login user is an assumption (Ubuntu cloud images: "ubuntu", passwordless
# sudo); the first real run tests it. --ssh-user overrides.
remote_src=/root/playerone-src
ssh_opts=(-p "$ssh_port" -i "$ssh_key" -o StrictHostKeyChecking=accept-new)
scp_opts=(-P "$ssh_port" -i "$ssh_key" -o StrictHostKeyChecking=accept-new)  # scp's port flag is capital P, ssh's is lowercase
[[ -n $bucket ]] || bucket="playerone-demo-$(date -u +%Y%m%d)"
provision_script=; bundle_file=
trap 'rm -f "$provision_script" "$bundle_file"' EXIT   # the provision script carries the storage secret

# --- storage credentials: never printed, only masked ---
env_file="C:/Users/Khang/OneDrive/Documents/player-one/.env.local"
[[ -f $env_file ]] || env_file=~/.playerone/greennode.env
[[ -f $env_file ]] || { echo "FAIL no storage env file (checked .env.local and ~/.playerone/greennode.env)"; exit 1; }
getvar() { grep -m1 "^$1=" "$env_file" | cut -d= -f2-; }
STORAGE_ENDPOINT=$(getvar STORAGE_ENDPOINT)
STORAGE_KEY=$(getvar STORAGE_KEY)
STORAGE_SECRET=$(getvar STORAGE_SECRET)
for v in STORAGE_ENDPOINT STORAGE_KEY STORAGE_SECRET; do
  [[ -n ${!v} ]] || { echo "FAIL $v missing from $env_file"; exit 1; }
done

mask() { local s=$1; s=${s//$STORAGE_SECRET/***}; [[ -z $STORAGE_KEY ]] || s=${s//$STORAGE_KEY/***};
  # The Zalo app secret is a credential like the other two and reaches the VM
  # the same way: inside the stdin script, never on a command line, masked in
  # a dry run. The app id is not a secret and stays readable on purpose.
  [[ -z $zalo_app_secret ]] || s=${s//$zalo_app_secret/***}; printf '%s' "$s"; }

# step <label> <argv...>: streams and exits naming the step on failure; in
# --dry-run/--plan it only prints the (masked) command it would have run.
step() {
  local label=$1; shift
  if [[ $dry_run == 1 ]]; then
    echo "DRY-RUN $label: $(mask "$(printf '%q ' "$@")")"
  else
    echo "== $label =="
    "$@" || { echo "FAIL $label"; exit 1; }
    echo "PASS $label"
  fi
}
# same as step(), but feeds a local script file to the remote command's stdin
# (used only for the provisioning step, which carries the storage secret).
step_stdin() {
  local label=$1 scriptfile=$2; shift 2
  if [[ $dry_run == 1 ]]; then
    echo "DRY-RUN $label: $(mask "$(printf '%q ' "$@")") <stdin>"
    mask "$(cat "$scriptfile")" | sed 's/^/  | /'
    echo
  else
    echo "== $label =="
    "$@" < "$scriptfile" || { echo "FAIL $label"; exit 1; }
    echo "PASS $label"
  fi
}

# 1. GreenNode bucket: the exact S3 client call deploy/emu/ensure-bucket.mjs
# uses (forcePathStyle, region auto), reused rather than reimplemented.
[[ -n ${GO_LIVE_BUNDLE_ONLY:-} ]] || step bucket env STORAGE_ENDPOINT="$STORAGE_ENDPOINT" STORAGE_BUCKET="$bucket" \
  STORAGE_KEY="$STORAGE_KEY" STORAGE_SECRET="$STORAGE_SECRET" \
  node "$repo_root/deploy/emu/ensure-bucket.mjs"

# 2. Bundle the reviewed checkout (git archive would lose history git-clone
# needs; bundle+clone is what docs/cloud-go-live.md's own recipe uses).
bundle_file=$(mktemp -u).bundle   # -u: name only, git bundle create makes the file
step bundle git -C "$repo_root" bundle create "$bundle_file" HEAD
# GO_LIVE_BUNDLE_ONLY=<path>: stop here and keep the bundle there (the test clones it).
if [[ -n ${GO_LIVE_BUNDLE_ONLY:-} ]]; then mv "$bundle_file" "$GO_LIVE_BUNDLE_ONLY"; bundle_file=; exit 0; fi
step copy-bundle scp "${scp_opts[@]}" "$bundle_file" "$ssh_user@$ip:/tmp/cloud-provision.bundle"

# 3. provision.sh, over SSH, via stdin so the storage secret never sits in a
# process listing.
provision_script=$(mktemp)
{
  echo 'set -e'
  echo 'umask 077'
  echo 'apt-get update -qq && apt-get install -y git >/dev/null'
  printf 'rm -rf %q\n' "$remote_src"
  printf 'git clone /tmp/cloud-provision.bundle %q\n' "$remote_src"
  printf 'cd %q\n' "$remote_src"
  # Built as an array so an absent Zalo app adds no empty argument, which
  # provision.sh would forward to configure.mjs as a flag with no value.
  zalo_args=()
  [[ -z $zalo_app_id ]] || zalo_args+=(--zalo-app-id "$zalo_app_id" --zalo-app-secret "$zalo_app_secret")
  [[ -z $sign_in_channel ]] || zalo_args+=(--sign-in-channel "$sign_in_channel")
  printf 'bash deploy/cloud/provision.sh --domain %q --acme-email %q --local-db --storage-endpoint %q --storage-bucket %q --storage-key %q --storage-secret %q --quota-bytes %q %s %s\n' \
    "$domain" "$acme_email" "$STORAGE_ENDPOINT" "$bucket" "$STORAGE_KEY" "$STORAGE_SECRET" "$quota" "$force" "$(printf '%q ' ${zalo_args[@]+"${zalo_args[@]}"})"
} > "$provision_script"
step_stdin provision "$provision_script" ssh "${ssh_opts[@]}" "$ssh_user@$ip" sudo bash -s

# 4. up.sh, then verify.sh — no secrets in either command line.
step up ssh "${ssh_opts[@]}" "$ssh_user@$ip" "sudo bash -c 'cd /srv/playerone/deploy/cloud && bash up.sh'"
step verify ssh "${ssh_opts[@]}" "$ssh_user@$ip" "sudo bash -c 'cd /srv/playerone/deploy/cloud && bash verify.sh'"

echo
if [[ $dry_run == 1 ]]; then
  echo "DRY-RUN complete; nothing was run."
else
  echo "PASS go-live (verify.sh's own PASS/SKIPPED lines above are the evidence)"
fi
echo "URL:     https://$domain"
echo "Console: https://$domain (sign in as Operator: machine 'demo-machine-1', reference 'op-1')"
echo "Server (phone app, Profile > Server row): $domain"
echo "Demo secrets (op-1/fin-1/rev-1 and friends) print once, on the VM, in seed-stakeholder.mjs's output — not printed here."
