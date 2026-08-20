#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${LUMERA_API_BASE_URL:-}" ]]; then
  BASE_URL="${LUMERA_API_BASE_URL%/}"
elif [[ -n "${REPLIT_DEV_DOMAIN:-}" ]]; then
  BASE_URL="https://${REPLIT_DEV_DOMAIN}/api"
else
  echo "Set LUMERA_API_BASE_URL or REPLIT_DEV_DOMAIN before running this test." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required so the isolated order fixtures can be removed after the test." >&2
  exit 1
fi
if ! command -v psql >/dev/null; then
  echo "psql is required so the isolated order fixtures can be removed after the test." >&2
  exit 1
fi

DEMO_PASSWORD="${LUMERA_DEMO_PASSWORD:-LumeraDemo2026!}"
RUN_ID="${LUMERA_B2B_TEST_ID:-$(date +%s%N)}"
SUPER_COOKIE="$(mktemp)"
ADMIN_COOKIE="$(mktemp)"
CUSTOMER_COOKIE="$(mktemp)"
SALON_COOKIE="$(mktemp)"
BODY="$(mktemp)"

TARGET_ID=""
ORIGINAL_ROLE=""
ORIGINAL_ACTIVE=""
ORIGINAL_SHIPPING=""
PARENT_CATEGORY_ID=""
CHILD_CATEGORY_ID=""
PRODUCT_A_ID=""
PRODUCT_B_ID=""
BRAND_ID=""
UNUSED_BRAND_ID=""
SUPER_BRAND_ID=""
SUPER_CATEGORY_ID=""
SUPER_PRODUCT_ID=""
ROOT_CATEGORY_ID=""
ROOT_CATEGORY_NAME=""
THRESHOLD_ORDER_ID=""
WEIGHTED_ORDER_ID=""
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
      '{freeShippingThreshold,tiers} == $original' "$BODY" >/dev/null || return 1
  fi

  if [[ -n "$TARGET_ID" && -n "$ORIGINAL_ROLE" && -n "$ORIGINAL_ACTIVE" ]]; then
    status="$(request -b "$SUPER_COOKIE" -X PATCH \
      -H "Content-Type: application/json" \
      --data "{\"role\":\"$ORIGINAL_ROLE\",\"active\":$ORIGINAL_ACTIVE}" \
      "$BASE_URL/admin/users/$TARGET_ID")"
    [[ "$status" == "200" ]] || return 1
    status="$(request -b "$SUPER_COOKIE" "$BASE_URL/admin/users")"
    [[ "$status" == "200" ]] || return 1
    jq -e --arg id "$TARGET_ID" --arg role "$ORIGINAL_ROLE" --argjson active "$ORIGINAL_ACTIVE" \
      '.[] | select(.id == $id and .role == $role and .active == $active)' "$BODY" >/dev/null || return 1
  fi
}

verify_test_data_removed() {
  local counts
  counts="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
    select count(*) from product_categories where name like 'B2B Regression %${RUN_ID}%';
    select count(*) from products where sku like 'LUMERA-REG-${RUN_ID}%';
    select count(*) from product_brands where name like 'B2B Test Brand%${RUN_ID}%' or name like 'B2B Unused Brand%${RUN_ID}%' or name like 'B2B Super Brand%${RUN_ID}%';
    select count(*) from orders where shipping_name = '${TEST_SHIPPING_NAME}';
  ")" || return 1
  [[ "$counts" == $'0\n0\n0\n0' ]]
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
  if [[ -n "$PRODUCT_B_ID" && -n "$ROOT_CATEGORY_ID" ]]; then
    curl -sS -o /dev/null -b "$SUPER_COOKIE" -X PATCH \
      -H "Content-Type: application/json" \
      --data "{\"categoryId\":\"$ROOT_CATEGORY_ID\"}" \
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

  restore_shared_state || cleanup_failed=true
  verify_test_data_removed || cleanup_failed=true
  rm -f "$SUPER_COOKIE" "$ADMIN_COOKIE" "$CUSTOMER_COOKIE" "$SALON_COOKIE" "$BODY"
  if [[ "$cleanup_failed" == true ]]; then
    echo "FAIL: rollback could not be fully verified; inspect the API and test database before rerunning." >&2
  fi
  trap - EXIT
  exit "$([[ "$original_status" == 0 || "$cleanup_failed" == true ]] && echo 1 || echo "$original_status")"
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

# Establish SUPER_ADMIN access and remember the existing role of the temporary
# ADMIN fixture so the script is safe to rerun against a seeded environment.
login "$SUPER_COOKIE" "admin@lumera.local"
status="$(request -b "$SUPER_COOKIE" "$BASE_URL/admin/users")"
expect_status 200 "$status" "SUPER_ADMIN user list"
TARGET_ID="$(jq -r '.[] | select(.email == "edukacija@lumera.local") | .id' "$BODY")"
ORIGINAL_ROLE="$(jq -r '.[] | select(.email == "edukacija@lumera.local") | .role' "$BODY")"
ORIGINAL_ACTIVE="$(jq -r '.[] | select(.email == "edukacija@lumera.local") | .active' "$BODY")"
if [[ -z "$TARGET_ID" || "$TARGET_ID" == "null" ]]; then
  echo "FAIL: seeded ADMIN fixture edukacija@lumera.local was not found." >&2
  exit 1
fi

status="$(request -b "$SUPER_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data '{"role":"ADMIN","active":true}' \
  "$BASE_URL/admin/users/$TARGET_ID")"
