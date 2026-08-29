#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"

for command_name in node corepack docker; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
done

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

corepack enable
corepack prepare pnpm@11.24.0 --activate

pnpm install
pnpm infra:up
pnpm db:migration:run

cat <<'EOF'

Atlas local environment is ready.

Start applications:
  pnpm dev

Endpoints:
  Admin Web      http://localhost:3000
  API            http://localhost:4000/api
  Swagger        http://localhost:4000/api/docs
  MinIO Console  http://localhost:9001
EOF
