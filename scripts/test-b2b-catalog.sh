#!/usr/bin/env bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/src/api-preflight.sh"
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/src/isolated-admin-fixture.sh"
resolve_api_base_url
check_api_server

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required so the isolated order fixtures can be removed after the test." >&2
  exit 1
fi
if ! command -v psql >/dev/null; then
  echo "psql is required so the isolated order fixtures can be removed after the test." >&2
  exit 1
fi
require_isolated_admin_fixture_dependencies

DEMO_PASSWORD="${LUMERA_DEMO_PASSWORD:-LumeraDemo2026!}"
RUN_ID="${LUMERA_B2B_TEST_ID:-$(date +%s%N)}"
SUPER_COOKIE="$(mktemp)"
ADMIN_COOKIE="$(mktemp)"
CUSTOMER_COOKIE="$(mktemp)"
SALON_COOKIE="$(mktemp)"
BODY="$(mktemp)"
MEDIA_FIXTURE="$(cd "$(dirname "$0")/.." && pwd)/artifacts/beauty-marketplace/public/lumera-media/salon-2.jpg"
MEDIA_IMAGE_URL=""
MEDIA_ASSET_IDS=()

ISOLATED_ADMIN_EMAIL=""
ISOLATED_ADMIN_ID=""
ORIGINAL_SHIPPING=""
ORIGINAL_SHOP_SETTINGS_ROW=""
SHOP_SETTINGS_CREATED_ID=""
ORIGINAL_SALON_LOYALTY_STATUS=""
PARENT_CATEGORY_ID=""
CHILD_CATEGORY_ID=""
PRODUCT_A_ID=""
PRODUCT_B_ID=""
BRAND_ID=""
UNUSED_BRAND_ID=""
SUPER_BRAND_ID=""
SUPER_CATEGORY_ID=""
SUPER_PRODUCT_ID=""
THRESHOLD_ORDER_ID=""
WEIGHTED_ORDER_ID=""
TEST_COURIER_ID=""
BEX_COURIER_ID=""
SUPPLIER_ID=""
SUPPLIER_NAME="B2B Regression Supplier ${RUN_ID}"
SUPPLIER_SLUG="b2b-regression-supplier-${RUN_ID}"
TEST_SHIPPING_NAME="B2B Regression ${RUN_ID}"
ORIGINAL_CART_JSON="[]"
CLEANUP_COMPLETED=false

remove_order_fixtures() {
  local order_id
  for order_id in "$THRESHOLD_ORDER_ID" "$WEIGHTED_ORDER_ID"; do
    [[ -n "$order_id" ]] || continue
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v order_id="$order_id" <<'SQL'
BEGIN;
DELETE FROM order_items WHERE order_id = :'order_id'::uuid;
DELETE FROM salon_notifications WHERE href = '/vlasnik/porudzbine/' || :'order_id';
DELETE FROM orders WHERE id = :'order_id'::uuid;
COMMIT;
SQL
  done
}

