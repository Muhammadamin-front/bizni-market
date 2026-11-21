#!/usr/bin/env bash
# Bizni Market on a shared Ubuntu 24.04 host, without Docker, behind Cloudflare Tunnel. Run as root (sudo). Idempotent.
#
#   sudo ./install.sh stores  [--domain biznimarket.vocora.uz]   PostgreSQL + Redis (apt), app.env, database role
#   sudo ./install.sh release <biznimarket-<commit>-<arch>.tar.gz> install a release, switch to it, (re)start, health check
#   sudo ./install.sh check                                      health of our services (read-only)
#
# Rules of the host (shared with a CRM): we never touch the CRM's user, folders, service, port 4000 or its backup; we listen on
# 127.0.0.1 only; we do not touch ufw, SSH or the router. Secrets are never printed: the first admin password is written to a
# root-only file that the owner reads in their own terminal.
set -euo pipefail
umask 027

APP=biznimarket
BASE=/srv/$APP
ETC=/etc/$APP
ENVF=$ETC/app.env
WEB_PORT=4100
API_PORT=4101
HERE="$(cd "$(dirname "$0")" && pwd)"

die() { echo "ERROR: $*" >&2; exit 1; }
say() { echo "==> $*"; }
[ "$(id -u)" = 0 ] || die "run with sudo"

port_owner() { ss -ltnpH "( sport = :$1 )" 2>/dev/null | sed -n 's/.*users:((\"\([^\"]*\)\".*/\1/p' | head -1; }
check_ports() {
  for p in $WEB_PORT $API_PORT; do
    local who; who="$(port_owner "$p")"
    if [ -n "$who" ] && ! systemctl is-active --quiet "$APP-web" && ! systemctl is-active --quiet "$APP-api"; then
      die "port $p is already used by '$who'. Pick other ports (WEB_PORT/API_PORT here, in the web unit and the release build)."
    fi
  done
}

env_get() { sed -n "s/^$1=//p" "$ENVF" | tail -1; }
rand_hex() { openssl rand -hex "$1"; }

ensure_user() {
  if ! id "$APP" >/dev/null 2>&1; then
    useradd --system --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin "$APP"
    say "system user $APP created (no login)"
  fi
  install -d -o root -g root -m 0755 "$BASE" "$BASE/releases" "$BASE/bin"
  install -d -o "$APP" -g "$APP" -m 0750 "$BASE/data" "$BASE/data/media"
  install -d -o root -g root -m 0700 "$BASE/backups"
  install -d -o root -g "$APP" -m 0750 "$ETC"
}

ensure_env() {
  local domain="$1"
  if [ -f "$ENVF" ]; then say "$ENVF exists - kept as is"; return; fi
  local admin_pw; admin_pw="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)-Bm7"
  {
    echo "# Bizni Market settings. Generated $(date -u +%FT%TZ) by install.sh. root:$APP 0640. Never paste this file anywhere."
    echo "NODE_ENV=production"
    echo "DATABASE_URL=postgres://$APP:$(rand_hex 24)@127.0.0.1:5432/$APP"
    echo "REDIS_URL=redis://:$(rand_hex 24)@127.0.0.1:6379/0"
    echo "API_HOST=127.0.0.1"
    echo "API_PORT=$API_PORT"
    echo "API_INTERNAL_URL=http://127.0.0.1:$API_PORT"
    echo "PUBLIC_URL=https://$domain"
    echo "MEDIA_DIR=$BASE/data/media"
    echo "SESSION_SECRET=$(rand_hex 32)"
    echo "REVALIDATE_SECRET=$(rand_hex 24)"
    echo "WEB_REVALIDATE_URL=http://127.0.0.1:$WEB_PORT/hooks/revalidate"
    echo "TELEGRAM_WEBHOOK_SECRET=$(rand_hex 24)"
    echo "MOYSKLAD_WEBHOOK_SECRET=$(rand_hex 24)"
    echo "# Empty = no MoySklad: the catalogue is managed in /admin."
    echo "MOYSKLAD_TOKEN="
    echo "MOYSKLAD_BASE_URL=https://api.moysklad.ru/api/remap/1.2"
    echo "TELEGRAM_BOT_TOKEN="
    echo "TELEGRAM_BOT_USERNAME="
    echo "TMA_DEV_MODE=false"
    echo "TRUST_PROXY=true"
    echo "# Real visitor address from Cloudflare (the app is reachable only through the tunnel)."
    echo "CLIENT_IP_HEADER=cf-connecting-ip"
    echo "LOG_LEVEL=info"
    echo "# First admin, created on the first start; install.sh blanks the password here once the admin exists."
    echo "ADMIN_EMAIL=admin@$domain"
    echo "ADMIN_PASSWORD=$admin_pw"
  } > "$ENVF"
  chown root:"$APP" "$ENVF"
  chmod 0640 "$ENVF"
  ( umask 077; printf 'Bizni Market admin\n  login:    admin@%s\n  password: %s\nChange it in /admin -> Tizim, then delete this file: sudo rm %s\n' "$domain" "$admin_pw" "$ETC/admin-initial-password" > "$ETC/admin-initial-password" )
  chown root:root "$ETC/admin-initial-password"
  say "$ENVF written (secrets not shown). First admin password: sudo cat $ETC/admin-initial-password"
}

