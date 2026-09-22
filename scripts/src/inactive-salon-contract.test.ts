import assert from "node:assert/strict";
import test from "node:test";
import { GetSalonResponse } from "@workspace/api-zod";
import { readFileSync } from "node:fs";

test("inactive public salon contract contains exactly name, inactive state and public city", () => {
  const result = GetSalonResponse.parse({
    name: "Fixture", active: false,
    address: "PRIVATE_ADDRESS", city: "Niš", phone: "PRIVATE_PHONE", entranceDirections: "PRIVATE_ENTRANCE",
    intercom: "PRIVATE_INTERCOM", floor: "PRIVATE_FLOOR", apartment: "PRIVATE_APARTMENT",
    latitude: 44, longitude: 20, email: "PRIVATE_EMAIL",
  });
  assert.deepEqual(result, { name: "Fixture", active: false, city: "Niš" });
  assert.deepEqual(Object.keys(result).sort(), ["active", "city", "name"]);
  const route = readFileSync(new URL("../../artifacts/api-server/src/routes/marketplace.ts", import.meta.url), "utf8")
    .split('router.get("/salons/:slug"')[1].split("const [services, staff")[0];
  assert.match(route, /db\.select\(\{ name: salonsTable\.name, city: salonsTable\.city \}\)/);
  assert.match(route, /res\.json\(\{ name: inactive\.name, active: false, city: inactive\.city \}\)/);
});