cleanup_media_fixtures() {
  ((${#MEDIA_ASSET_IDS[@]})) || return 0
  MEDIA_FIXTURE_IDS="$(IFS=,; echo "${MEDIA_ASSET_IDS[*]}")" \
    pnpm --filter @workspace/scripts exec tsx - <<'TS' >/dev/null
import { db, mediaAssetsTable, mediaUploadTicketsTable, mediaVariantsTable, pool } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { deletePrivateStorageObject } from "../artifacts/api-server/src/routes/media";
const ids = (process.env.MEDIA_FIXTURE_IDS ?? "").split(",").filter(Boolean);
const variants = await db.select().from(mediaVariantsTable).where(inArray(mediaVariantsTable.assetId, ids));
const tickets = await db.select().from(mediaUploadTicketsTable).where(inArray(mediaUploadTicketsTable.id, ids));
for (const variant of variants) await deletePrivateStorageObject(variant.objectPath).catch(() => undefined);
for (const ticket of tickets) await deletePrivateStorageObject(ticket.stagingObjectPath).catch(() => undefined);
await db.delete(mediaAssetsTable).where(inArray(mediaAssetsTable.id, ids));
await db.delete(mediaUploadTicketsTable).where(inArray(mediaUploadTicketsTable.id, ids));
await pool.end();
TS
}

restore_shared_state() {
  local status
  if [[ -n "$ORIGINAL_SHIPPING" ]]; then
    status="$(request -b "$SUPER_COOKIE" -X PUT \
      -H "Content-Type: application/json" \
      --data "$ORIGINAL_SHIPPING" \
      "$BASE_URL/admin/shipping")"
    [[ "$status" == "200" ]] || return 1
    status="$(request -b "$SUPER_COOKIE" "$BASE_URL/admin/shipping")"
    [[ "$status" == "200" ]] || return 1
    jq -e --argjson original "$ORIGINAL_SHIPPING" \
      '{freeShippingThreshold,tiers,personalDeliveryEnabled,personalDeliveryName,personalDeliveryPrice,personalDeliveryDescription} == $original' "$BODY" >/dev/null || return 1
  fi

  if [[ -n "$SHOP_SETTINGS_CREATED_ID" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v settings_id="$SHOP_SETTINGS_CREATED_ID" >/dev/null <<'SQL' || return 1
DELETE FROM shop_settings WHERE id = :'settings_id'::uuid;
SQL
  elif [[ -n "$ORIGINAL_SHOP_SETTINGS_ROW" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v snapshot="$ORIGINAL_SHOP_SETTINGS_ROW" >/dev/null <<'SQL' || return 1
UPDATE shop_settings AS current
SET seller_company_name = original.seller_company_name,
    seller_tax_id = original.seller_tax_id,
    seller_registration_number = original.seller_registration_number,
    seller_address = original.seller_address,
    seller_city = original.seller_city,
    seller_postal_code = original.seller_postal_code,
    seller_bank_account = original.seller_bank_account,
    seller_contact_email = original.seller_contact_email,
    seller_contact_phone = original.seller_contact_phone,
    version = original.version,
    updated_at = original.updated_at
FROM json_populate_record(NULL::shop_settings, :'snapshot'::json) AS original
WHERE current.id = original.id;
SQL
  fi

  if [[ -n "$ORIGINAL_SALON_LOYALTY_STATUS" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v snapshot="$ORIGINAL_SALON_LOYALTY_STATUS" >/dev/null <<'SQL' || return 1
INSERT INTO salon_loyalty_statuses
SELECT original.*
FROM json_populate_record(NULL::salon_loyalty_statuses, :'snapshot'::json) AS original
ON CONFLICT (salon_id) DO UPDATE
SET tier_id = EXCLUDED.tier_id,
    current_period_spend = EXCLUDED.current_period_spend,
    updated_at = EXCLUDED.updated_at;
SQL
  fi
}

verify_test_data_removed() {
  local counts
  counts="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    select count(*) from product_categories where name like 'B2B Regression %${RUN_ID}%';
    select count(*) from products where sku like 'LUMERA-REG-${RUN_ID}%';
    select count(*) from product_brands where name like 'B2B Test Brand%${RUN_ID}%' or name like 'B2B Unused Brand%${RUN_ID}%' or name like 'B2B Super Brand%${RUN_ID}%';
    select count(*) from orders where shipping_name = '${TEST_SHIPPING_NAME}';
    select count(*) from suppliers where slug = '${SUPPLIER_SLUG}';
  ")" || return 1
  [[ "$counts" == $'0\n0\n0\n0\n0' ]]
}

restore_original_cart() {
  local product_id variant_value quantity payload status
  while IFS=$'\t' read -r product_id variant_value quantity; do
    [[ -n "$product_id" ]] || continue
    payload="$(jq -cn --arg productId "$product_id" --arg variantValue "$variant_value" --argjson quantity "$quantity" \
      '{productId: $productId, quantity: $quantity} + (if $variantValue == "" then {} else {variantValue: $variantValue} end)')"
    status="$(request_json_as "$SALON_COOKIE" POST /shop/cart/items "$payload")"
    [[ "$status" == "200" ]] || return 1
  done < <(jq -r '.[] | [.productId, (.variantValue // ""), (.quantity | tostring)] | @tsv' <<<"$ORIGINAL_CART_JSON")
}

clear_cart_for_checkout() {
  local item_id
  local status
  status="$(request -b "$SALON_COOKIE" "$BASE_URL/shop/cart")"
  expect_status 200 "$status" "SALON_OWNER reads persistent cart before isolated checkout"
  ORIGINAL_CART_JSON="$(jq -c '[.items[] | {productId, variantValue, quantity}]' "$BODY")"
  while IFS= read -r item_id; do
    [[ -n "$item_id" ]] || continue
    status="$(request -b "$SALON_COOKIE" -X DELETE "$BASE_URL/shop/cart/items/$item_id")"
    expect_status 200 "$status" "clears a saved cart item for isolated checkout"
  done < <(jq -r '.items[].id' "$BODY")
}

cleanup() {
  local original_status=$?
  local cleanup_failed=false
  [[ "$CLEANUP_COMPLETED" == true ]] && return

  # Orders have no public delete route. The test records their UUIDs and removes
  # only those rows, allowing all temporary products, categories, and brands to
  # be physically deleted as part of teardown.
  remove_order_fixtures || cleanup_failed=true
  restore_original_cart || cleanup_failed=true

  # Best-effort endpoint cleanup is followed by SQL/API state verification below.
  if [[ -n "$PRODUCT_B_ID" && -n "$PARENT_CATEGORY_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X PATCH \
      -H "Content-Type: application/json" \
      --data "{\"categoryId\":\"$PARENT_CATEGORY_ID\"}" \
      "$BASE_URL/admin/products/$PRODUCT_B_ID" || true
  fi
  if [[ -n "$PRODUCT_A_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/products/$PRODUCT_A_ID" || true
  fi
  if [[ -n "$PRODUCT_B_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/products/$PRODUCT_B_ID" || true
  fi
  if [[ -n "$CHILD_CATEGORY_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/product-categories/$CHILD_CATEGORY_ID" || true
  fi
  if [[ -n "$PARENT_CATEGORY_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/product-categories/$PARENT_CATEGORY_ID" || true
  fi
  if [[ -n "$UNUSED_BRAND_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/brands/$UNUSED_BRAND_ID" || true
  fi
  if [[ -n "$BRAND_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/brands/$BRAND_ID" || true
  fi
  if [[ -n "$SUPER_BRAND_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/brands/$SUPER_BRAND_ID" || true
  fi
  if [[ -n "$SUPER_PRODUCT_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/products/$SUPER_PRODUCT_ID" || true
  fi
  if [[ -n "$SUPER_CATEGORY_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/product-categories/$SUPER_CATEGORY_ID" || true
  fi
  if [[ -n "$SUPPLIER_ID" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v supplier_id="$SUPPLIER_ID" >/dev/null <<'SQL' || cleanup_failed=true
DELETE FROM suppliers WHERE id = :'supplier_id'::uuid;
SQL
  fi
  if [[ -n "$TEST_COURIER_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/courier-services/$TEST_COURIER_ID" || true
  fi

  cleanup_media_fixtures || cleanup_failed=true

  restore_shared_state || cleanup_failed=true
  remove_isolated_admin_fixture || cleanup_failed=true
  verify_isolated_admin_fixture_removed || cleanup_failed=true
  verify_test_data_removed || cleanup_failed=true
  rm -f "$SUPER_COOKIE" "$ADMIN_COOKIE" "$CUSTOMER_COOKIE" "$SALON_COOKIE" "$BODY"
  if [[ "$cleanup_failed" == true ]]; then
    echo "FAIL: rollback could not be fully verified; inspect the API and test database before rerunning." >&2
  fi
  trap - EXIT
  exit "$([[ "$original_status" == 0 || "$cleanup_failed" == true ]] && echo 1 || echo "$original_status")"
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

expect_json() {
  local filter="$1"
  local label="$2"
  if ! jq -e "$filter" "$BODY" >/dev/null; then
    echo "FAIL: $label: $(cat "$BODY")" >&2
    exit 1
  fi
  echo "PASS: $label"
}

request() {
  curl -sS -o "$BODY" -w "%{http_code}" "$@"
}

request_json_as() {
  local cookie="$1"
  local method="$2"
  local endpoint="$3"
  local payload="$4"
  if [[ -n "$cookie" ]]; then
    request -b "$cookie" -X "$method" -H "Content-Type: application/json" --data "$payload" "$BASE_URL$endpoint"
  else
    request -X "$method" -H "Content-Type: application/json" --data "$payload" "$BASE_URL$endpoint"
  fi
}

json_field() {
  jq -r "$1" "$BODY"
}

upload_product_media() {
  local cookie="$1"
  local label="$2"
  local status upload_id upload_url size
  size="$(wc -c < "$MEDIA_FIXTURE" | tr -d ' ')"
  status="$(request -b "$cookie" -X POST \
    -H "Content-Type: application/json" \
    --data "{\"scope\":\"product\",\"name\":\"b2b-regression-${RUN_ID}.jpg\",\"size\":$size,\"contentType\":\"image/jpeg\"}" \
    "$BASE_URL/media/uploads")"
  expect_status 200 "$status" "$label requests validated product image upload"
  upload_id="$(json_field '.uploadId')"
  upload_url="$(json_field '.uploadUrl')"
  MEDIA_ASSET_IDS+=("$upload_id")
  status="$(curl -sS -o "$BODY" -w "%{http_code}" -X PUT \
    -H "Content-Type: image/jpeg" --data-binary "@$MEDIA_FIXTURE" "$upload_url")"
  expect_status 200 "$status" "$label uploads product image bytes"
  status="$(request -b "$cookie" -X POST "$BASE_URL/media/uploads/$upload_id/finalize")"
  expect_status 201 "$status" "$label finalizes optimized product image"
  MEDIA_IMAGE_URL="$(json_field '.imageUrl')"
}

login() {
  local cookie="$1"
  local email="$2"
  local status
  status="$(curl -sS -o "$BODY" -w "%{http_code}" -c "$cookie" \
    -H "Content-Type: application/json" \
    --data "{\"email\":\"$email\",\"password\":\"$DEMO_PASSWORD\"}" \
    "$BASE_URL/auth/login")"
  expect_status 200 "$status" "$email login"
}

echo "Running B2B catalog regression checks against $BASE_URL"

# Establish SUPER_ADMIN access and create a marker-owned ADMIN identity.
login "$SUPER_COOKIE" "admin@lumera.local"
create_isolated_admin_fixture "$RUN_ID"
login "$ADMIN_COOKIE" "$ISOLATED_ADMIN_EMAIL"
login "$CUSTOMER_COOKIE" "kupac@lumera.local"
login "$SALON_COOKIE" "salon@lumera.local"
status="$(request -b "$ADMIN_COOKIE" "$BASE_URL/admin/courier-services")"
expect_status 200 "$status" "ADMIN lists seeded courier services"
BEX_COURIER_ID="$(jq -r '.[] | select(.code == "bex-express") | .id' "$BODY")"
if [[ -z "$BEX_COURIER_ID" || "$BEX_COURIER_ID" == "null" ]]; then
  echo "FAIL: Bex Express courier service was not seeded." >&2
  exit 1
fi
expect_json '.[] | select(.code == "personal-delivery" and .trackingUrlTemplate == null)' "personal delivery is seeded without tracking URL"
TEST_COURIER_NAME="B2B Test Courier ${RUN_ID}"
status="$(request -b "$ADMIN_COOKIE" -X POST -H "Content-Type: application/json" \
  --data "$(jq -cn --arg name "$TEST_COURIER_NAME" '{name: $name, trackingUrlTemplate: "https://example.test/track/{trackingNumber}"}')" \
  "$BASE_URL/admin/courier-services")"
expect_status 201 "$status" "ADMIN creates courier service"
TEST_COURIER_ID="$(json_field '.id')"
expect_json '.trackingUrlTemplate == "https://example.test/track/{trackingNumber}"' "created courier keeps tracking template"
status="$(request -b "$ADMIN_COOKIE" -X PATCH -H "Content-Type: application/json" \
  --data '{"active":false}' "$BASE_URL/admin/courier-services/$TEST_COURIER_ID")"
expect_status 200 "$status" "ADMIN updates courier service"
expect_json '.active == false' "courier active state is updated"
status="$(request -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/admin/courier-services/$TEST_COURIER_ID")"
expect_status 204 "$status" "ADMIN deletes unused courier service"
TEST_COURIER_ID=""
status="$(request -b "$SALON_COOKIE" "$BASE_URL/shop/checkout-profile")"
expect_status 200 "$status" "SALON_OWNER reads checkout profile"
expect_json '.salonAddress.postalCode == "11000"' "seeded salon default delivery address includes postal code"
clear_cart_for_checkout

# Every B2B admin read surface must require an authenticated administrator.
for endpoint in /admin/products /admin/product-categories /admin/brands /admin/shipping; do
  status="$(request "$BASE_URL$endpoint")"
  expect_status 401 "$status" "anonymous denied $endpoint"

  status="$(request -b "$CUSTOMER_COOKIE" "$BASE_URL$endpoint")"
  expect_status 403 "$status" "CUSTOMER denied $endpoint"

  status="$(request -b "$SALON_COOKIE" "$BASE_URL$endpoint")"
  expect_status 403 "$status" "SALON_OWNER denied $endpoint"

  status="$(request -b "$SUPER_COOKIE" "$BASE_URL$endpoint")"
  expect_status 200 "$status" "SUPER_ADMIN allowed $endpoint"

  status="$(request -b "$ADMIN_COOKIE" "$BASE_URL$endpoint")"
  expect_status 200 "$status" "ADMIN allowed $endpoint"
done

# Mutation classes must reject every non-admin identity before body validation.
for subject in anonymous CUSTOMER SALON_OWNER; do
  case "$subject" in
    anonymous) cookie=""; expected=401 ;;
    CUSTOMER) cookie="$CUSTOMER_COOKIE"; expected=403 ;;
    SALON_OWNER) cookie="$SALON_COOKIE"; expected=403 ;;
  esac
  for mutation in \
    'POST|/admin/products|{}|product creation' \
    'POST|/admin/products/bulk|{"productIds":["not-a-uuid"],"action":"activate"}|bulk product update' \
    'POST|/admin/product-categories|{"name":"Blocked mutation"}|category creation' \
    'POST|/admin/brands|{"name":"Blocked mutation"}|brand creation' \
    'PUT|/admin/shipping|{"freeShippingThreshold":0,"tiers":[],"personalDeliveryEnabled":false,"personalDeliveryName":"Lična dostava u Beogradu","personalDeliveryPrice":0,"personalDeliveryDescription":"Dostava na adresu u Beogradu."}|shipping configuration'; do
    IFS='|' read -r method endpoint payload label <<<"$mutation"
    status="$(request_json_as "$cookie" "$method" "$endpoint" "$payload")"
    expect_status "$expected" "$status" "$subject denied $label"
  done
done

# Shop routes are only for SALON_OWNER accounts, even if a caller is logged in.
for subject in anonymous CUSTOMER ADMIN; do
  case "$subject" in
    anonymous) cookie=""; expected=401 ;;
    CUSTOMER) cookie="$CUSTOMER_COOKIE"; expected=403 ;;
    ADMIN) cookie="$ADMIN_COOKIE"; expected=403 ;;
  esac
  if [[ -n "$cookie" ]]; then
    status="$(request -b "$cookie" "$BASE_URL/shop/shipping-quote?weightGrams=1000&subtotal=1000")"
  else
    status="$(request "$BASE_URL/shop/shipping-quote?weightGrams=1000&subtotal=1000")"
  fi
  expect_status "$expected" "$status" "$subject denied shipping quote"
  status="$(request_json_as "$cookie" POST /shop/orders '{}')"
  expect_status "$expected" "$status" "$subject denied order creation"
done

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$SUPPLIER_NAME\",\"slug\":\"$SUPPLIER_SLUG\",\"scope\":\"B2B\",\"active\":true}" \
  "$BASE_URL/admin/suppliers")"
expect_status 201 "$status" "ADMIN creates isolated B2B supplier"
SUPPLIER_ID="$(json_field '.id')"
expect_json ".slug == \"$SUPPLIER_SLUG\" and .scope == \"B2B\" and .active == true" "isolated supplier is configured for B2B"

# Product categories: create, validate uniqueness, update and later delete.
PARENT_NAME="B2B Regression ${RUN_ID}"
CHILD_NAME="B2B Regression Child ${RUN_ID}"
status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$PARENT_NAME\",\"supplierId\":\"$SUPPLIER_ID\",\"sortOrder\":90,\"active\":true}" \
  "$BASE_URL/admin/product-categories")"
expect_status 201 "$status" "ADMIN creates product category"
PARENT_CATEGORY_ID="$(json_field '.id')"
expect_json ".slug == \"b2b-regression-${RUN_ID}\" and .parentId == null" "category slug and root parent are correct"
if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "select exists(select 1 from product_categories where id = '${PARENT_CATEGORY_ID}'::uuid)" | grep -qx 't'; then
  echo "FAIL: API target and DATABASE_URL do not point to the same test database." >&2
  exit 1
fi
echo "PASS: API target and DATABASE_URL share the isolated test database"

ORIGINAL_SALON_LOYALTY_STATUS="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
  select row_to_json(status)::text
  from salon_loyalty_statuses status
  join salons on salons.id = status.salon_id
  join users on users.id = salons.owner_id
  where users.email = 'salon@lumera.local'
  limit 1
")"
if [[ -n "$ORIGINAL_SALON_LOYALTY_STATUS" ]]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
DELETE FROM salon_loyalty_statuses
USING salons, users
WHERE salon_loyalty_statuses.salon_id = salons.id
  AND salons.owner_id = users.id
  AND users.email = 'salon@lumera.local';
SQL
fi

# Save shipping configuration only after confirming the API and teardown
# database are the same environment.
status="$(request -b "$SUPER_COOKIE" "$BASE_URL/admin/shipping")"
expect_status 200 "$status" "read shipping configuration for isolation"
ORIGINAL_SHIPPING="$(jq -c '{freeShippingThreshold,tiers,personalDeliveryEnabled,personalDeliveryName,personalDeliveryPrice,personalDeliveryDescription}' "$BODY")"

ORIGINAL_SHOP_SETTINGS_ROW="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "select row_to_json(shop_settings)::text from shop_settings limit 1")"
if [[ -z "$ORIGINAL_SHOP_SETTINGS_ROW" ]]; then
  SHOP_SETTINGS_CREATED_ID="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc \
    "insert into shop_settings default values returning id")"
  ORIGINAL_SHOP_SETTINGS_ROW="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
    "select row_to_json(shop_settings)::text from shop_settings where id = '$SHOP_SETTINGS_CREATED_ID'::uuid")"
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
UPDATE shop_settings
SET seller_company_name = 'B2B Regression Seller',
    seller_tax_id = '101234567',
    seller_registration_number = '20123456',
    seller_address = 'Test address 1',
    seller_city = 'Beograd',
    seller_postal_code = '11000',
    seller_bank_account = '100-123456789-10',
    seller_contact_email = 'b2b-regression@example.test',
    seller_contact_phone = '+381601234567',
    version = version + 1,
    updated_at = now();
SQL

status="$(request -b "$SUPER_COOKIE" -X PUT \
  -H "Content-Type: application/json" \
  --data '{"freeShippingThreshold":15000,"tiers":[{"maxWeightGrams":1000,"price":111,"label":"test do 1 kg"},{"maxWeightGrams":3000,"price":222,"label":"test do 3 kg"},{"maxWeightGrams":10000,"price":333,"label":"test do 10 kg"}],"personalDeliveryEnabled":true,"personalDeliveryName":"Test lična dostava","personalDeliveryPrice":444,"personalDeliveryDescription":"Test samo za Beograd"}' \
  "$BASE_URL/admin/shipping")"
expect_status 200 "$status" "SUPER_ADMIN replaces shipping tiers"
expect_json '.freeShippingThreshold == 15000 and [.tiers[].maxWeightGrams] == [1000,3000,10000] and .personalDeliveryEnabled == true and .personalDeliveryPrice == 444' "shipping tiers and personal delivery are persisted"

status="$(request -b "$ADMIN_COOKIE" -X PUT \
  -H "Content-Type: application/json" \
  --data '{"freeShippingThreshold":15000,"tiers":[{"maxWeightGrams":1000,"price":111,"label":"test do 1 kg"},{"maxWeightGrams":1000,"price":222,"label":"duplicate"}],"personalDeliveryEnabled":true,"personalDeliveryName":"Test lična dostava","personalDeliveryPrice":444,"personalDeliveryDescription":"Test samo za Beograd"}' \
  "$BASE_URL/admin/shipping")"
expect_status 400 "$status" "duplicate shipping weight rejected"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$PARENT_NAME\",\"supplierId\":\"$SUPPLIER_ID\",\"sortOrder\":90}" \
  "$BASE_URL/admin/product-categories")"
expect_status 409 "$status" "duplicate category rejected"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$CHILD_NAME\",\"supplierId\":\"$SUPPLIER_ID\",\"parentId\":\"$PARENT_CATEGORY_ID\",\"sortOrder\":1}" \
  "$BASE_URL/admin/product-categories")"
expect_status 201 "$status" "ADMIN creates product subcategory"
CHILD_CATEGORY_ID="$(json_field '.id')"

SUPER_CATEGORY_NAME="B2B Super Category ${RUN_ID}"
status="$(request -b "$SUPER_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$SUPER_CATEGORY_NAME\",\"supplierId\":\"$SUPPLIER_ID\",\"sortOrder\":91}" \
  "$BASE_URL/admin/product-categories")"
expect_status 201 "$status" "SUPER_ADMIN creates product category"
SUPER_CATEGORY_ID="$(json_field '.id')"
status="$(request -b "$SUPER_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{"sortOrder":92}' \
  "$BASE_URL/admin/product-categories/$SUPER_CATEGORY_ID")"
expect_status 200 "$status" "SUPER_ADMIN updates product category"
status="$(request -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/product-categories/$SUPER_CATEGORY_ID")"
expect_status 204 "$status" "SUPER_ADMIN deletes product category"
SUPER_CATEGORY_ID=""

status="$(request -b "$ADMIN_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"${CHILD_NAME} Renamed\"}" \
  "$BASE_URL/admin/product-categories/$CHILD_CATEGORY_ID")"
expect_status 200 "$status" "ADMIN updates product subcategory"
expect_json ".name == \"${CHILD_NAME} Renamed\" and .parentId == \"$PARENT_CATEGORY_ID\"" "category update keeps hierarchy"

# Brands: CRUD and duplicate validation.
BRAND_NAME="B2B Test Brand ${RUN_ID}"
RENAMED_BRAND_NAME="B2B Test Brand Renamed ${RUN_ID}"
status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$BRAND_NAME\",\"description\":\"Regression fixture\"}" \
  "$BASE_URL/admin/brands")"
expect_status 201 "$status" "ADMIN creates brand"
BRAND_ID="$(json_field '.id')"
expect_json ".slug == \"b2b-test-brand-${RUN_ID}\" and .productCount == 0" "brand slug and count are correct"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$BRAND_NAME\"}" \
  "$BASE_URL/admin/brands")"
expect_status 409 "$status" "duplicate brand rejected"

status="$(request -b "$ADMIN_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$RENAMED_BRAND_NAME\",\"description\":\"Renamed regression fixture\",\"active\":true}" \
  "$BASE_URL/admin/brands/$BRAND_ID")"
expect_status 200 "$status" "ADMIN updates brand"
expect_json ".name == \"$RENAMED_BRAND_NAME\" and .slug == \"b2b-test-brand-renamed-${RUN_ID}\"" "brand rename updates slug"

UNUSED_BRAND_NAME="B2B Unused Brand ${RUN_ID}"
status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$UNUSED_BRAND_NAME\"}" \
  "$BASE_URL/admin/brands")"
expect_status 201 "$status" "ADMIN creates unused brand for delete coverage"
UNUSED_BRAND_ID="$(json_field '.id')"
status="$(request -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/admin/brands/$UNUSED_BRAND_ID")"
expect_status 200 "$status" "ADMIN deletes unused brand"
expect_json ".id == \"$UNUSED_BRAND_ID\" and .active == false" "deleted brand response is inactive"
UNUSED_BRAND_ID=""

SUPER_BRAND_NAME="B2B Super Brand ${RUN_ID}"
status="$(request -b "$SUPER_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$SUPER_BRAND_NAME\",\"description\":\"SUPER_ADMIN CRUD fixture\"}" \
  "$BASE_URL/admin/brands")"
expect_status 201 "$status" "SUPER_ADMIN creates catalog brand"
SUPER_BRAND_ID="$(json_field '.id')"
status="$(request -b "$SUPER_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"description\":\"SUPER_ADMIN CRUD updated\"}" \
  "$BASE_URL/admin/brands/$SUPER_BRAND_ID")"
expect_status 200 "$status" "SUPER_ADMIN updates catalog brand"
status="$(request -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/brands/$SUPER_BRAND_ID")"
expect_status 200 "$status" "SUPER_ADMIN deletes catalog brand"
SUPER_BRAND_ID=""

# Product validation and CRUD. The second product is also used for the order
# total assertion below, so its price/discount/weight remain deterministic.
common_product_fields="\"supplierId\":\"$SUPPLIER_ID\",\"categoryId\":\"$CHILD_CATEGORY_ID\",\"categoryName\":\"ignored\",\"brand\":\"$RENAMED_BRAND_NAME\",\"description\":\"Regression product\",\"shortDescription\":\"B2B test\",\"imageUrl\":\"/test/b2b-regression.jpg\",\"images\":[],\"unit\":\"kom\",\"isNew\":false,\"isBestseller\":false,\"active\":true"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"Invalid discount $RUN_ID\",$common_product_fields,\"price\":1000,\"discountPrice\":1000,\"stock\":1,\"sku\":\"LUMERA-REG-${RUN_ID}-INVALID\",\"weightGrams\":100}" \
  "$BASE_URL/admin/products")"
expect_status 400 "$status" "discount equal to regular price rejected"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"Invalid variants $RUN_ID\",$common_product_fields,\"price\":1000,\"stock\":5,\"sku\":\"LUMERA-REG-${RUN_ID}-INVALID-VARIANTS\",\"weightGrams\":100,\"variants\":[{\"label\":\"Size\",\"value\":\"Small\",\"stock\":5},{\"label\":\"Size\",\"value\":\"Large\"}]}" \
  "$BASE_URL/admin/products")"
expect_status 400 "$status" "partial variant inventory rejected"

upload_product_media "$ADMIN_COOKIE" "ADMIN product A"
common_product_fields="\"supplierId\":\"$SUPPLIER_ID\",\"categoryId\":\"$CHILD_CATEGORY_ID\",\"categoryName\":\"ignored\",\"brand\":\"$RENAMED_BRAND_NAME\",\"description\":\"Regression product\",\"shortDescription\":\"B2B test\",\"imageUrl\":\"$MEDIA_IMAGE_URL\",\"images\":[],\"unit\":\"kom\",\"isNew\":false,\"isBestseller\":false,\"active\":true"
status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"Product A $RUN_ID\",$common_product_fields,\"price\":1200,\"discountPrice\":900,\"stock\":5,\"sku\":\"LUMERA-REG-${RUN_ID}-A\",\"weightGrams\":500}" \
  "$BASE_URL/admin/products")"
expect_status 201 "$status" "ADMIN creates product"
PRODUCT_A_ID="$(json_field '.id')"
expect_json ".sku == \"LUMERA-REG-${RUN_ID}-A\" and .categoryId == \"$CHILD_CATEGORY_ID\" and .subcategoryName == \"${CHILD_NAME} Renamed\"" "product category denormalization is correct"

upload_product_media "$ADMIN_COOKIE" "ADMIN product B"
common_product_fields="\"supplierId\":\"$SUPPLIER_ID\",\"categoryId\":\"$CHILD_CATEGORY_ID\",\"categoryName\":\"ignored\",\"brand\":\"$RENAMED_BRAND_NAME\",\"description\":\"Regression product\",\"shortDescription\":\"B2B test\",\"imageUrl\":\"$MEDIA_IMAGE_URL\",\"images\":[],\"unit\":\"kom\",\"isNew\":false,\"isBestseller\":false,\"active\":true"
status="$(request -b "$ADMIN_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"imageUrl\":\"$MEDIA_IMAGE_URL\",\"categoryId\":\"00000000-0000-4000-8000-000000000000\"}" \
  "$BASE_URL/admin/products/$PRODUCT_A_ID")"
expect_status 404 "$status" "invalid category does not consume a newly uploaded product image"
status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"Product B $RUN_ID\",$common_product_fields,\"price\":5000,\"discountPrice\":3000,\"stock\":10,\"sku\":\"LUMERA-REG-${RUN_ID}-B\",\"weightGrams\":1500,\"variants\":[{\"label\":\"Finish\",\"value\":\"Standard\",\"stock\":5},{\"label\":\"Finish\",\"value\":\"Premium\",\"priceAdjust\":500,\"stock\":5}]}" \
  "$BASE_URL/admin/products")"
expect_status 201 "$status" "ADMIN creates variant product"
PRODUCT_B_ID="$(json_field '.id')"
expect_json ".stock == 10 and ([.variants[].stock] | add) == 10" "variant inventory sum is accepted"

upload_product_media "$SUPER_COOKIE" "SUPER_ADMIN product"
common_product_fields="\"supplierId\":\"$SUPPLIER_ID\",\"categoryId\":\"$CHILD_CATEGORY_ID\",\"categoryName\":\"ignored\",\"brand\":\"$RENAMED_BRAND_NAME\",\"description\":\"Regression product\",\"shortDescription\":\"B2B test\",\"imageUrl\":\"$MEDIA_IMAGE_URL\",\"images\":[],\"unit\":\"kom\",\"isNew\":false,\"isBestseller\":false,\"active\":true"
status="$(request -b "$SUPER_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"Super Product $RUN_ID\",$common_product_fields,\"price\":1000,\"stock\":1,\"sku\":\"LUMERA-REG-${RUN_ID}-SUPER\",\"weightGrams\":100}" \
  "$BASE_URL/admin/products")"
expect_status 201 "$status" "SUPER_ADMIN creates product"
SUPER_PRODUCT_ID="$(json_field '.id')"
status="$(request -b "$SUPER_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"Super Product Updated $RUN_ID\"}" \
  "$BASE_URL/admin/products/$SUPER_PRODUCT_ID")"
expect_status 200 "$status" "SUPER_ADMIN updates product"
status="$(request -b "$SUPER_COOKIE" -X DELETE "$BASE_URL/admin/products/$SUPER_PRODUCT_ID")"
expect_status 200 "$status" "SUPER_ADMIN deletes product"
SUPER_PRODUCT_ID=""

status="$(request -b "$SUPER_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"productIds\":[\"$PRODUCT_A_ID\"],\"action\":\"set-new\"}" \
  "$BASE_URL/admin/products/bulk")"
expect_status 200 "$status" "SUPER_ADMIN applies bulk product action"
expect_json '.updated == 1' "SUPER_ADMIN bulk action updates product"

for subject in anonymous CUSTOMER SALON_OWNER; do
  case "$subject" in
    anonymous) cookie=""; expected=401 ;;
    CUSTOMER) cookie="$CUSTOMER_COOKIE"; expected=403 ;;
    SALON_OWNER) cookie="$SALON_COOKIE"; expected=403 ;;
  esac
  for mutation in \
    "PATCH|/admin/products/$PRODUCT_A_ID|{\"name\":\"Blocked update\"}|product update" \
    "DELETE|/admin/products/$PRODUCT_A_ID|{}|product deletion" \
    "PATCH|/admin/product-categories/$CHILD_CATEGORY_ID|{\"name\":\"Blocked update\"}|category update" \
    "DELETE|/admin/product-categories/$CHILD_CATEGORY_ID|{}|category deletion" \
    "PATCH|/admin/brands/$BRAND_ID|{\"name\":\"Blocked update\"}|brand update" \
    "DELETE|/admin/brands/$BRAND_ID|{}|brand deletion"; do
    IFS='|' read -r method endpoint payload label <<<"$mutation"
    status="$(request_json_as "$cookie" "$method" "$endpoint" "$payload")"
    expect_status "$expected" "$status" "$subject denied $label"
  done
done

status="$(request -b "$ADMIN_COOKIE" -X GET "$BASE_URL/admin/products?brand=$(printf '%s' "$RENAMED_BRAND_NAME" | sed 's/ /%20/g')&status=in-stock&pageSize=100")"
expect_status 200 "$status" "ADMIN filters products by brand and stock"
expect_json "[.items[] | select(.id == \"$PRODUCT_A_ID\" or .id == \"$PRODUCT_B_ID\")] | length == 2" "filtered list contains both isolated products"

status="$(request -b "$ADMIN_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"Product A Updated $RUN_ID\",\"price\":2200,\"discountPrice\":1800,\"stock\":8,\"isNew\":true}" \
  "$BASE_URL/admin/products/$PRODUCT_A_ID")"
