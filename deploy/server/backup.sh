#!/usr/bin/env bash
# Daily Bizni Market backup, run by biznimarket-backup.timer as root: database dump + the photo folder (uploaded photos exist only here).
# Keeps 14 days in /srv/biznimarket/backups (root-only). Separate from the CRM's backup, which does not cover this app.
# Restore (as root; stop api + worker first: systemctl stop biznimarket-api biznimarket-worker):
#   runuser -u postgres -- pg_restore -d biznimarket --clean --if-exists --no-owner < db-<ts>.dump
#   tar -xzf media-<ts>.tar.gz -C /srv/biznimarket/data && chown -R biznimarket:biznimarket /srv/biznimarket/data/media
# Drill (does not touch the live data): createdb restore_drill, pg_restore into it, count rows, dropdb. Done 2026-11-14 in rehearsal.
set -euo pipefail
umask 077
DIR=/srv/biznimarket/backups
ENVF=/etc/biznimarket/app.env
TS="$(date +%F-%H%M)"
url="$(sed -n 's/^DATABASE_URL=//p' "$ENVF" | tail -1)"
# Password goes through the environment, not the command line.
export PGPASSWORD="$(printf '%s' "$url" | sed -n 's#^postgres://[^:]*:\([^@]*\)@.*#\1#p')"
pg_dump -Fc -h 127.0.0.1 -U biznimarket -d biznimarket -f "$DIR/db-$TS.dump"
tar -czf "$DIR/media-$TS.tar.gz" -C /srv/biznimarket/data media
find "$DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'media-*.tar.gz' \) -mtime +14 -delete
echo "backup ok: db-$TS.dump ($(du -h "$DIR/db-$TS.dump" | cut -f1)), media-$TS.tar.gz ($(du -h "$DIR/media-$TS.tar.gz" | cut -f1))"
