#!/usr/bin/env bash
# Nightly backup (cron: 0 2 * * * /path/to/deploy/backup.sh). Keeps 14 days.
# Database dump AND the photo folder: photos uploaded in the admin exist only here (MoySklad photos could be re-downloaded, uploads cannot).
set -euo pipefail
cd "$(dirname "$0")"
DEST="${BACKUP_DIR:-./backups}"; mkdir -p "$DEST"
FILE="$DEST/shop-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose --env-file .env -f docker-compose.yml exec -T postgres pg_dump -U shop -d shop --no-owner | gzip > "$FILE"
MEDIA="$DEST/media-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose --env-file .env -f docker-compose.yml exec -T api tar -czf - -C /data media > "$MEDIA"
find "$DEST" \( -name 'shop-*.sql.gz' -o -name 'media-*.tar.gz' \) -mtime +14 -delete
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1)), $MEDIA ($(du -h "$MEDIA" | cut -f1))"