expect_status 200 "$status" "ADMIN updates product"
expect_json ".name == \"Product A Updated $RUN_ID\" and .price == 2200 and .discountPrice == 1800 and .isNew == true" "product update persists pricing and flags"

status="$(request -b "$ADMIN_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"sku\":\"LUMERA-REG-${RUN_ID}-B\"}" \
  "$BASE_URL/admin/products/$PRODUCT_A_ID")"
expect_status 409 "$status" "duplicate product SKU rejected"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"productIds\":[\"$PRODUCT_A_ID\",\"$PRODUCT_B_ID\"],\"action\":\"set-new\"}" \
  "$BASE_URL/admin/products/bulk")"
expect_status 200 "$status" "ADMIN applies bulk product action"
expect_json '.updated == 2' "bulk action updates both products"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"productIds\":[\"$PRODUCT_A_ID\",\"$PRODUCT_B_ID\"],\"action\":\"set-category\"}" \
  "$BASE_URL/admin/products/bulk")"
expect_status 400 "$status" "bulk category action validates categoryId"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"productIds\":[\"$PRODUCT_A_ID\",\"$PRODUCT_B_ID\"],\"action\":\"deactivate\"}" \
  "$BASE_URL/admin/products/bulk")"
expect_status 200 "$status" "ADMIN deactivates products in bulk"
expect_json '.updated == 2' "bulk deactivation updates both products"
status="$(request -b "$ADMIN_COOKIE" "$BASE_URL/admin/products?status=inactive&search=$(printf '%s' "$RUN_ID" | sed 's/ /%20/g')&pageSize=100")"
expect_status 200 "$status" "ADMIN filters inactive products"
expect_json "[.items[] | select(.id == \"$PRODUCT_A_ID\" or .id == \"$PRODUCT_B_ID\")] | length == 2" "inactive filter includes both products"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"productIds\":[\"$PRODUCT_A_ID\",\"$PRODUCT_B_ID\"],\"action\":\"activate\"}" \
  "$BASE_URL/admin/products/bulk")"
