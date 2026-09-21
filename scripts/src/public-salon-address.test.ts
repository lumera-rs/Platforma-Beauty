import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { GetSalonResponse } from "@workspace/api-zod";
import { publicSalonAddress } from "../../artifacts/beauty-marketplace/public-salon-address.mjs";

test("existing street and postal locality preserve entered text without stray separators", () => {
  assert.equal(publicSalonAddress({ address: "Tošin bunar 181", postalCode: "11000", city: "Beograd" })?.text, "Tošin bunar 181, 11000 Beograd");
  assert.equal(publicSalonAddress({ address: "Put 1", city: "Niš" })?.text, "Put 1, Niš");
  assert.equal(publicSalonAddress({ address: "Put 1" })?.text, "Put 1");
  assert.equal(publicSalonAddress({ address: "" }), null);
});

test("Maps and PostalAddress use an explicit street-only allowlist, never phone/geo/details", () => {
  const source = { address: "Tošin bunar 181", postalCode: "11000", city: "Beograd", phone: "PRIVATE_PHONE", latitude: 44.12345, longitude: 20.12345, entranceDirections: "PRIVATE_ENTRANCE", intercom: "PRIVATE_INTERCOM", floor: "PRIVATE_FLOOR", apartment: "PRIVATE_APARTMENT", phonePublic: true };
  const result = publicSalonAddress(source)!;
  const url = new URL(result.href);
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("query"), "Tošin bunar 181, 11000 Beograd, Serbia");
  assert.deepEqual(result.postalAddress, { "@type": "PostalAddress", streetAddress: source.address, postalCode: "11000", addressLocality: "Beograd", addressCountry: "RS" });
  assert.doesNotMatch(JSON.stringify({ href: result.href, postalAddress: result.postalAddress }), /PRIVATE_|44\.12345|20\.12345/);
  assert.doesNotMatch(result.text, /PRIVATE_PHONE|44\.12345|20\.12345/);
  for (const state of [{ active: false }, { published: false }, { hideAddress: true }]) {
    assert.equal(publicSalonAddress({ ...source, ...state }), null);
  }
});

test("public API adds address details after active eligibility; client uses safe text links", () => {
  const route = fs.readFileSync(new URL("../../artifacts/api-server/src/routes/marketplace.ts", import.meta.url), "utf8");
  const profile = route.split('router.get("/salons/:slug"')[1].split('router.get("/inspiracija"')[0];
  assert.match(profile, /eq\(salonsTable.active, true\)/);
  assert.match(profile, /address: salon.address/);
  assert.match(profile, /postalCode: salon.postalCode/);
  for (const key of ["entranceDirections", "intercom", "floor", "apartment"]) {
    assert.ok(profile.includes(`${key}: salon.${key}`));
  }
  assert.doesNotMatch(profile, /(?:phone|latitude|longitude): salon\./);
  const client = fs.readFileSync(new URL("../../artifacts/beauty-marketplace/src/pages/salon-profile.tsx", import.meta.url), "utf8");
  assert.match(client, /target="_blank" rel="noopener noreferrer"/);
  assert.match(client, /\{publicSalonAddress\(salonData\)!\.text\}/);
  assert.equal(fs.existsSync(new URL("../../artifacts/beauty-marketplace/src/components/simple-map.tsx", import.meta.url)), false);
});

test("generated public API response preserves street/postal code and strips private fields", () => {
  const dto = GetSalonResponse.parse({
    id: "fixture", slug: "fixture", name: "Fixture", city: "Beograd", municipality: "",
    imageUrl: "", coverImageDescription: null, rating: 0, reviewCount: 0,
    shortDescription: "", popularServices: [], startingPrice: 0, homeService: false,
    featured: false, topSalon: false, acceptsCards: false, instantBooking: false,
    servesMen: false, isVerified: false, hasDiscount: false, openSunday: false, createdAt: null,
    gallery: [], videoUrl: null, description: "", topServices: [], hours: [], staff: [],
    services: [], reviews: [], returnClientRate: null, homeServiceRadiusKm: 10,
    address: "Put 1", postalCode: "11000", entranceDirections: "bočni ulaz", intercom: "22 enter", floor: "prizemlje", apartment: "22",
    phone: "PRIVATE_PHONE", email: "PRIVATE_EMAIL", latitude: 44.12345, longitude: 20.12345,
    companyAddress: "PRIVATE_BILLING", ownerId: "PRIVATE_OWNER",
  });
  assert.equal(dto.address, "Put 1");
  assert.equal(dto.postalCode, "11000");
  assert.equal(publicSalonAddress(dto)?.text, "Put 1, (bočni ulaz), interfon 22 enter, prizemlje, stan 22, 11000 Beograd");
  assert.doesNotMatch(JSON.stringify(dto), /PRIVATE_|latitude|longitude/);
});

test("all sixteen optional detail combinations omit empty punctuation and preserve floor text", () => {
  const base = { address: "Tošin bunar 181", postalCode: "11000", city: "Beograd" };
  const values = {
    entranceDirections: "ulaz sa bočne strane odmah pored dečijeg tobogana",
    intercom: "22 enter", floor: "IV sprat", apartment: "22",
  };
  const fragments = [`(${values.entranceDirections})`, "interfon 22 enter", "IV sprat", "stan 22"];
  for (let mask = 0; mask < 16; mask++) {
    const details = Object.fromEntries(Object.entries(values).map(([key, value], index) => [key, mask & (1 << index) ? value : null]));
    assert.equal(publicSalonAddress({ ...base, ...details })?.text,
      [base.address, ...fragments.filter((_, index) => mask & (1 << index)), "11000 Beograd"].join(", "));
    assert.equal(new URL(publicSalonAddress({ ...base, ...details })!.href).searchParams.get("query"),
      "Tošin bunar 181, 11000 Beograd, Serbia");
  }
  for (const floor of ["prizemlje", "4. sprat", "IV sprat", "međusprat"]) {
    assert.equal(publicSalonAddress({ address: "Put 1", floor })?.text, `Put 1, ${floor}`);
  }
  assert.equal(publicSalonAddress({ ...base, entranceDirections: " ", intercom: "", floor: null, apartment: "" })?.text,
    "Tošin bunar 181, 11000 Beograd");
});