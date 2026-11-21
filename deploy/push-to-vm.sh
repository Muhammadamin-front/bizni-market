#!/usr/bin/env bash
# Ships the committed tree to a plain Linux VM that has Docker, and (re)builds + restarts the stack there.
#
#   deploy/push-to-vm.sh ubuntu@<ip>
#
# One-time on the VM: Docker installed, ports 80/443 open, and ~/bizni-market/deploy/.env created with
#   deploy/setup.sh real <domain>      (its secrets never leave the VM; read the admin password there).
# DNS: A records for <domain> and www.<domain> -> the VM's public IP. Caddy gets the HTTPS certificates by itself.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${1:?usage: deploy/push-to-vm.sh user@host}"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit first: the VM gets HEAD." >&2; exit 2; }

echo "shipping $(git rev-parse --short HEAD) to $HOST"
git archive --format=tar HEAD | ssh "$HOST" 'mkdir -p ~/bizni-market && tar -x -C ~/bizni-market'
ssh "$HOST" 'set -e; cd ~/bizni-market
  [ -f deploy/.env ] || { echo "no deploy/.env on the VM: run  bash deploy/setup.sh real <domain>  there first" >&2; exit 2; }
  C="docker compose --env-file deploy/.env -f deploy/docker-compose.yml"
  $C build --pull
  $C up -d --remove-orphans
  $C ps --format "table {{.Service}}\t{{.Status}}"'