expect_status 200 "$status" "ADMIN reactivates products in bulk"

status="$(request -b "$ADMIN_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"${CHILD_NAME} Final\"}" \
  "$BASE_URL/admin/product-categories/$CHILD_CATEGORY_ID")"
expect_status 200 "$status" "ADMIN renames category with products"
status="$(request -b "$ADMIN_COOKIE" "$BASE_URL/admin/products?brand=$(printf '%s' "$RENAMED_BRAND_NAME" | sed 's/ /%20/g')&pageSize=100")"
expect_status 200 "$status" "product list remains available after category rename"
expect_json "[.items[] | select(.id == \"$PRODUCT_B_ID\" and .subcategoryName == \"${CHILD_NAME} Final\")] | length == 1" "category rename syncs product denormalization"

status="$(request -b "$ADMIN_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$RENAMED_BRAND_NAME\"}" \
  "$BASE_URL/admin/brands/$BRAND_ID")"
expect_status 200 "$status" "ADMIN keeps brand update idempotent"

# Delete the product that has no order reference; the API should remove it.
status="$(request -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/admin/products/$PRODUCT_A_ID")"
expect_status 200 "$status" "ADMIN deletes unreferenced product"
expect_json ".id == \"$PRODUCT_A_ID\" and .active == false" "deleted product response is inactive"
status="$(request -b "$ADMIN_COOKIE" "$BASE_URL/admin/products?search=$(printf '%s' "$PRODUCT_A_ID" | sed 's/ /%20/g')&pageSize=100")"
expect_status 200 "$status" "deleted product can be searched"
expect_json '.total == 0' "deleted product is absent from catalog"
PRODUCT_A_ID=""

