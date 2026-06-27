#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env.local ]; then
  cp .env.example .env.local
fi

pnpm install
docker compose up -d educlaw-postgres
pnpm --filter @educlaw/shared build
