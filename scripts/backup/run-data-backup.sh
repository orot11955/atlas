#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
export BACKUP_TIMESTAMP="${TIMESTAMP}"

"${SCRIPT_DIR}/postgres-backup.sh"
"${SCRIPT_DIR}/minio-backup.sh"
"${SCRIPT_DIR}/prune-backups.sh"