# Shipping tiers, free-shipping threshold, and order totals must be applied on
# the server. Cart entries intentionally contain no client total or shipping.
status="$(request -b "$SALON_COOKIE" "$BASE_URL/shop/shipping-quote?weightGrams=1000&subtotal=14999")"
expect_status 200 "$status" "SALON_OWNER reads weighted shipping quote"
expect_json '.shippingCost == 111 and .freeShipping == false and .amountToFreeShipping == 1' "first weight tier and threshold gap are correct"

status="$(request -b "$SALON_COOKIE" "$BASE_URL/shop/shipping-quote?weightGrams=3000&subtotal=15000")"
expect_status 200 "$status" "SALON_OWNER reads free-shipping quote"
expect_json '.shippingCost == 0 and .freeShipping == true and .amountToFreeShipping == 0' "free-shipping threshold is inclusive"
expect_json '[.availableMethods[] | select(.id == "personal_belgrade") | .price][0] == 0' "personal delivery quote is also free at the threshold"

status="$(request_json_as "$SALON_COOKIE" POST /shop/cart/items \
  "{\"productId\":\"$PRODUCT_B_ID\",\"variantValue\":\"Standard\",\"quantity\":5}")"
expect_status 200 "$status" "SALON_OWNER adds threshold items to persistent cart"
expect_json ".itemCount == 5 and .subtotal == 15000" "cart total is server-calculated before threshold checkout"
status="$(request_json_as "$SALON_COOKIE" POST /shop/checkout \
  '{"useSalonAddress":true,"deliveryMethod":"personal_belgrade","paymentMethod":"BANK_TRANSFER","termsAccepted":true}')"
