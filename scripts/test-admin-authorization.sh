#!/bin/bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/src/api-preflight.sh"
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/src/isolated-admin-fixture.sh"
resolve_api_base_url
check_api_server
require_isolated_admin_fixture_dependencies

DEMO_PASSWORD="${LUMERA_DEMO_PASSWORD:-LumeraDemo2026!}"
SUPER_COOKIE="$(mktemp)"
LIMITED_COOKIE="$(mktemp)"
BODY="$(mktemp)"
RUN_ID="${LUMERA_ADMIN_AUTHZ_TEST_ID:-$(date +%s%N)}"
ISOLATED_ADMIN_EMAIL=""
ISOLATED_ADMIN_ID=""

cleanup() {
  remove_isolated_admin_fixture || true
  rm -f "$SUPER_COOKIE" "$LIMITED_COOKIE" "$BODY"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

expect_status() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label expected $expected, got $actual: $(cat "$BODY")" >&2
    exit 1
  fi
  echo "PASS: $label -> $actual"
}

status="$(curl -sS -o "$BODY" -w "%{http_code}" -c "$SUPER_COOKIE" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"admin@lumera.local\",\"password\":\"$DEMO_PASSWORD\"}" \
  "$BASE_URL/auth/login")"
expect_status 200 "$status" "SUPER_ADMIN login"

create_isolated_admin_fixture "$RUN_ID"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -c "$LIMITED_COOKIE" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"$ISOLATED_ADMIN_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}" \
  "$BASE_URL/auth/login")"
expect_status 200 "$status" "ADMIN login"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" "$BASE_URL/admin/users")"
expect_status 200 "$status" "ADMIN read access"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{"role":"SUPER_ADMIN"}' \
  "$BASE_URL/admin/users/$ISOLATED_ADMIN_ID")"
expect_status 403 "$status" "ADMIN self-promotion blocked"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{"active":false}' \
  "$BASE_URL/admin/users/$ISOLATED_ADMIN_ID")"
expect_status 403 "$status" "ADMIN account-status mutation blocked"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data '{}' \
  "$BASE_URL/admin/loyalty-tiers")"
expect_status 403 "$status" "ADMIN loyalty configuration blocked"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{}' \
  "$BASE_URL/admin/loyalty-tiers/not-a-uuid")"
expect_status 403 "$status" "ADMIN loyalty update blocked before validation"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X DELETE \
  "$BASE_URL/admin/loyalty-tiers/not-a-uuid")"
expect_status 403 "$status" "ADMIN loyalty deletion blocked"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data '{}' \
  "$BASE_URL/admin/subscription-plans")"
expect_status 403 "$status" "ADMIN subscription configuration blocked"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{}' \
  "$BASE_URL/admin/subscription-plans/not-a-uuid")"
expect_status 403 "$status" "ADMIN subscription update blocked before validation"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X DELETE \
  "$BASE_URL/admin/subscription-plans/not-a-uuid")"
expect_status 403 "$status" "ADMIN subscription deletion blocked"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$SUPER_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{"active":false}' \
  "$BASE_URL/admin/users/$ISOLATED_ADMIN_ID")"
expect_status 200 "$status" "SUPER_ADMIN deactivates account"

status="$(curl -sS -o "$BODY" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"$ISOLATED_ADMIN_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}" \
  "$BASE_URL/auth/login")"
expect_status 401 "$status" "inactive account login blocked"

remove_isolated_admin_fixture
verify_isolated_admin_fixture_removed
verify_education_demo_invariant
ISOLATED_ADMIN_EMAIL=""
echo "Admin authorization checks passed."