import assert from "node:assert/strict";
import { previousBelgradeCalendarMonth, selectEducationB2bTier } from "../routes/education-b2b-discounts";

const winter = previousBelgradeCalendarMonth(new Date("2025-03-15T12:00:00Z"));
assert.equal(winter.start.toISOString(), "2025-01-31T23:00:00.000Z");
assert.equal(winter.end.toISOString(), "2025-02-28T23:00:00.000Z");

const dst = previousBelgradeCalendarMonth(new Date("2025-04-15T12:00:00Z"));
assert.equal(dst.start.toISOString(), "2025-02-28T23:00:00.000Z");
assert.equal(dst.end.toISOString(), "2025-03-31T22:00:00.000Z");

const tiers = [
  { id: "a", name: "A", discountPercent: 1, minSpendRsd: 0, maxSpendRsd: 9999 },
  { id: "b", name: "B", discountPercent: 2, minSpendRsd: 10000, maxSpendRsd: 19999 },
  { id: "c", name: "C", discountPercent: 3, minSpendRsd: 20000, maxSpendRsd: null },
];
assert.equal(selectEducationB2bTier(tiers, 0)?.id, "a");
assert.equal(selectEducationB2bTier(tiers, 9999)?.id, "a");
assert.equal(selectEducationB2bTier(tiers, 10000)?.id, "b");
assert.equal(selectEducationB2bTier(tiers, 20000)?.id, "c");
assert.equal(selectEducationB2bTier([], 10000), null);

console.log("education B2B discount tests passed");