expect_status 201 "$status" "SALON_OWNER creates threshold order with seeded salon address"
THRESHOLD_ORDER_ID="$(json_field '.id')"
expect_json ".shippingCost == 0 and .total == 15000 and .deliveryMethod == \"personal_belgrade\" and .itemCount == 5 and .items[0].price == 3000 and .delivery.postalCode == \"11000\"" "threshold order gets server-side free personal delivery and saved salon delivery data"
expect_json '.courierService == "Lična dostava" and .trackingUrl == null' "personal delivery clearly has no external tracking"

status="$(request_json_as "$SALON_COOKIE" POST /shop/cart/items \
  "{\"productId\":\"$PRODUCT_B_ID\",\"variantValue\":\"Premium\",\"quantity\":2}")"
expect_status 200 "$status" "SALON_OWNER adds weighted items to persistent cart"
status="$(request_json_as "$SALON_COOKIE" POST /shop/checkout \
  "{\"useSalonAddress\":false,\"deliveryAddress\":{\"recipientName\":\"$TEST_SHIPPING_NAME\",\"street\":\"Test 1\",\"city\":\"Beograd\",\"postalCode\":\"11000\",\"phone\":\"+38160111222\",\"email\":\"b2b-regression@example.com\"},\"deliveryMethod\":\"courier\",\"paymentMethod\":\"BANK_TRANSFER\",\"termsAccepted\":true}")"
