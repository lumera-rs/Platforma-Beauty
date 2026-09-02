#!/bin/bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/src/api-preflight.sh"
resolve_api_base_url
check_api_server

DEMO_PASSWORD="${LUMERA_DEMO_PASSWORD:-LumeraDemo2026!}"
COOKIE="$(mktemp)"
BODY="$(mktemp)"

cleanup() {
  rm -f "$COOKIE" "$BODY"
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
}

expect_validation_error() {
  local method="$1"
  local path="$2"
  local payload="$3"
  local label="$4"
  local status
  status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$COOKIE" -X "$method" \
    -H "Content-Type: application/json" --data "$payload" "$BASE_URL$path")"
  expect_status 400 "$status" "$label"
  node -e '
    const body = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (typeof body.error !== "string" || body.error.trim().length === 0) process.exit(1);
  ' "$BODY"
  echo "PASS: $label -> clear 400"
}

fetch_first_id() {
  local path="$1"
  local expression="$2"
  local label="$3"
  local status
  status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$COOKIE" "$BASE_URL$path")"
  expect_status 200 "$status" "$label"
  node -e "
    const body = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    const id = ($expression);
    if (typeof id !== 'string' || id.length === 0) process.exit(1);
    process.stdout.write(id);
  " "$BODY"
}

status="$(curl -sS -o "$BODY" -w "%{http_code}" -c "$COOKIE" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"admin@lumera.local\",\"password\":\"$DEMO_PASSWORD\"}" \
  "$BASE_URL/auth/login")"
expect_status 200 "$status" "SUPER_ADMIN login"

expect_validation_error POST "/admin/service-templates" \
  '{"name":"   ","mainCategory":"Nega lica","subcategory":"","typicalDurationMinutes":60,"priceMin":1000,"priceMax":2000,"active":true}' \
  "service template whitespace"
expect_validation_error POST "/admin/service-templates" \
  '{"name":"Test","mainCategory":"Nega lica","subcategory":"","typicalDurationMinutes":60,"priceMin":2000,"priceMax":1000,"active":true}' \
  "service template inverted price range"
expect_validation_error POST "/admin/products" '{"name":"   "}' "product invalid required fields"
expect_validation_error POST "/admin/product-categories" '{"name":"   "}' "product category whitespace"
expect_validation_error POST "/admin/brands" '{"name":"   "}' "brand whitespace"
expect_validation_error POST "/admin/loyalty-tiers" \
  '{"name":"Test","sortOrder":-1,"spendThreshold":0,"period":"monthly","subscriptionDiscountPercent":0,"productDiscountPercent":0,"freeSubscription":false,"premiumListing":false,"freeShipping":false,"active":true}' \
  "loyalty negative sort order"
expect_validation_error POST "/admin/subscription-plans" \
  '{"name":"Test","price":-1,"trialDays":0,"active":true}' \
  "subscription negative price"
expect_validation_error PUT "/admin/shipping" \
  '{"freeShippingThreshold":0,"tiers":[{"maxWeightGrams":1000,"price":500,"label":"Do 1 kg"}],"personalDeliveryEnabled":true,"personalDeliveryName":"   ","personalDeliveryPrice":0,"personalDeliveryDescription":""}' \
  "shipping whitespace name"
expect_validation_error POST "/admin/courier-services" \
  '{"name":"   ","active":true}' \
  "courier whitespace"
expect_validation_error PATCH "/admin/education/settings" \
  '{"commissionPercent":"","reservePercent":10,"onlineRefundDays":14,"liveAppealDays":7,"featuredCoursePrice":0}' \
  "education empty numeric field"
expect_validation_error PATCH "/admin/education/settings" \
  '{"commissionPercent":80,"reservePercent":30,"onlineRefundDays":14,"liveAppealDays":7,"featuredCoursePrice":0}' \
  "education invalid percentage sum"
expect_validation_error PUT "/admin/integrations/sms" \
  '{"enabled":true,"values":{"baseUrl":"   "}}' \
  "integration whitespace value"

SERVICE_TEMPLATE_ID="$(fetch_first_id "/admin/service-templates" "body[0]?.id" "service templates list")"
LOYALTY_ID="$(fetch_first_id "/admin/loyalty-tiers" "body[0]?.id" "loyalty list")"
PLAN_ID="$(fetch_first_id "/admin/subscription-plans" "body[0]?.id" "subscription list")"
PRODUCT_ID="$(fetch_first_id "/admin/products?page=1&pageSize=1" "body.items?.[0]?.id" "product list")"
CATEGORY_ID="$(fetch_first_id "/admin/product-categories" "body[0]?.id" "product category list")"
BRAND_ID="$(fetch_first_id "/admin/brands" "body[0]?.id" "brand list")"
COURIER_ID="$(fetch_first_id "/admin/courier-services" "body[0]?.id" "courier list")"

expect_validation_error PATCH "/admin/service-templates/$SERVICE_TEMPLATE_ID" '{}' "service template empty patch"
expect_validation_error PATCH "/admin/loyalty-tiers/$LOYALTY_ID" '{}' "loyalty empty patch"
expect_validation_error PATCH "/admin/subscription-plans/$PLAN_ID" '{}' "subscription empty patch"
expect_validation_error PATCH "/admin/products/$PRODUCT_ID" '{}' "product empty patch"
expect_validation_error PATCH "/admin/product-categories/$CATEGORY_ID" '{}' "product category empty patch"
expect_validation_error PATCH "/admin/brands/$BRAND_ID" '{}' "brand empty patch"
expect_validation_error PATCH "/admin/courier-services/$COURIER_ID" '{}' "courier empty patch"

echo "Admin input validation checks passed."