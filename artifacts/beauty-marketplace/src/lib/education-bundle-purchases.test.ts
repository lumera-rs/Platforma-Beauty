import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("education bundle UI retains the purchase and settlement safeguards", () => {
  const business = readFileSync(new URL("../pages/business-education-bundles.tsx", import.meta.url), "utf8");
  const marketplace = readFileSync(new URL("../pages/education-marketplace.tsx", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../pages/admin/education-marketplace.tsx", import.meta.url), "utf8");
  assert.match(business, /courseIds:\s*\[\]\s*as string\[\]/);
  assert.match(business, /\.filter\(course => course\.centerId === centerId && course\.published !== false && !course\.archived\)/);
  assert.match(business, /Objavi paket u marketplace-u/);
  assert.match(business, /published && !formData\.courseIds\.length/);
  assert.match(marketplace, /targetType:\s*"salon_employee", salonId: employee\.salonId, employeeId: employee\.id/);
  assert.match(marketplace, /Čeka potvrdu uplate/);
  assert.match(marketplace, /pristup još nije aktivan/);
  assert.match(marketplace, /export function EducationBundlePurchasesPage/);
  assert.match(marketplace, /\/api\/education\/bundle-purchases/);
  assert.match(admin, /\/admin\/education\/bundle-purchases\/\$\{(?:id|purchaseId)\}\/settle/);
  assert.match(admin, /Paketi edukacija na čekanju/);
});