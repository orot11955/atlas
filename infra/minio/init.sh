#!/bin/sh
set -eu

alias_name="atlas"
endpoint="http://minio:9000"

until mc alias set "${alias_name}" "${endpoint}" \
  "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null 2>&1; do
  echo "Waiting for MinIO..."
  sleep 2
done

mc mb --ignore-existing "${alias_name}/atlas-private"
mc mb --ignore-existing "${alias_name}/atlas-processing"
mc mb --ignore-existing "${alias_name}/atlas-public"

if ! mc admin policy info "${alias_name}" atlas-api >/dev/null 2>&1; then
  mc admin policy create \
    "${alias_name}" \
    atlas-api \
    /opt/atlas/policies/atlas-api.json
fi

if ! mc admin policy info "${alias_name}" atlas-worker >/dev/null 2>&1; then
  mc admin policy create \
    "${alias_name}" \
    atlas-worker \
    /opt/atlas/policies/atlas-worker.json
fi

if ! mc admin user info "${alias_name}" "${MINIO_API_ACCESS_KEY}" >/dev/null 2>&1; then
  mc admin user add \
    "${alias_name}" \
    "${MINIO_API_ACCESS_KEY}" \
    "${MINIO_API_SECRET_KEY}"
fi

if ! mc admin user info "${alias_name}" "${MINIO_WORKER_ACCESS_KEY}" >/dev/null 2>&1; then
  mc admin user add \
    "${alias_name}" \
    "${MINIO_WORKER_ACCESS_KEY}" \
    "${MINIO_WORKER_SECRET_KEY}"
fi

mc admin policy attach \
  "${alias_name}" \
  atlas-api \
  --user "${MINIO_API_ACCESS_KEY}"

mc admin policy attach \
  "${alias_name}" \
  atlas-worker \
  --user "${MINIO_WORKER_ACCESS_KEY}"

mc anonymous set download "${alias_name}/atlas-public"

echo "MinIO buckets, users and policies are ready."
