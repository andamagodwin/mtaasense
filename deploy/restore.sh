#!/usr/bin/env bash
# Restore a backup made by backup.sh. DESTRUCTIVE: replaces the current database and media.
#   ./restore.sh /var/backups/mtaasense/db-20261030T021500Z.dump /var/backups/mtaasense/media-20261030T021500Z.tar.gz
set -euo pipefail

cd "$(dirname "$0")"
DB_DUMP="${1:?path to db-*.dump}"
MEDIA_TAR="${2:?path to media-*.tar.gz}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

read -r -p "This replaces the live database and media with $DB_DUMP. Type 'restore' to continue: " answer
[ "$answer" = "restore" ] || { echo "aborted"; exit 1; }

"${COMPOSE[@]}" stop api worker
"${COMPOSE[@]}" exec -T db dropdb -U mtaasense --if-exists mtaasense
"${COMPOSE[@]}" exec -T db createdb -U mtaasense mtaasense
"${COMPOSE[@]}" exec -T db pg_restore -U mtaasense -d mtaasense --no-owner < "$DB_DUMP"
"${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/media/* && tar -C /data -xzf -' < "$MEDIA_TAR"
"${COMPOSE[@]}" up -d api worker
echo "restore complete — check: curl -fsS https://\$API_DOMAIN/ready"