expect_status 200 "$status" "SUPER_ADMIN grants temporary ADMIN fixture"
login "$ADMIN_COOKIE" "edukacija@lumera.local"
login "$CUSTOMER_COOKIE" "kupac@lumera.local"
login "$SALON_COOKIE" "salon@lumera.local"
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
    'PUT|/admin/shipping|{"freeShippingThreshold":0,"tiers":[]}|shipping configuration'; do
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

status="$(request -b "$SUPER_COOKIE" "$BASE_URL/admin/product-categories")"
expect_status 200 "$status" "read root category for isolated cleanup"
ROOT_CATEGORY_ID="$(jq -r '[.[] | select(.parentId == null) | .id][0] // empty' "$BODY")"
ROOT_CATEGORY_NAME="$(jq -r '[.[] | select(.parentId == null) | .name][0] // empty' "$BODY")"
if [[ -z "$ROOT_CATEGORY_ID" || -z "$ROOT_CATEGORY_NAME" ]]; then
  echo "FAIL: no existing root product category is available for cleanup." >&2
  exit 1
fi

# Product categories: create, validate uniqueness, update and later delete.
PARENT_NAME="B2B Regression ${RUN_ID}"
CHILD_NAME="B2B Regression Child ${RUN_ID}"
status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$PARENT_NAME\",\"sortOrder\":90,\"active\":true}" \
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

# Save shipping configuration only after confirming the API and teardown
# database are the same environment.
status="$(request -b "$SUPER_COOKIE" "$BASE_URL/admin/shipping")"
expect_status 200 "$status" "read shipping configuration for isolation"
ORIGINAL_SHIPPING="$(jq -c '{freeShippingThreshold,tiers}' "$BODY")"

status="$(request -b "$SUPER_COOKIE" -X PUT \
  -H "Content-Type: application/json" \
  --data '{"freeShippingThreshold":15000,"tiers":[{"maxWeightGrams":1000,"price":111,"label":"test do 1 kg"},{"maxWeightGrams":3000,"price":222,"label":"test do 3 kg"},{"maxWeightGrams":10000,"price":333,"label":"test do 10 kg"}]}' \
  "$BASE_URL/admin/shipping")"
expect_status 200 "$status" "SUPER_ADMIN replaces shipping tiers"
expect_json '.freeShippingThreshold == 15000 and [.tiers[].maxWeightGrams] == [1000,3000,10000]' "shipping tiers are sorted and persisted"

status="$(request -b "$ADMIN_COOKIE" -X PUT \
  -H "Content-Type: application/json" \
  --data '{"freeShippingThreshold":15000,"tiers":[{"maxWeightGrams":1000,"price":111,"label":"test do 1 kg"},{"maxWeightGrams":1000,"price":222,"label":"duplicate"}]}' \
  "$BASE_URL/admin/shipping")"
expect_status 400 "$status" "duplicate shipping weight rejected"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$PARENT_NAME\",\"sortOrder\":90}" \
  "$BASE_URL/admin/product-categories")"
expect_status 409 "$status" "duplicate category rejected"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$CHILD_NAME\",\"parentId\":\"$PARENT_CATEGORY_ID\",\"sortOrder\":1}" \
  "$BASE_URL/admin/product-categories")"
expect_status 201 "$status" "ADMIN creates product subcategory"
CHILD_CATEGORY_ID="$(json_field '.id')"

