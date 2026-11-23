#!/usr/bin/env bash
# Puts the Telegram bot token into the server settings without it ever appearing on screen, in chat or in the process list.
# Run it yourself, in your own terminal (it asks for the token from @BotFather):
#
#   ssh -t crm-server 'sudo bash /tmp/biznimarket-deploy/set-telegram.sh'
#
# It checks the token with Telegram (getMe), writes TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME to app.env and restarts the shop.
# Then: Admin panel -> Tizim -> "Botni sozlash" (webhook, the Mini App menu button, commands, descriptions).
set -euo pipefail
ENVF=/etc/biznimarket/app.env
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
[ -f "$ENVF" ] || { echo "no $ENVF" >&2; exit 1; }

read -rsp "Bot token (@BotFather), hidden: " TOKEN; echo
[[ "$TOKEN" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{30,}$ ]] || { echo "That does not look like a bot token (digits:letters)." >&2; exit 1; }

# The token goes to curl on stdin, never as an argument.
ME="$(printf 'url = "https://api.telegram.org/bot%s/getMe"\n' "$TOKEN" | curl -s --max-time 15 -K -)" || true
grep -q '"ok":true' <<<"$ME" || { echo "Telegram did not accept this token. Check it in @BotFather (/mybots -> API Token)." >&2; exit 1; }
USERNAME="$(sed -n 's/.*"username":"\([^"]*\)".*/\1/p' <<<"$ME")"
[ -n "$USERNAME" ] || { echo "Telegram answered without a username." >&2; exit 1; }

cp -a "$ENVF" "$ENVF.bak-$(date +%F-%H%M%S)"
set_key() { if grep -q "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$2|" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi; }
set_key TELEGRAM_BOT_TOKEN "$TOKEN"
set_key TELEGRAM_BOT_USERNAME "$USERNAME"
unset TOKEN ME

systemctl restart biznimarket-api
for _ in $(seq 1 60); do curl -fs -o /dev/null --max-time 3 http://127.0.0.1:4101/ready && break; sleep 1; done
systemctl restart biznimarket-worker biznimarket-web
echo "Saved: bot @$USERNAME. Shop restarted."
echo "Next: Admin panel -> Tizim -> \"Botni sozlash\", then open @$USERNAME in Telegram and press the menu button."
