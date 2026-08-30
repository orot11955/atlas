#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/atlas}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-35}"

if ! [[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]] || (( BACKUP_RETENTION_DAYS < 1 )); then
  echo 'BACKUP_RETENTION_DAYS must be a positive integer.' >&2
  exit 1
fi

find "${BACKUP_ROOT}/postgres" -maxdepth 1 -type f \
  \( -name 'atlas-*.dump' -o -name 'atlas-*.dump.sha256' \) \
  -mtime "+${BACKUP_RETENTION_DAYS}" -delete 2>/dev/null || true
find "${BACKUP_ROOT}/minio" -mindepth 1 -maxdepth 1 -type d \
  -mtime "+${BACKUP_RETENTION_DAYS}" -exec rm -rf -- {} + 2>/dev/null || true
