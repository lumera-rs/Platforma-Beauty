#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DB_DIST_DIR="$ROOT_DIR/lib/db/dist"
API_ZOD_DIST_DIR="$ROOT_DIR/lib/api-zod/dist"
DB_DECLARATIONS="$DB_DIST_DIR/index.d.ts"
DB_SCHEMA_DECLARATIONS="$DB_DIST_DIR/schema/index.d.ts"
DB_CORE_DECLARATIONS="$DB_DIST_DIR/schema/core.d.ts"
ZOD_DECLARATIONS="$API_ZOD_DIST_DIR/generated/api.d.ts"

restore_generated_declarations() {
  local exit_code=$?
  trap - EXIT

  if [[ ! -f "$DB_DECLARATIONS" || ! -f "$DB_SCHEMA_DECLARATIONS" || ! -f "$ZOD_DECLARATIONS" ]]; then
    echo "Restoring API server declarations for subsequent workspace checks..."
    if ! (cd "$ROOT_DIR" && pnpm -w exec tsc --build --force lib/db lib/api-zod); then
      echo "Failed to restore API server declarations." >&2
      if [[ "$exit_code" -eq 0 ]]; then
        exit_code=1
      fi
    fi
  fi

  exit "$exit_code"
}
trap restore_generated_declarations EXIT

rm -rf "$DB_DIST_DIR" "$API_ZOD_DIST_DIR"
if [[ -e "$DB_DIST_DIR" || -e "$API_ZOD_DIST_DIR" ]]; then
  echo "Expected API server declaration outputs to be absent before validation." >&2
  exit 1
fi

(
  cd "$ROOT_DIR"
  pnpm --filter @workspace/api-server run typecheck
)

[[ -f "$DB_DECLARATIONS" ]] || { echo "API server typecheck did not rebuild database declarations." >&2; exit 1; }
[[ -f "$DB_SCHEMA_DECLARATIONS" ]] || { echo "API server typecheck did not rebuild database schema declarations." >&2; exit 1; }
[[ -f "$DB_CORE_DECLARATIONS" ]] || { echo "API server typecheck did not rebuild core database schema declarations." >&2; exit 1; }
[[ -f "$ZOD_DECLARATIONS" ]] || { echo "API server typecheck did not rebuild generated Zod declarations." >&2; exit 1; }

require_declaration() {
  local declaration_file="$1"
  local symbol="$2"

  if ! grep -qF "$symbol" "$declaration_file"; then
    echo "Missing generated declaration: $symbol" >&2
    exit 1
  fi
}

require_declaration "$DB_DECLARATIONS" "export declare const pool"
require_declaration "$DB_CORE_DECLARATIONS" "salonsTable"
require_declaration "$ZOD_DECLARATIONS" "HealthCheckResponse"

echo "API server standalone typecheck rebuilt and verified database and generated Zod declarations."