expect_status 201 "$status" "SALON_OWNER creates weighted order from persistent cart"
WEIGHTED_ORDER_ID="$(json_field '.id')"
expect_json ".shippingCost == 222 and .total == 7222 and .itemCount == 2 and .items[0].price == 3500" "weighted order total uses server-side variant price and shipping"
status="$(request -b "$ADMIN_COOKIE" -X PATCH -H "Content-Type: application/json" \
  --data "$(jq -cn --arg courierServiceId "$BEX_COURIER_ID" '{courierServiceId: $courierServiceId, trackingNumber: "TEST/ 42"}')" \
  "$BASE_URL/admin/orders/$WEIGHTED_ORDER_ID")"
expect_status 200 "$status" "ADMIN assigns courier and tracking number to order"
expect_json '.courierService == "Bex Express" and .trackingNumber == "TEST/ 42" and (.trackingUrl | contains("TEST%2F%2042"))' "tracking URL is generated with URL-encoded tracking number"
status="$(request -b "$SALON_COOKIE" "$BASE_URL/shop/orders/$WEIGHTED_ORDER_ID")"
expect_status 200 "$status" "SALON_OWNER reads assigned shipment tracking"
expect_json '.courierService == "Bex Express" and .courierServiceId != null and (.trackingUrl | contains("TEST%2F%2042"))' "salon sees only its encoded tracking link"