cmd_stores() {
  local domain="biznimarket.vocora.uz"
  [ "${1:-}" = "--domain" ] && domain="${2:?--domain needs a value}"
  check_ports
  ensure_user
  ensure_env "$domain"

  local had_redis=0 had_pg=0
  dpkg -s redis-server >/dev/null 2>&1 && had_redis=1
  dpkg -s postgresql >/dev/null 2>&1 && had_pg=1
  if [ $had_redis = 0 ] || [ $had_pg = 0 ]; then
    say "apt install postgresql redis-server (only what is missing)"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql redis-server >/dev/null
  fi

  # Redis: loopback only, never evict queued jobs, persist them, our password. Only on a Redis we installed ourselves.
  local rconf=/etc/redis/redis.conf
  if ! grep -q '^# >>> biznimarket' "$rconf"; then
    if [ $had_redis = 1 ]; then die "Redis was already installed before us: not changing its config. Ask the server owner."; fi
    grep -Eq '^bind 127\.0\.0\.1( -?::1)?\s*$' "$rconf" || die "Redis is not bound to loopback only in $rconf - stopping."
    cp -a "$rconf" "$rconf.bak-$(date +%F-%H%M%S)"
    local rpw; rpw="$(env_get REDIS_URL | sed -n 's#^redis://:\([^@]*\)@.*#\1#p')"
    [ -n "$rpw" ] || die "REDIS_URL in $ENVF has no password"
    {
      echo "# >>> biznimarket (added by install.sh)"
      echo "maxmemory 256mb"
      echo "maxmemory-policy noeviction"
      echo "appendonly yes"
      echo "requirepass $rpw"
      echo "# <<< biznimarket"
    } >> "$rconf"
    systemctl restart redis-server
    say "Redis configured (loopback, noeviction, appendonly, password)"
  fi
  systemctl enable --now --quiet redis-server postgresql
  for _ in $(seq 1 30); do pg_isready -q -h /var/run/postgresql && break; sleep 1; done
  pg_isready -q -h /var/run/postgresql || die "PostgreSQL did not start (journalctl -u postgresql)"

  # PostgreSQL: our own role and database; the server-wide config is not touched (Ubuntu listens on localhost by default).
  local dbpw; dbpw="$(env_get DATABASE_URL | sed -n "s#^postgres://$APP:\([^@]*\)@.*#\1#p")"
  [ -n "$dbpw" ] || die "DATABASE_URL in $ENVF has no password"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qX >/dev/null <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$APP') THEN
    CREATE ROLE $APP LOGIN PASSWORD '$dbpw';
  ELSE
    ALTER ROLE $APP LOGIN PASSWORD '$dbpw';
  END IF;
END \$\$;
SQL
  if ! runuser -u postgres -- psql -qXtAc "SELECT 1 FROM pg_database WHERE datname = '$APP'" | grep -q 1; then
    runuser -u postgres -- createdb -O "$APP" "$APP"
  fi
  say "PostgreSQL $(runuser -u postgres -- psql -qXtAc 'SHOW server_version' | cut -d' ' -f1): role and database '$APP' ready"
}