SUPER_CATEGORY_NAME="B2B Super Category ${RUN_ID}"
status="$(request -b "$SUPER_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"$SUPER_CATEGORY_NAME\",\"sortOrder\":91}" \
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
common_product_fields="\"categoryId\":\"$CHILD_CATEGORY_ID\",\"categoryName\":\"ignored\",\"brand\":\"$RENAMED_BRAND_NAME\",\"description\":\"Regression product\",\"shortDescription\":\"B2B test\",\"imageUrl\":\"/test/b2b-regression.jpg\",\"images\":[],\"unit\":\"kom\",\"isNew\":false,\"isBestseller\":false,\"active\":true"

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

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"Product A $RUN_ID\",$common_product_fields,\"price\":1200,\"discountPrice\":900,\"stock\":5,\"sku\":\"LUMERA-REG-${RUN_ID}-A\",\"weightGrams\":500}" \
  "$BASE_URL/admin/products")"
expect_status 201 "$status" "ADMIN creates product"
PRODUCT_A_ID="$(json_field '.id')"
expect_json ".sku == \"LUMERA-REG-${RUN_ID}-A\" and .categoryId == \"$CHILD_CATEGORY_ID\" and .subcategoryName == \"${CHILD_NAME} Renamed\"" "product category denormalization is correct"

status="$(request -b "$ADMIN_COOKIE" -X POST \
  -H "Content-Type: application/json" \
  --data "{\"name\":\"Product B $RUN_ID\",$common_product_fields,\"price\":5000,\"discountPrice\":3000,\"stock\":10,\"sku\":\"LUMERA-REG-${RUN_ID}-B\",\"weightGrams\":1500,\"variants\":[{\"label\":\"Finish\",\"value\":\"Standard\",\"stock\":5},{\"label\":\"Finish\",\"value\":\"Premium\",\"priceAdjust\":500,\"stock\":5}]}" \
  "$BASE_URL/admin/products")"
expect_status 201 "$status" "ADMIN creates variant product"
PRODUCT_B_ID="$(json_field '.id')"
expect_json ".stock == 10 and ([.variants[].stock] | add) == 10" "variant inventory sum is accepted"

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

status="$(request_json_as "$SALON_COOKIE" POST /shop/cart/items \
  "{\"productId\":\"$PRODUCT_B_ID\",\"variantValue\":\"Standard\",\"quantity\":5}")"
expect_status 200 "$status" "SALON_OWNER adds threshold items to persistent cart"
expect_json ".itemCount == 5 and .subtotal == 15000" "cart total is server-calculated before threshold checkout"
status="$(request_json_as "$SALON_COOKIE" POST /shop/checkout \
  '{"useSalonAddress":true,"paymentMethod":"BANK_TRANSFER","termsAccepted":true}')"
expect_status 201 "$status" "SALON_OWNER creates threshold order with seeded salon address"
THRESHOLD_ORDER_ID="$(json_field '.id')"
expect_json ".shippingCost == 0 and .total == 15000 and .itemCount == 5 and .items[0].price == 3000 and .delivery.postalCode == \"11000\"" "threshold order gets server-side free shipping and saved salon delivery data"

status="$(request_json_as "$SALON_COOKIE" POST /shop/cart/items \
  "{\"productId\":\"$PRODUCT_B_ID\",\"variantValue\":\"Premium\",\"quantity\":2}")"
expect_status 200 "$status" "SALON_OWNER adds weighted items to persistent cart"
status="$(request_json_as "$SALON_COOKIE" POST /shop/checkout \
  "{\"useSalonAddress\":false,\"deliveryAddress\":{\"recipientName\":\"$TEST_SHIPPING_NAME\",\"street\":\"Test 1\",\"city\":\"Beograd\",\"postalCode\":\"11000\",\"phone\":\"+38160111222\",\"email\":\"b2b-regression@example.com\"},\"paymentMethod\":\"BANK_TRANSFER\",\"termsAccepted\":true}")"
expect_status 201 "$status" "SALON_OWNER creates weighted order from persistent cart"
WEIGHTED_ORDER_ID="$(json_field '.id')"
expect_json ".shippingCost == 222 and .total == 7222 and .itemCount == 2 and .items[0].price == 3500" "weighted order total uses server-side variant price and shipping"

# Verify the root-category move fixes denormalized category fields, then ensure
# that the in-order product is deactivated rather than physically deleted.
status="$(request -b "$ADMIN_COOKIE" -X PATCH \
  -H "Content-Type: application/json" \
  --data "{\"categoryId\":\"$ROOT_CATEGORY_ID\"}" \
  "$BASE_URL/admin/products/$PRODUCT_B_ID")"
expect_status 200 "$status" "ADMIN moves ordered product before cleanup"
expect_json ".categoryId == \"$ROOT_CATEGORY_ID\" and .categoryName == \"$ROOT_CATEGORY_NAME\" and .subcategoryName == null" "moving product to root clears subcategory"
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

restore_shared_state
verify_test_data_removed
CLEANUP_COMPLETED=true
echo "B2B catalog regression checks passed."