# Verify the root-category move fixes denormalized category fields, then ensure
# that the in-order product is deactivated rather than physically deleted.
status="$(request -b "$ADMIN_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"categoryId\":\"$PARENT_CATEGORY_ID\"}" \
  "$BASE_URL/admin/products/$PRODUCT_B_ID")"
expect_status 200 "$status" "ADMIN moves ordered product before cleanup"
expect_json ".categoryId == \"$PARENT_CATEGORY_ID\" and .categoryName == \"$PARENT_NAME\" and .subcategoryName == null" "moving product to supplier root clears subcategory"
status="$(request -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/admin/products/$PRODUCT_B_ID")"
expect_status 200 "$status" "ADMIN deactivates ordered product on delete"
expect_json '.active == false' "ordered product is protected from hard deletion"

remove_order_fixtures
THRESHOLD_ORDER_ID=""
WEIGHTED_ORDER_ID=""
status="$(request -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/admin/products/$PRODUCT_B_ID")"
expect_status 200 "$status" "ADMIN removes product after isolated order teardown"
PRODUCT_B_ID=""

status="$(request -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/admin/product-categories/$CHILD_CATEGORY_ID")"
expect_status 204 "$status" "ADMIN deletes unused product subcategory"
CHILD_CATEGORY_ID=""
status="$(request -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/admin/product-categories/$PARENT_CATEGORY_ID")"
expect_status 204 "$status" "ADMIN deletes unused product category"
PARENT_CATEGORY_ID=""

status="$(request -b "$ADMIN_COOKIE" -X DELETE "$BASE_URL/admin/brands/$BRAND_ID")"
expect_status 200 "$status" "ADMIN deactivates brand still referenced by an order fixture"
expect_json '.active == false' "in-use brand is deactivated instead of removed"
BRAND_ID=""

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v supplier_id="$SUPPLIER_ID" >/dev/null <<'SQL'
DELETE FROM suppliers WHERE id = :'supplier_id'::uuid;
SQL
SUPPLIER_ID=""

restore_shared_state
verify_test_data_removed
remove_isolated_admin_fixture
verify_isolated_admin_fixture_removed
verify_education_demo_invariant
ISOLATED_ADMIN_EMAIL=""
CLEANUP_COMPLETED=true
echo "B2B catalog regression checks passed."