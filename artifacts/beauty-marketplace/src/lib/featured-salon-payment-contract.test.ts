import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("featured salons use the shared owner-paid placement contract", () => {
  const adminDetail = readFileSync(new URL("../pages/admin/salon-detail.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../pages/home.tsx", import.meta.url), "utf8");
  const marketplace = readFileSync(new URL("../../../api-server/src/routes/marketplace.ts", import.meta.url), "utf8");

  const ownerProfile = readFileSync(new URL("../pages/owner/profile.tsx", import.meta.url), "utf8");
  assert.match(adminDetail, /Red za potvrdu uplata/);
  assert.match(ownerProfile, /useCreateFeaturedPlacement/);
  assert.match(ownerProfile, /QRCodeSVG value=\{placement\.ipsPayload\}/);
  assert.match(home, /featuredSalons/);
  assert.match(home, /params\.append\("featured", "true"\)/);
  assert.match(marketplace, /educationPlacementsTable\.kind,\s*"featured_salon"/);
  assert.match(marketplace, /educationPlacementsTable\.startsAt/);
  assert.match(marketplace, /educationPlacementsTable\.endsAt/);
  assert.match(marketplace, /priceSnapshot:\s*setting\.price/);
  assert.match(marketplace, /durationDaysSnapshot:\s*setting\.durationDays/);
  assert.match(marketplace, /if \(row\.status === "active"\) return \{ placement: row, activated: false \}/);
  assert.match(marketplace, /\.limit\(pageSize\)\.offset\(\(page - 1\) \* pageSize\)/);
  assert.match(marketplace, /educationIpsQrPayload\(\{/);
});

test("featured-placement work keeps Education operational IPS QR contract isolated", () => {
  const educationOperations = readFileSync(new URL("../../../api-server/src/routes/education-operations.ts", import.meta.url), "utf8");
  const educationUi = readFileSync(new URL("../components/education/booking-flow.tsx", import.meta.url), "utf8");
  const openApi = readFileSync(new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");

  assert.match(educationOperations, /\/education\/operations\/bookings\/:bookingGroupId\/installments\/:installmentNumber\/ips-qr/);
  assert.match(educationUi, /useGetEducationOperationalInstallmentIpsQr/);
  assert.match(openApi, /EducationIpsQrPayment/);
  assert.match(openApi, /\/education\/operations\/bookings\/\{bookingGroupId\}\/installments\/\{installmentNumber\}\/ips-qr/);
});

test("shared placement lifecycle expires stale holds and validates placement scope", () => {
  const marketplace = readFileSync(new URL("../../../api-server/src/routes/marketplace.ts", import.meta.url), "utf8");
  const openapi = readFileSync(new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");

  // Creation clears expired pending holds while holding the identical placement
  // namespace lock; confirmation persists expiry instead of activating late
  // payments, while active retries return their original dates.
  assert.match(marketplace, /await lockEducationPlacementResource\(tx, kind, scope, scopeId\);\s+await expireStalePendingPlacement/s);
  assert.match(marketplace, /row\.createdAt\.getTime\(\) \+ EDUCATION_PLACEMENT_PAYMENT_WINDOW_MS <= now\.getTime\(\)/);
  assert.match(marketplace, /status: "expired", updatedAt: now/);
  assert.match(marketplace, /if \(row\.status === "active"\) return \{ placement: row, activated: false \}/);
  assert.match(marketplace, /validateSharedPlacementScope\(row\.kind, row\.scope/);
  assert.match(marketplace, /course\.categoryId !== scopeId|course\.subcategoryId !== scopeId/);

  // Consumers use only the shared operations; retired education-only routes
  // cannot be regenerated or accidentally reintroduced in owner/admin UI.
  assert.doesNotMatch(openapi, /operationId: purchaseEducationPlacement/);
  assert.doesNotMatch(openapi, /operationId: settleAdminEducationPlacement/);
  assert.match(openapi, /operationId: createFeaturedPlacement/);
  assert.match(openapi, /operationId: confirmAdminFeaturedPlacement/);
});

test("payment instructions are immutable placement snapshots", () => {
  const marketplace = readFileSync(new URL("../../../api-server/src/routes/marketplace.ts", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../../../../lib/db/src/schema/education.ts", import.meta.url), "utf8");

  assert.match(schema, /paymentIpsPayloadSnapshot:\s*text\("payment_ips_payload_snapshot"\)/);
  assert.match(schema, /paymentRecipientAccountSnapshot:\s*text\("payment_recipient_account_snapshot"\)/);
  assert.match(marketplace, /paymentIpsPayloadSnapshot:\s*ips\.payload/);
  assert.match(marketplace, /ipsPayload:\s*row\.paymentIpsPayloadSnapshot!/);
  assert.match(marketplace, /if \(!hasPaymentSnapshot\)/);
  assert.match(marketplace, /paymentInstructionsAvailable:\s*false/);

  const viewStart = marketplace.indexOf("async function featuredPlacementView");
  const viewEnd = marketplace.indexOf("async function expireStalePendingPlacement");
  const view = marketplace.slice(viewStart, viewEnd);
  assert.doesNotMatch(view, /getEducationPlatformSettings|educationIpsQrPayload/,
    "list and confirmation views must not rebuild historical instructions from mutable global settings");
});

test("every public discovery shelf derives featured from active paid placement", () => {
  const marketplace = readFileSync(new URL("../../../api-server/src/routes/marketplace.ts", import.meta.url), "utf8");
  const discoveryStart = marketplace.indexOf('router.get("/discovery/home"');
  const discoveryEnd = marketplace.indexOf('router.get("/platform/trust-stats"');
  const discovery = marketplace.slice(discoveryStart, discoveryEnd);

  assert.match(discovery, /paidFeaturedRows/);
  assert.match(discovery, /educationPlacementsTable\.kind,\s*"featured_salon"/);
  assert.match(discovery, /educationPlacementsTable\.status,\s*"active"/);
  assert.match(discovery, /lte\(educationPlacementsTable\.startsAt/);
  assert.match(discovery, /gt\(educationPlacementsTable\.endsAt/);
  assert.match(discovery, /featured:\s*paidFeaturedSalonIds\.has\(salon\.id\)/);
  assert.doesNotMatch(discovery.slice(discovery.indexOf("const cardById"), discovery.indexOf("const cardsFor")), /featured:\s*salon\.featured/);
  assert.match(marketplace, /settlement\.activated && settlement\.placement\.kind === "featured_salon"/);
  assert.match(marketplace, /await publishCatalogInvalidation\(\["salons"\]\)/);
});