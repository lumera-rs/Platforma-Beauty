import assert from "node:assert/strict";
import test from "node:test";
import { activeProductSale } from "./active-product-sale";

const now = new Date("2026-03-01T12:00:00.000Z");
const base = {
  discountPrice: 800,
  discountPriceEndsAt: null,
  publicDiscountPrice: 900,
  publicDiscountPriceEndsAt: null,
};

test("activeProductSale preserves no-expiry behavior independently by channel", () => {
  assert.deepEqual(activeProductSale(base, "B2B", now), { price: 800, endsAt: null });
  assert.deepEqual(activeProductSale(base, "B2C", now), { price: 900, endsAt: null });
});

test("activeProductSale uses an exclusive end boundary", () => {
  const before = new Date(now.getTime() + 1);
  const product = {
    ...base,
    discountPriceEndsAt: before,
    publicDiscountPriceEndsAt: now,
  };
  assert.deepEqual(activeProductSale(product, "B2B", now), { price: 800, endsAt: before });
  assert.equal(activeProductSale(product, "B2C", now), null);
  assert.equal(activeProductSale({ ...product, discountPriceEndsAt: new Date(now.getTime() - 1) }, "B2B", now), null);
});

test("an expiry never creates a sale without its channel price", () => {
  assert.equal(activeProductSale({ ...base, discountPrice: null, discountPriceEndsAt: new Date(now.getTime() + 1) }, "B2B", now), null);
  assert.equal(activeProductSale({ ...base, publicDiscountPrice: null, publicDiscountPriceEndsAt: new Date(now.getTime() + 1) }, "B2C", now), null);
});