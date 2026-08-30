#!/usr/bin/env bash
set -Eeuo pipefail

: "${RESTORE_TEST_DATABASE_URL:?RESTORE_TEST_DATABASE_URL is required}"
ARCHIVE="${1:?Usage: postgres-restore-test.sh <archive.dump>}"

if [[ ! -f "${ARCHIVE}" ]]; then
  echo "Archive not found: ${ARCHIVE}" >&2
  exit 1
fi

if [[ -f "${ARCHIVE}.sha256" ]]; then
  sha256sum --check "${ARCHIVE}.sha256"
fi

DATABASE_NAME="atlas_restore_test_$(date -u +%Y%m%d%H%M%S)_${RANDOM}"
TARGET_DATABASE_URL="$({ node - "${RESTORE_TEST_DATABASE_URL}" "${DATABASE_NAME}" <<'NODE'
const value = new URL(process.argv[2]);
value.pathname = `/${process.argv[3]}`;
process.stdout.write(value.toString());
NODE
} 2>/dev/null)"

cleanup() {
  psql "${RESTORE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DATABASE_NAME}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  psql "${RESTORE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"${DATABASE_NAME}\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql "${RESTORE_TEST_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"${DATABASE_NAME}\";" >/dev/null
pg_restore --dbname="${TARGET_DATABASE_URL}" --no-owner --no-acl --exit-on-error "${ARCHIVE}"

psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -Atc \
  "SELECT CASE WHEN to_regclass('public.atlas_migrations') IS NOT NULL THEN 1 ELSE 0 END;" \
  | grep -qx '1'
psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -Atc \
  "SELECT CASE WHEN to_regclass('public.resources') IS NOT NULL THEN 1 ELSE 0 END;" \
  | grep -qx '1'
psql "${TARGET_DATABASE_URL}" -v ON_ERROR_STOP=1 -Atc \
  "SELECT CASE WHEN to_regclass('public.members') IS NOT NULL THEN 1 ELSE 0 END;" \
  | grep -qx '1'

echo "Restore validation succeeded for ${ARCHIVE}."
