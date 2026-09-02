import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeIsoTimestamp } from "./date-serialization";

assert.equal(safeIsoTimestamp(new Date("2026-09-02T10:15:30.000Z")), "2026-09-02T10:15:30.000Z");
assert.equal(safeIsoTimestamp("2026-09-02T10:15:30.000Z"), "2026-09-02T10:15:30.000Z");
assert.equal(safeIsoTimestamp(null), null);
assert.equal(safeIsoTimestamp(undefined), null);
assert.equal(safeIsoTimestamp(new Date(Number.NaN)), null);
assert.equal(safeIsoTimestamp("not-a-timestamp"), null);
assert.equal(safeIsoTimestamp({}), null);

const rows = [
  {
    id: "damaged",
    createdAt: new Date(Number.NaN),
    updatedAt: new Date("2026-09-02T11:15:30.000Z"),
    nested: {
      startsAt: new Date(Number.NaN),
      endsAt: new Date("2026-09-02T12:15:30.000Z"),
    },
  },
  {
    id: "valid",
    createdAt: new Date("2026-09-02T10:15:30.000Z"),
    updatedAt: new Date("2026-09-02T11:15:30.000Z"),
    nested: {
      startsAt: new Date("2026-09-02T11:30:30.000Z"),
      endsAt: new Date("2026-09-02T12:30:30.000Z"),
    },
  },
];
const response = rows.map((row) => ({
  id: row.id,
  createdAt: safeIsoTimestamp(row.createdAt),
  updatedAt: safeIsoTimestamp(row.updatedAt),
  nested: {
    startsAt: safeIsoTimestamp(row.nested.startsAt),
    endsAt: safeIsoTimestamp(row.nested.endsAt),
  },
}));

assert.deepEqual(response, [
  {
    id: "damaged",
    createdAt: null,
    updatedAt: "2026-09-02T11:15:30.000Z",
    nested: { startsAt: null, endsAt: "2026-09-02T12:15:30.000Z" },
  },
  {
    id: "valid",
    createdAt: "2026-09-02T10:15:30.000Z",
    updatedAt: "2026-09-02T11:15:30.000Z",
    nested: {
      startsAt: "2026-09-02T11:30:30.000Z",
      endsAt: "2026-09-02T12:30:30.000Z",
    },
  },
]);

const marketplaceSource = readFileSync(new URL("../routes/marketplace.ts", import.meta.url), "utf8");
function sourceBetween(start: string, end: string): string {
  const startIndex = marketplaceSource.indexOf(start);
  const endIndex = marketplaceSource.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Expected marketplace source bounds: ${start} → ${end}`);
  return marketplaceSource.slice(startIndex, endIndex);
}

for (const [name, source] of [
  ["salon cards", sourceBetween("function card(", "async function salonHasActiveHomeService")],
  ["public salon review lists", sourceBetween("reviews: reviews.map((item) => {", "router.get(\"/inspiracija\"")],
  ["education session lists", sourceBetween("async function sessionsForCourse(", "function educationMediaRouteUrl")],
  ["education review lists", sourceBetween("async function courseReviewViews(", "async function centerPublicView")],
  ["education course view", sourceBetween("async function educationCourseView(", "async function educationEnrollmentView")],
  ["education enrollment lists", sourceBetween("async function batchEducationEnrollmentViews(", "async function requireCustomer")],
  ["retail order lists", sourceBetween("function retailOrderDto(", "async function adminRetailOrderDetail")],
  ["retail review lists", sourceBetween("async function productReviewViews(", "router.get(\"/shop/public/products\"")],
  ["retail wishlist", sourceBetween("async function wishlistItemDto(", "router.get(\"/retail/wishlist\"")],
  ["approval request lists", sourceBetween("function approvalRequestDto(", "router.post(\"/shop/approval-requests\"")],
  ["owner order lists", sourceBetween("function orderDto(", "function adminOrderDto")],
  ["education notification lists", sourceBetween("router.get(\"/education/notifications\"", "router.patch(\"/education/notifications/")],
  ["batch education course lists", sourceBetween("export async function batchEducationCourseViews(", "async function publicCourseCard")],
  ["education wishlist", sourceBetween("router.get(\"/education/wishlist\"", "router.post(\"/education/wishlist\"")],
  ["instructor lists", sourceBetween("function instructorProfileView(", "function instructorProfileSummary")],
  ["education dispute lists", sourceBetween("router.get(\"/education/disputes\"", "router.get(\"/admin/summary\"")],
  ["education purchase message lists", sourceBetween("router.get(\"/education/purchases/:enrollmentId/messages\"", "router.post(\"/education/purchases/:enrollmentId/messages\"")],
]) {
  assert.doesNotMatch(source, /\.toISOString\(\)/, `${name} must not directly serialize selected timestamps`);
}

process.stdout.write("✓ safe list timestamp serialization regression suite passed\n");
