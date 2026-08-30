#!/usr/bin/env bash
set -Eeuo pipefail

: "${BACKUP_MINIO_ENDPOINT:?BACKUP_MINIO_ENDPOINT is required}"
: "${BACKUP_MINIO_ACCESS_KEY:?BACKUP_MINIO_ACCESS_KEY is required}"
: "${BACKUP_MINIO_SECRET_KEY:?BACKUP_MINIO_SECRET_KEY is required}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/atlas}"
TIMESTAMP="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
DESTINATION="${BACKUP_ROOT}/minio/${TIMESTAMP}"
ALIAS="atlas-backup-${RANDOM}"
BUCKETS=(
  "${MINIO_PRIVATE_BUCKET:-atlas-private}"
  "${MINIO_PROCESSING_BUCKET:-atlas-processing}"
  "${MINIO_PUBLIC_BUCKET:-atlas-public}"
)

command -v mc >/dev/null 2>&1 || {
  echo 'MinIO Client (mc) is required.' >&2
  exit 1
}

umask 077
mkdir -p "${DESTINATION}"
mc alias set "${ALIAS}" "${BACKUP_MINIO_ENDPOINT}" \
  "${BACKUP_MINIO_ACCESS_KEY}" "${BACKUP_MINIO_SECRET_KEY}" >/dev/null
trap 'mc alias remove "${ALIAS}" >/dev/null 2>&1 || true' EXIT

for bucket in "${BUCKETS[@]}"; do
  mkdir -p "${DESTINATION}/${bucket}"
  mc mirror --overwrite --preserve "${ALIAS}/${bucket}" "${DESTINATION}/${bucket}"
done

find "${DESTINATION}" -type f -print0 | sort -z | xargs -0 sha256sum > "${DESTINATION}/SHA256SUMS"
printf '%s\n' "${DESTINATION}"
