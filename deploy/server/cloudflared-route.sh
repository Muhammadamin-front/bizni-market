#!/usr/bin/env bash
# Adds the Bizni Market hostname to the EXISTING Cloudflare Tunnel config, safely. Run as root (sudo).
#
#   sudo ./cloudflared-route.sh biznimarket.vocora.uz          show what would change (no changes)
#   sudo ./cloudflared-route.sh biznimarket.vocora.uz --apply  backup, insert, validate, restart, re-check the CRM
#
# The rule goes right before the final catch-all (`service: http_status:404`); the CRM's rules are left exactly as they are.
# If validation fails, the backup is restored and cloudflared is not restarted.
# DNS is separate: CNAME <name> -> <tunnel-id>.cfargotunnel.com, proxied (Cloudflare panel, or `cloudflared tunnel route dns`).
set -euo pipefail
HOST="${1:?usage: cloudflared-route.sh <hostname> [--apply]}"
APPLY="${2:-}"
CONF=/etc/cloudflared/config.yml
TARGET=http://127.0.0.1:4100
CRM_HEALTH=https://crm.vocora.uz/api/health
# The unit that runs the tunnel (cloudflared-tunnel on the office host; plain cloudflared elsewhere).
SVC="${CF_SERVICE:-$(systemctl list-units --type=service --all --no-legend 'cloudflared*' | awk '{print $1}' | grep -E '^cloudflared(-tunnel)?\.service$' | head -1)}"
[ -n "$SVC" ] || { echo "no cloudflared service found; set CF_SERVICE" >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
[ -f "$CONF" ] || { echo "no $CONF" >&2; exit 1; }

if grep -Eq "hostname:\s*$HOST\s*$" "$CONF"; then echo "$HOST is already in $CONF - nothing to do."; exit 0; fi
n_catch="$(grep -cE '^\s*-\s*service:\s*http_status:404\s*$' "$CONF" || true)"
[ "$n_catch" = 1 ] || { echo "expected exactly one catch-all 'service: http_status:404' in $CONF, found $n_catch - edit by hand." >&2; exit 1; }

NEW="$(mktemp)"
trap 'rm -f "$NEW"' EXIT
awk -v host="$HOST" -v target="$TARGET" '
  /^[[:space:]]*-[[:space:]]*service:[[:space:]]*http_status:404[[:space:]]*$/ && !done {
    match($0, /^[[:space:]]*/); ind = substr($0, 1, RLENGTH)
    print ind "- hostname: " host
    print ind "  service: " target
    done = 1
  }
  { print }
' "$CONF" > "$NEW"

echo "--- change to $CONF:"
diff -u "$CONF" "$NEW" || true
[ "$APPLY" = "--apply" ] || { echo "(dry run - add --apply to make it)"; exit 0; }

BAK="$CONF.bak-$(date +%F-%H%M%S)"
cp -a "$CONF" "$BAK"
cat "$NEW" > "$CONF"
if ! cloudflared tunnel --config "$CONF" ingress validate; then
  cp -a "$BAK" "$CONF"
  echo "validation FAILED - original restored from $BAK, $SVC not restarted." >&2
  exit 1
fi
cloudflared tunnel --config "$CONF" ingress rule "https://$HOST/" || true
systemctl restart "$SVC"
sleep 5
systemctl is-active --quiet "$SVC" || { echo "cloudflared is not running after restart! restore: cp -a $BAK $CONF && systemctl restart $SVC" >&2; exit 1; }
echo "CRM check: $(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$CRM_HEALTH") (must be 200)"
echo "backup of the old config: $BAK"
