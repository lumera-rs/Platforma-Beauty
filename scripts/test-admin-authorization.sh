#!/bin/bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/src/api-preflight.sh"
resolve_api_base_url
check_api_server

DEMO_PASSWORD="${LUMERA_DEMO_PASSWORD:-LumeraDemo2026!}"
SUPER_COOKIE="$(mktemp)"
LIMITED_COOKIE="$(mktemp)"
BODY="$(mktemp)"
TARGET_ID=""
ORIGINAL_ROLE=""
ORIGINAL_ACTIVE=""

restore_target() {
  if [[ -n "$TARGET_ID" && -n "$ORIGINAL_ROLE" && -n "$ORIGINAL_ACTIVE" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X PATCH \
      -H "Content-Type: application/json" \
      --data "{\"role\":\"$ORIGINAL_ROLE\",\"active\":$ORIGINAL_ACTIVE}" \
      "$BASE_URL/admin/users/$TARGET_ID" || true
  fi
}

cleanup() {
  restore_target
  rm -f "$SUPER_COOKIE" "$LIMITED_COOKIE" "$BODY"
}
trap cleanup EXIT

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

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$SUPER_COOKIE" "$BASE_URL/admin/users?search=edukacija%40lumera.local&page=1&pageSize=100")"
expect_status 200 "$status" "SUPER_ADMIN user list"

TARGET_ID="$(node -e 'const body=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const users=Array.isArray(body)?body:body.items; const user=users.find((item)=>item.email==="edukacija@lumera.local"); if(!user) process.exit(1); process.stdout.write(user.id)' "$BODY")"
ORIGINAL_ROLE="$(node -e 'const body=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const users=Array.isArray(body)?body:body.items; process.stdout.write(users.find((item)=>item.email==="edukacija@lumera.local").role)' "$BODY")"
ORIGINAL_ACTIVE="$(node -e 'const body=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const users=Array.isArray(body)?body:body.items; process.stdout.write(String(users.find((item)=>item.email==="edukacija@lumera.local").active))' "$BODY")"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$SUPER_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{"role":"ADMIN","active":true}' \
  "$BASE_URL/admin/users/$TARGET_ID")"
expect_status 200 "$status" "SUPER_ADMIN assigns ADMIN role"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -c "$LIMITED_COOKIE" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"edukacija@lumera.local\",\"password\":\"$DEMO_PASSWORD\"}" \
  "$BASE_URL/auth/login")"
expect_status 200 "$status" "ADMIN login"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" "$BASE_URL/admin/users")"
expect_status 200 "$status" "ADMIN read access"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{"role":"SUPER_ADMIN"}' \
  "$BASE_URL/admin/users/$TARGET_ID")"
expect_status 403 "$status" "ADMIN self-promotion blocked"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$LIMITED_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{"active":false}' \
  "$BASE_URL/admin/users/$TARGET_ID")"
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

restore_target

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$SUPER_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{"active":false}' \
  "$BASE_URL/admin/users/$TARGET_ID")"
expect_status 200 "$status" "SUPER_ADMIN deactivates account"

status="$(curl -sS -o "$BODY" -w "%{http_code}" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"edukacija@lumera.local\",\"password\":\"$DEMO_PASSWORD\"}" \
  "$BASE_URL/auth/login")"
expect_status 401 "$status" "inactive account login blocked"

echo "Admin authorization checks passed."