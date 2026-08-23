#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIST_DIR="$ROOT_DIR/lib/api-client-react/dist"
API_DECLARATIONS="$CLIENT_DIST_DIR/generated/api.d.ts"
SCHEMA_DECLARATIONS="$CLIENT_DIST_DIR/generated/api.schemas.d.ts"

restore_generated_declarations() {
  local exit_code=$?
  trap - EXIT

  if [[ ! -f "$API_DECLARATIONS" || ! -f "$SCHEMA_DECLARATIONS" ]]; then
    echo "Restoring shared API declarations for subsequent workspace checks..."
    if ! (cd "$ROOT_DIR" && pnpm -w exec tsc --build --force lib/api-client-react); then
      echo "Failed to restore shared API declarations." >&2
      if [[ "$exit_code" -eq 0 ]]; then
        exit_code=1
      fi
    fi
  fi

  exit "$exit_code"
}
trap restore_generated_declarations EXIT

rm -rf "$CLIENT_DIST_DIR"
if [[ -e "$CLIENT_DIST_DIR" ]]; then
  echo "Expected shared API declarations to be absent before validation." >&2
  exit 1
fi

(
  cd "$ROOT_DIR"
  pnpm --filter @workspace/beauty-marketplace run typecheck
)

require_declaration() {
  local declaration_file="$1"
  local symbol="$2"

  if ! grep -qF "$symbol" "$declaration_file"; then
    echo "Missing generated declaration: $symbol" >&2
    exit 1
  fi
}

[[ -f "$API_DECLARATIONS" ]] || { echo "Marketplace typecheck did not rebuild API declarations." >&2; exit 1; }
[[ -f "$SCHEMA_DECLARATIONS" ]] || { echo "Marketplace typecheck did not rebuild API schema declarations." >&2; exit 1; }

require_declaration "$API_DECLARATIONS" "useListPublicProducts"
require_declaration "$API_DECLARATIONS" "useGetPublicProduct"
require_declaration "$SCHEMA_DECLARATIONS" "retailEnabled"
require_declaration "$SCHEMA_DECLARATIONS" "professionalEnabled"
require_declaration "$SCHEMA_DECLARATIONS" "publicDescription"
require_declaration "$SCHEMA_DECLARATIONS" "publicPrice"
require_declaration "$SCHEMA_DECLARATIONS" "publicDiscountPrice"

echo "Marketplace standalone typecheck rebuilt and verified shared API declarations."