#!/usr/bin/env bash
set -Eeuo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/atlas}"
TIMESTAMP="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
DESTINATION="${BACKUP_ROOT}/postgres"
ARCHIVE="${DESTINATION}/atlas-${TIMESTAMP}.dump"

umask 077
mkdir -p "${DESTINATION}"

pg_dump \
  --dbname="${BACKUP_DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="${ARCHIVE}"

sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256"
printf '%s\n' "${ARCHIVE}"
