#!/usr/bin/env bash
# Creates deploy/.env with fresh random secrets. Safe to re-run: it never overwrites an existing file.
#   deploy/setup.sh demo      -> synthetic MoySklad + free Cloudflare tunnel (no token, no bot, no domain needed)
#   deploy/setup.sh real      -> real MoySklad (you add the token), Caddy for your domain
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-demo}"
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
  echo "ADMIN_EMAIL=owner@shop.local"
  echo "ADMIN_PASSWORD=$ADMIN_PASS"
  echo "WEB_PORT=3000"
  if [ "$MODE" = "demo" ]; then
    echo "COMPOSE_PROFILES=demo,tunnel"
    echo "MOYSKLAD_TOKEN=demo-token"
    echo "MOYSKLAD_BASE_URL=http://mock-moysklad:4010/api/remap/1.2"
    echo "MOYSKLAD_WEBHOOK_BASE_URL=http://api:4000"
    echo "PUBLIC_URL=http://localhost:3000"
    echo "# Mini App in a plain browser with a stand-in user (the server refuses this together with a real bot token in production):"
    echo "TMA_DEV_MODE=true"
  else
    echo "COMPOSE_PROFILES=caddy"
    echo "DOMAIN=shop.example.uz"
    echo "MOYSKLAD_TOKEN="
    echo "MOYSKLAD_BASE_URL=https://api.moysklad.ru/api/remap/1.2"
    echo "PUBLIC_URL=https://shop.example.uz"
    echo "TELEGRAM_BOT_TOKEN="
    echo "TELEGRAM_BOT_USERNAME="
    echo "TMA_DEV_MODE=false"
  fi
} > .env
chmod 600 .env
echo "Created deploy/.env"
echo "Admin login:  owner@shop.local   /   $ADMIN_PASS   (change it in /admin -> Система)"
