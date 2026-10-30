#!/usr/bin/env bash
# Nightly backup: PostgreSQL (custom-format dump) + uploaded media (tar.gz).
#   crontab -e  →  15 2 * * * /opt/mtaasense/deploy/backup.sh >> /var/log/mtaasense-backup.log 2>&1
# Copy BACKUP_DIR off the server (e.g. rclone to object storage) — a backup on the same disk is not a backup.
set -euo pipefail

cd "$(dirname "$0")"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mtaasense}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

"${COMPOSE[@]}" exec -T db pg_dump -U mtaasense -d mtaasense -Fc --no-owner > "$BACKUP_DIR/db-$STAMP.dump"
"${COMPOSE[@]}" exec -T api tar -C /data -czf - media > "$BACKUP_DIR/media-$STAMP.tar.gz"

# Verify the dump is readable before pruning old ones.
"${COMPOSE[@]}" exec -T db pg_restore --list < "$BACKUP_DIR/db-$STAMP.dump" > /dev/null

find "$BACKUP_DIR" -type f \( -name 'db-*.dump' -o -name 'media-*.tar.gz' \) -mtime "+$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: db-$STAMP.dump media-$STAMP.tar.gz"
