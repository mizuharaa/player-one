#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "FAIL provision (line $LINENO)" >&2' ERR
[[ $EUID == 0 ]] || { echo 'FAIL run as root on the Ubuntu VM'; exit 1; }
source /etc/os-release
[[ $ID == ubuntu && ( $VERSION_ID == 22.04 || $VERSION_ID == 24.04 ) ]] || { echo 'FAIL requires Ubuntu 22.04/24.04'; exit 1; }
force=0; args=()
for arg in "$@"; do if [[ $arg == --force ]]; then force=1; else args+=("$arg"); fi; done
target=/srv/playerone
[[ ! -e $target/deploy/cloud/cloud.env || $force == 1 ]] || { echo 'FAIL already provisioned; --force reuses existing credentials'; exit 1; }
source_root=$(cd "$(dirname "$0")/../.." && pwd)
apt-get update -qq
apt-get install -y ca-certificates curl git python3 ufw
if ! docker info >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  # Docker's signed apt repository: https://docs.docker.com/engine/install/ubuntu/
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
mkdir -p "$target/backups"
chmod 700 "$target/backups"
if [[ $source_root != "$target" ]]; then
  # Archive the reviewed revision only: no local credentials, recordings or work-order files.
  git -C "$source_root" archive HEAD | tar -x -C "$target"
  git -C "$source_root" rev-parse HEAD > "$target/deploy/cloud/source-sha.txt"
fi
[[ -s $target/deploy/cloud/source-sha.txt ]] || git -C "$source_root" rev-parse HEAD > "$target/deploy/cloud/source-sha.txt"
if [[ ! -e $target/deploy/cloud/cloud.env ]]; then
  docker run --rm -v "$target:/kit" -w /kit node:22-bookworm-slim \
    node deploy/cloud/configure.mjs "${args[@]}"
else
  # Keep the credentials this deployment runs on, and add any variable the
  # release has added since it was written. Skipping this is how a redeploy of
  # the right revision shipped without the demo bypass key on 2026-09-16.
  docker run --rm -v "$target:/kit" -w /kit node:22-bookworm-slim \
    node deploy/cloud/configure.mjs --merge "${args[@]}"
  echo 'PASS existing cloud.env retained; no secrets rotated or printed'
fi
chmod 600 "$target/deploy/cloud/cloud.env"
# Add only web ingress; preserve any pre-existing management rules.
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo 'PASS provision; run: cd /srv/playerone/deploy/cloud && bash up.sh'
