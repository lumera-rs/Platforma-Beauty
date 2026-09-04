/**
 * Task #9B: safe external-URL scheme allowlist regression.
 *
 * The Task #9 frontend audit found that websiteUrl and instagramUrl (on
 * education centers) and trailerUrl (on courses) were only validated by
 * generic OpenAPI-generated zod schemas (`.url()`, or no format check at
 * all for trailerUrl), which do not reject non-http(s) schemes -- a
 * syntactically valid `javascript:alert(1)` or `data:text/html,...` value
 * passes `.url()` and `new URL()` construction just fine. These values are
 * later rendered as `<a href>` (websiteUrl/instagramUrl on the public
 * education center page) or fed into a "safe" video-embed component
 * (trailerUrl on the public course page) whose own fallback branch turned
 * out to render the raw, unvalidated URL as a clickable link too.
 *
 * Fix: one reusable helper, isSafeExternalHttpUrl() (safe-external-url.ts),
 * used both as the canonical backend gate (added to the three previously
 * unguarded write paths: POST /auth/business-register, POST and PATCH
 * /education/courses) and to replace two structurally-identical local
 * duplicates that already existed for other fields (isHttpVideoUrl for
 * salon videoUrl, validProviderUrl for order trackingUrl) -- both now call
 * the same shared function instead of hand-rolling the same URL-parsing
 * check three separate times.
 *
 * This file tests both the pure helper (the full required scheme/edge-case
 * matrix) and the actual API request path for every write site the helper
 * was added to.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/safe-external-url.test.ts
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { createSession, sessionCookieName } from "./auth";
import { buildValidOnlineEducationCourse } from "./education-test-fixtures";
import { isSafeExternalHttpUrl } from "./safe-external-url";
import {
  coursesTable, db, educationCentersTable, educationCenterSubscriptionsTable,
  educationFinancialAuditLogTable, mediaAssetsTable, sessionsTable, subscriptionPlansTable, usersTable,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// 1. Pure helper -- the full required scheme/edge-case matrix.
// ---------------------------------------------------------------------------

assert.equal(isSafeExternalHttpUrl("https://example.com"), true, "plain https accepted");
assert.equal(isSafeExternalHttpUrl("http://example.com"), true, "plain http accepted");
assert.equal(isSafeExternalHttpUrl("javascript:alert(1)"), false, "javascript: rejected");
assert.equal(isSafeExternalHttpUrl("data:text/html,<script>alert(1)</script>"), false, "data: rejected");
assert.equal(isSafeExternalHttpUrl("file:///etc/passwd"), false, "file: rejected");
assert.equal(isSafeExternalHttpUrl("vbscript:msgbox(1)"), false, "vbscript: rejected");
assert.equal(isSafeExternalHttpUrl("blob:https://example.com/uuid"), false, "blob: rejected");
assert.equal(isSafeExternalHttpUrl("app://internal/path"), false, "custom app scheme rejected");
assert.equal(isSafeExternalHttpUrl("//evil.example"), false, "protocol-relative URL rejected");
assert.equal(isSafeExternalHttpUrl("not a url"), false, "malformed URL rejected");
assert.equal(isSafeExternalHttpUrl("HTTPS://EXAMPLE.COM"), true, "uppercase scheme accepted (URL parser normalizes)");
assert.equal(isSafeExternalHttpUrl("HtTpS://Example.Com/Path"), true, "mixed-case scheme accepted");
assert.equal(isSafeExternalHttpUrl("https://example.com/path?query=1#fragment"), true, "query string and fragment accepted");
assert.equal(isSafeExternalHttpUrl("https://xn--e1aybc.xn--p1ai"), true, "punycode IDNA hostname accepted");
assert.equal(isSafeExternalHttpUrl("https://пример.рф"), true, "Unicode hostname handled safely by the standard URL parser");
assert.equal(isSafeExternalHttpUrl("https://user:pass@example.com"), false, "credential-bearing URL rejected");
assert.equal(isSafeExternalHttpUrl("https://user@example.com"), false, "username-only credential URL rejected");
assert.equal(isSafeExternalHttpUrl("https://"), false, "empty/malformed host rejected");
assert.equal(isSafeExternalHttpUrl(null), true, "null (no value provided) preserved as valid");
assert.equal(isSafeExternalHttpUrl(undefined), true, "undefined (no value provided) preserved as valid");
assert.equal(isSafeExternalHttpUrl(""), true, "empty string (no value provided) preserved as valid");
assert.equal(isSafeExternalHttpUrl("   "), true, "whitespace-only string preserved as valid");
assert.equal(isSafeExternalHttpUrl("  https://example.com  "), true, "surrounding whitespace trimmed and accepted");
console.log("isSafeExternalHttpUrl() pure-helper matrix passed.");

// ---------------------------------------------------------------------------
// 2. Real API request path.
// ---------------------------------------------------------------------------

const marker = `safe-url-${randomUUID()}`;
const userIds: string[] = [];
const centerIds: string[] = [];
const planIds: string[] = [];
const courseIds: string[] = [];
let server: ReturnType<typeof app.listen> | undefined;

const call = async (base: string, path: string, method: string, body?: unknown, cookie?: string) => {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) as any };
};

const numericIdentity = (value: string, length: number) => BigInt(`0x${createHash("sha256").update(value).digest("hex")}`)
  .toString().padStart(length, "0").slice(0, length);

const businessRegistration = (email: string, planId: string, overrides: Record<string, unknown> = {}) => ({
  firstName: "Safe", lastName: "Url", email, password: "StrongPass123!",
  phone: `+3816${numericIdentity(`${email}:phone`, 8)}`, businessType: "EDUCATION_CENTER", businessName: `Centar ${email}`,
  pib: numericIdentity(`${email}:pib`, 9),
  registrationNumber: numericIdentity(`${email}:registration`, 8),
  bankAccount: numericIdentity(`${email}:bank`, 18),
  city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
  description: `Programi i sertifikacije ${marker}`,
  planId, billingCycle: "monthly",
  ...overrides,
});

try {
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: `Plan ${marker}`, price: 10_000, trialDays: 30, audience: "education",
    courseLimit: 5, vatIncluded: true, priceCopy: "Cena uključuje PDV.", limits: { courses: 5 }, active: true,
  }).returning();
  planIds.push(plan!.id);

  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // --- POST /auth/business-register: websiteUrl / instagramUrl -----------

  const rejectedJs = await call(base, "/auth/business-register", "POST",
    businessRegistration(`js-${marker}@example.test`, plan!.id, { websiteUrl: "javascript:alert(1)" }));
  assert.equal(rejectedJs.status, 400, "business-register must reject a javascript: websiteUrl");
  assert.equal(
    (await db.select().from(usersTable).where(eq(usersTable.email, `js-${marker}@example.test`))).length, 0,
    "no user must be created when websiteUrl is rejected",
  );

  const rejectedData = await call(base, "/auth/business-register", "POST",
    businessRegistration(`data-${marker}@example.test`, plan!.id, { instagramUrl: "data:text/html,<script>1</script>" }));
  assert.equal(rejectedData.status, 400, "business-register must reject a data: instagramUrl");

  const acceptedUrls = await call(base, "/auth/business-register", "POST",
    businessRegistration(`ok-${marker}@example.test`, plan!.id, {
      websiteUrl: "https://example.com", instagramUrl: "https://instagram.com/example",
    }));
  assert.equal(acceptedUrls.status, 201, "business-register must accept safe https websiteUrl/instagramUrl");
  const [okOwner] = await db.select().from(usersTable).where(eq(usersTable.email, `ok-${marker}@example.test`));
  assert.ok(okOwner); userIds.push(okOwner.id);
  const [okCenter] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, okOwner.id));
  assert.ok(okCenter); centerIds.push(okCenter.id);
  assert.equal(okCenter.websiteUrl, "https://example.com");
  assert.equal(okCenter.instagramUrl, "https://instagram.com/example");

  const omittedUrls = await call(base, "/auth/business-register", "POST",
    businessRegistration(`none-${marker}@example.test`, plan!.id));
  assert.equal(omittedUrls.status, 201, "business-register must still accept a registration with no website/instagram URL at all");
  const [noneOwner] = await db.select().from(usersTable).where(eq(usersTable.email, `none-${marker}@example.test`));
  assert.ok(noneOwner); userIds.push(noneOwner.id);
  const [noneCenter] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, noneOwner.id));
  assert.ok(noneCenter); centerIds.push(noneCenter.id);
  console.log("POST /auth/business-register websiteUrl/instagramUrl scheme gate passed.");

  // --- POST/PATCH /education/courses: trailerUrl --------------------------

  const [courseOwner] = await db.insert(usersTable).values({
    firstName: "Course", lastName: "Owner", email: `course-owner-${marker}@example.test`,
    passwordHash: "fixture", passwordSetAt: new Date(), role: "EDUKATIVNI_CENTAR",
  }).returning();
  userIds.push(courseOwner!.id);
  const [center] = await db.insert(educationCentersTable).values({
    ownerId: courseOwner!.id, name: `Verified Centar ${marker}`, city: "Beograd",
    description: marker, imageUrl: "/test.jpg", verificationStatus: "verified",
  }).returning();
  centerIds.push(center!.id);
  await db.insert(educationCenterSubscriptionsTable).values({
    centerId: center!.id, planId: plan!.id, status: "active",
  });
  const cookie = `${sessionCookieName}=${await createSession(courseOwner!.id)}`;

  const createRejectedJs = await call(base, "/education/courses", "POST", {
    title: `Course JS ${marker}`, category: "Test", format: "online", price: 10_000,
    duration: "4 nedelje", imageUrl: "/test.jpg",
    onlineAccessDays: 30, extensionPrice1Month: 1_000, extensionPrice3Months: 2_500, extensionPrice6Months: 4_000,
    trailerUrl: "javascript:alert(1)",
  }, cookie);
  assert.equal(createRejectedJs.status, 400, "POST /education/courses must reject a javascript: trailerUrl");

  // POST /education/courses also requires imageUrl to reference a media
  // asset this account actually uploaded -- seed one directly so the
  // "accepted" case below exercises the trailerUrl gate specifically,
  // rather than failing for an unrelated reason.
  const coverAssetId = randomUUID();
  await db.insert(mediaAssetsTable).values({
    id: coverAssetId, ownerUserId: courseOwner!.id, scope: "education-cover",
    originalFileName: "cover.jpg", originalContentType: "image/jpeg",
    width: 800, height: 600, contentHash: `hash-${marker}`,
  });
  const claimedImageUrl = `/api/media/${coverAssetId}`;

  const createAccepted = await call(base, "/education/courses", "POST", {
    title: `Course OK ${marker}`, category: "Test", format: "online", price: 10_000,
    duration: "4 nedelje", imageUrl: claimedImageUrl,
    onlineAccessDays: 30, extensionPrice1Month: 1_000, extensionPrice3Months: 2_500, extensionPrice6Months: 4_000,
    trailerUrl: "https://youtube.com/watch?v=abc123",
  }, cookie);
  assert.equal(createAccepted.status, 201, "POST /education/courses must accept a safe https trailerUrl");
  courseIds.push(createAccepted.body.id);

  const [directCourse] = await db.insert(coursesTable).values(
    buildValidOnlineEducationCourse({ title: `Direct ${marker}`, category: "Test", price: 10_000, centerId: center!.id }),
  ).returning();
  courseIds.push(directCourse!.id);

  const updateRejectedData = await call(base, `/education/courses/${directCourse!.id}`, "PATCH", {
    trailerUrl: "data:text/html,<script>alert(1)</script>",
  }, cookie);
  assert.equal(updateRejectedData.status, 400, "PATCH /education/courses/:id must reject a data: trailerUrl");
  const [afterRejectedPatch] = await db.select().from(coursesTable).where(eq(coursesTable.id, directCourse!.id));
  assert.equal(afterRejectedPatch!.trailerUrl, null, "a rejected trailerUrl must not be persisted");

  const updateAccepted = await call(base, `/education/courses/${directCourse!.id}`, "PATCH", {
    trailerUrl: "https://vimeo.com/123456",
  }, cookie);
  assert.equal(updateAccepted.status, 200, "PATCH /education/courses/:id must accept a safe https trailerUrl");
  const [afterAcceptedPatch] = await db.select().from(coursesTable).where(eq(coursesTable.id, directCourse!.id));
  assert.equal(afterAcceptedPatch!.trailerUrl, "https://vimeo.com/123456");

  const updateClearedNull = await call(base, `/education/courses/${directCourse!.id}`, "PATCH", {
    trailerUrl: null,
  }, cookie);
  assert.equal(updateClearedNull.status, 200, "PATCH /education/courses/:id must accept clearing trailerUrl back to null");
  console.log("POST/PATCH /education/courses trailerUrl scheme gate passed.");

  console.log("Task #9B safe external-URL regression passed.");
} finally {
  if (server) server.close();
  if (userIds.length) await db.delete(mediaAssetsTable).where(inArray(mediaAssetsTable.ownerUserId, userIds));
  if (courseIds.length) await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
  if (centerIds.length) await db.delete(educationCenterSubscriptionsTable).where(inArray(educationCenterSubscriptionsTable.centerId, centerIds));
  if (centerIds.length) await db.delete(educationCentersTable).where(inArray(educationCentersTable.id, centerIds));
  if (userIds.length) await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.actorUserId, userIds));
  if (userIds.length) await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  if (planIds.length) await db.delete(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, planIds));
}
