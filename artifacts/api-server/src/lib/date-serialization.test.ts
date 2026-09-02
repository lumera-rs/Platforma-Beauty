import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AdminCreateCourierServiceResponse,
  CreatePublicEducationCourseInquiryResponse,
  GetEducationCourseFeaturedStatusResponse,
  TrackRetailOrderResponse,
} from "@workspace/api-zod";
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

const mutationRow = {
  id: "saved",
  createdAt: new Date(Number.NaN),
  updatedAt: new Date("2026-09-02T13:15:30.000Z"),
  status: "active",
};
assert.deepEqual({
  id: mutationRow.id,
  createdAt: safeIsoTimestamp(mutationRow.createdAt),
  updatedAt: safeIsoTimestamp(mutationRow.updatedAt),
  status: mutationRow.status,
}, {
  id: "saved",
  createdAt: null,
  updatedAt: "2026-09-02T13:15:30.000Z",
  status: "active",
});

const trackingResponse = TrackRetailOrderResponse.parse({
  orderNumber: "LMR-100",
  status: "RECEIVED",
  statusLabel: "Porudžbina primljena",
  createdAt: safeIsoTimestamp(new Date(Number.NaN)),
  statusUpdatedAt: safeIsoTimestamp(new Date("2026-09-02T14:15:30.000Z")),
  progressStage: 1,
  trackingNumber: null,
  courierUrl: null,
});
assert.equal(trackingResponse.createdAt, null);
assert.equal(trackingResponse.statusUpdatedAt?.toISOString(), "2026-09-02T14:15:30.000Z");
assert.equal(trackingResponse.orderNumber, "LMR-100");

const inquiryResponse = CreatePublicEducationCourseInquiryResponse.parse({
  id: "inquiry",
  courseId: "course",
  status: "new",
  createdAt: safeIsoTimestamp(new Date(Number.NaN)),
});
assert.deepEqual(inquiryResponse, {
  id: "inquiry",
  courseId: "course",
  status: "new",
  createdAt: null,
});

const courierResponse = AdminCreateCourierServiceResponse.parse({
  id: "courier",
  code: "courier-code",
  name: "Kurirska služba",
  trackingUrlTemplate: null,
  active: true,
  createdAt: safeIsoTimestamp(new Date(Number.NaN)),
  updatedAt: safeIsoTimestamp(new Date("2026-09-02T15:15:30.000Z")),
});
assert.equal(courierResponse.createdAt, null);
assert.equal(courierResponse.updatedAt?.toISOString(), "2026-09-02T15:15:30.000Z");
assert.equal(courierResponse.active, true);

