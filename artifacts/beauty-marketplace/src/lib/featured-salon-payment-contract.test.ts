import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("featured salons remain admin-controlled and publicly discoverable", () => {
  const adminDetail = readFileSync(new URL("../pages/admin/salon-detail.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../pages/home.tsx", import.meta.url), "utf8");
  const marketplace = readFileSync(new URL("../../../api-server/src/routes/marketplace.ts", import.meta.url), "utf8");

  assert.match(adminDetail, /Istaknuti salon/);
  assert.match(adminDetail, /update\("featured", \{ featured: checked \}\)/);
  assert.match(home, /featuredSalons/);
  assert.match(home, /params\.append\("featured", "true"\)/);
  assert.match(marketplace, /featured:\s*salon\.featured/);
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