cmd_release() {
  local tarball="${1:?usage: install.sh release <tarball>}"
  [ -f "$ENVF" ] || die "run 'install.sh stores' first"
  [ -f "$tarball" ] || die "no such file: $tarball"
  if [ -f "$tarball.sha256" ]; then
    (cd "$(dirname "$tarball")" && sha256sum -c --quiet "$(basename "$tarball").sha256") || die "checksum mismatch"
  fi
  local name; name="$(basename "$tarball" .tar.gz)"
  local rel="$BASE/releases/$name"
  check_ports
  ensure_user

  if [ ! -d "$rel" ]; then
    rm -rf "$rel.tmp" && mkdir -p "$rel.tmp"
    tar -xzf "$tarball" -C "$rel.tmp" --no-same-owner
    local arch want_port; arch="$(sed -n 's/^arch=//p' "$rel.tmp/VERSION")"; want_port="$(sed -n 's/^api_port=//p' "$rel.tmp/VERSION")"
    [ "$arch" = "$(uname -m)" ] || { rm -rf "$rel.tmp"; die "release is for $arch, this host is $(uname -m)"; }
    [ "$want_port" = "$(env_get API_PORT)" ] || { rm -rf "$rel.tmp"; die "release was built for API port $want_port, app.env has $(env_get API_PORT)"; }
    # The release stays read-only (the web build keeps revalidated pages in memory; see build-release.sh).
    chown -R root:root "$rel.tmp" && chmod -R go-w "$rel.tmp"
    mv "$rel.tmp" "$rel"
    say "release $name unpacked"
  fi
  "$rel/bin/node" -e 'process.exit(0)' || die "bundled node does not run on this host"

  install -o root -g root -m 0755 "$HERE/backup.sh" "$BASE/bin/backup.sh"
  for u in "$HERE"/units/*; do install -o root -g root -m 0644 "$u" "/etc/systemd/system/$(basename "$u")"; done
  systemctl daemon-reload

  local prev=""; [ -L "$BASE/app" ] && prev="$(readlink "$BASE/app")"
  ln -sfn "$rel" "$BASE/app.new" && mv -Tf "$BASE/app.new" "$BASE/app"
  say "current release -> $name${prev:+ (was $(basename "$prev"))}"

  systemctl enable --quiet $APP-api $APP-worker $APP-web $APP-backup.timer
  systemctl restart $APP-api
  wait_http "http://127.0.0.1:$API_PORT/ready" 90 || { journalctl -u $APP-api -n 40 --no-pager; die "API did not become ready"; }
  systemctl restart $APP-worker $APP-web
  systemctl start $APP-backup.timer
  wait_http "http://127.0.0.1:$WEB_PORT/robots.txt" 60 || { journalctl -u $APP-web -n 40 --no-pager; die "web did not start"; }

  # The first admin exists now: the plain password no longer needs to sit in app.env.
  if runuser -u postgres -- psql -qXtAd "$APP" -c "SELECT count(*) FROM admin_users" 2>/dev/null | grep -qv '^0$'; then
    sed -i 's/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=/' "$ENVF"
  fi

  # Keep the three newest releases.
  ls -1dt "$BASE"/releases/*/ 2>/dev/null | tail -n +4 | while read -r old; do
    [ "$(readlink -f "$BASE/app")" = "$(readlink -f "$old")" ] && continue
    rm -rf "$old"
  done
  cmd_check
}

wait_http() { local url="$1" secs="$2"; for _ in $(seq 1 "$secs"); do curl -fs -o /dev/null --max-time 3 "$url" && return 0; sleep 1; done; return 1; }

cmd_check() {
  local ok=1
  for s in $APP-api $APP-worker $APP-web; do printf '%-22s %s\n' "$s" "$(systemctl is-active $s)"; systemctl is-active --quiet $s || ok=0; done
  printf '%-22s %s\n' "backup timer" "$(systemctl is-active $APP-backup.timer) (next: $(systemctl show $APP-backup.timer -p NextElapseUSecRealtime --value))"
  curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$API_PORT/ready" && echo "api ready: yes" || { echo "api ready: NO"; ok=0; }
  curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$WEB_PORT/uz" && echo "site /uz: yes" || { echo "site /uz: NO"; ok=0; }
  echo "listening (ours):"; ss -ltnH "( sport = :$WEB_PORT or sport = :$API_PORT )" | awk '{print "  " $4}'
  ss -ltnH "( sport = :$WEB_PORT or sport = :$API_PORT )" | awk '{print $4}' | grep -qvE '^(127\.0\.0\.1|\[::1\]):' && { echo "WARNING: something of ours listens beyond loopback"; ok=0; }
  [ $ok = 1 ] && echo "ALL OK" || { echo "PROBLEMS - see above"; return 1; }
}

case "${1:-}" in
  stores) shift; cmd_stores "$@" ;;
  release) shift; cmd_release "$@" ;;
  check) cmd_check ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