const featuredResponse = GetEducationCourseFeaturedStatusResponse.parse({
  courseId: "course",
  isFeatured: true,
  featuredUntil: null,
  featuredFee: 1000,
  featuredCoursePrice: 1000,
  charge: {
    id: "charge",
    amount: 1000,
    status: "pending",
    paymentReference: null,
    activatedAt: safeIsoTimestamp(new Date(Number.NaN)),
    settledAt: safeIsoTimestamp(new Date("2026-09-02T16:15:30.000Z")),
  },
});
assert.equal(featuredResponse.charge?.activatedAt, null);
assert.equal(featuredResponse.charge?.settledAt?.toISOString(), "2026-09-02T16:15:30.000Z");
assert.equal(featuredResponse.courseId, "course");

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
  ["public retail tracking detail", sourceBetween("function publicTrackingDto(", "async function retailLookupRateLimited")],
  ["product waitlist detail", sourceBetween("async function productWaitlistStatus(", "async function unsubscribeProductWaitlist")],
  ["product review mutations", sourceBetween("router.post(\"/shop/products/:productId/reviews\"", "// ── Shipping calculation")],
  ["courier service detail", sourceBetween("function courierServiceDto(", "function trackingUrlFor")],
  ["education course mutations", sourceBetween("router.patch(\"/education/courses/:courseId\"", "router.post(\"/education/courses/:courseId/publish\"")],
  ["education featured detail and mutations", sourceBetween("function featuredChargeView(", "router.patch(\"/education/courses/:courseId/instructor\"")],
  ["education session creation", sourceBetween("router.post(\"/education/courses/:courseId/sessions\"", "router.post(\"/education/courses/:courseId/enrollments\"")],
  ["education session updates", sourceBetween("router.patch(\"/education/sessions/:sessionId\"", "router.delete(\"/education/sessions/:sessionId\"")],
  ["education inquiry mutations", sourceBetween("router.post(\"/education/public/courses/:courseId/inquiries\"", "router.get(\"/education/public/categories\"")],
  ["education wishlist mutations", sourceBetween("router.post(\"/education/wishlist\"", "router.delete(\"/education/wishlist/:courseId\"")],
  ["education message mutations", sourceBetween("router.post(\"/education/purchases/:enrollmentId/messages\"", "router.post(\"/education/purchases/:enrollmentId/disputes\"")],
  ["education dispute mutations", sourceBetween("router.post(\"/education/purchases/:enrollmentId/disputes\"", "router.get(\"/education/disputes\"")],
  ["admin integration delivery detail", sourceBetween("router.get(\"/admin/sms-deliveries\"", "router.get(\"/admin/integrations\"")],
  ["admin integration verification mutation", sourceBetween("router.post(\"/admin/integrations/:integration/verify-webhook\"", "router.get(\"/admin/integrations/:integration/webhook-url\"")],
  ["admin Brevo webhook registration mutation", sourceBetween("router.post(\"/admin/integrations/brevo/register-webhook\"", "router.post(\"/admin/integrations/brevo/cleanup-webhooks\"")],
  ["admin education settings detail", sourceBetween("function educationSettingsView(", "router.get(\"/admin/education/taxonomy/proposals\"")],
  ["admin education center detail", sourceBetween("async function adminEducationCenterDetail(", "router.get(\"/admin/education/centers/:centerId\"")],
  ["admin featured charge mutation", sourceBetween("router.post(\"/admin/education/featured-charges/:chargeId/settle\"", "router.post(\"/admin/education/payouts\"")],
  ["admin payout mutation response", sourceBetween("res.status(201).json({ id: payout.id", "\n});\n\nrouter.patch(\"/admin/education/disputes")],
  ["admin dispute mutation response", sourceBetween("res.json({ id: resolution.result.id", "\n});\n\n// Admin: cancel any session")],
  ["admin salon detail and mutation", sourceBetween("router.get(\"/admin/salons/:salonId\"", "// ── Admin Users")],
  ["admin account responses", sourceBetween("router.post(\"/admin/customers/setup\"", "router.post(\"/admin/users/:userId/business-conversion\"")],
  ["admin business conversion mutation", sourceBetween("router.post(\"/admin/users/:userId/business-conversion\"", "type BusinessTransitionRows")],
  ["admin business transition detail", sourceBetween("function adminBusinessTransitionView(", "router.get(\"/admin/users/:userId/business-role-transition\"")],
  ["admin user mutation", sourceBetween("router.patch(\"/admin/users/:userId\"", "// ── Admin Loyalty Tiers")],
  ["admin review mutation", sourceBetween("router.patch(\"/admin/reviews/:reviewId\"", "router.delete(\"/admin/reviews/:reviewId\"")],
  ["admin product detail", sourceBetween("function adminProductDto(", "async function productTreatmentIds")],
  ["admin shop settings detail and mutation", sourceBetween("function shopSettingsDto(", "router.get(\"/admin/shipping\"")],
  ["admin shipping detail and mutation", sourceBetween("router.get(\"/admin/shipping\"", "// ── Admin Courier Service Catalog")],
]) {
  assert.doesNotMatch(source, /\.toISOString\(\)/, `${name} must not directly serialize selected timestamps`);
}

process.stdout.write("✓ safe list timestamp serialization regression suite passed\n");
