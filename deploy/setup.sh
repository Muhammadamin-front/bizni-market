#!/usr/bin/env bash
# Creates deploy/.env with fresh random secrets. Safe to re-run: it never overwrites an existing file.
#   deploy/setup.sh demo      -> synthetic MoySklad + free Cloudflare tunnel (no token, no bot, no domain needed)
#   deploy/setup.sh real [domain]  -> real shop (MoySklad token optional, add it later), Caddy HTTPS for the domain
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-demo}"
DOMAIN="${2:-shop.example.uz}"
[ -e .env ] && { echo "deploy/.env already exists - not touching it."; exit 0; }
rand() { openssl rand -hex "$1"; }
ADMIN_PASS="$(rand 9)Aa!"
{
  echo "# Generated $(date -u +%FT%TZ) by deploy/setup.sh ($MODE). Keep this file private."
  echo "POSTGRES_PASSWORD=$(rand 16)"
  echo "SESSION_SECRET=$(rand 32)"
  echo "REVALIDATE_SECRET=$(rand 16)"
  echo "MOYSKLAD_WEBHOOK_SECRET=$(rand 16)"
  echo "TELEGRAM_WEBHOOK_SECRET=$(rand 16)"
  if [ "$MODE" = "demo" ]; then echo "ADMIN_EMAIL=owner@shop.local"; else echo "ADMIN_EMAIL=admin@$DOMAIN"; fi
  echo "ADMIN_PASSWORD=$ADMIN_PASS"
  if [ "$MODE" = "demo" ]; then
    echo "WEB_PORT=3000"
    echo "COMPOSE_PROFILES=demo,tunnel"
    echo "MOYSKLAD_TOKEN=demo-token"
    echo "MOYSKLAD_BASE_URL=http://mock-moysklad:4010/api/remap/1.2"
    echo "MOYSKLAD_WEBHOOK_BASE_URL=http://api:4000"
    echo "PUBLIC_URL=http://localhost:3000"
    echo "# Mini App in a plain browser with a stand-in user (the server refuses this together with a real bot token in production):"
    echo "TMA_DEV_MODE=true"
  else
    echo "COMPOSE_PROFILES=caddy"
    echo "# Caddy is the only way in: the web app listens on the loopback only (Docker would otherwise publish it past the firewall)."
    echo "WEB_PORT=127.0.0.1:3000"
    echo "DOMAIN=$DOMAIN"
    echo "MOYSKLAD_TOKEN="
    echo "MOYSKLAD_BASE_URL=https://api.moysklad.ru/api/remap/1.2"
    echo "PUBLIC_URL=https://$DOMAIN"
    echo "TELEGRAM_BOT_TOKEN="
    echo "TELEGRAM_BOT_USERNAME="
    echo "TMA_DEV_MODE=false"
  fi
} > .env
chmod 600 .env
echo "Created deploy/.env"
echo "Admin login:  $(sed -n 's/^ADMIN_EMAIL=//p' .env)   /   $ADMIN_PASS   (change it in /admin -> Система)"
