/**
 * Task #10: runtime error-disclosure adversarial checks.
 *
 * api-errors.ts's apiErrorHandler is centrally designed to never leak
 * internals (malformed JSON -> generic 400, known Postgres constraint
 * violations -> mapped clean message, anything else -> generic 500), but
 * that had never been proven with real malformed HTTP requests against a
 * running server. This file forces representative failures through real
 * requests and inspects the raw response bodies/headers for leakage.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/runtime-error-disclosure.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import app from "../app";
import { db, subscriptionPlansTable, usersTable } from "@workspace/db";

type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

function rawRequest(port: number, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1", port, path, method: options.method ?? "GET", headers: options.headers,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const LEAK_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "stack trace marker", pattern: /\bat [\w$.<>]+ \(?\/[\w./-]+:\d+:\d+\)?/ },
  { name: "Node internal module path", pattern: /node:internal\// },
  { name: "SQL statement text", pattern: /\b(select|insert into|update|delete from)\b.{0,40}\bfrom\b/i },
  { name: "Postgres constraint/detail text", pattern: /duplicate key value violates|violates .* constraint|relation ".*" does not exist/i },
  { name: "local filesystem path", pattern: /\/home\/[\w-]+\/|\/root\/|node_modules\// },
  { name: "environment/secret-looking key", pattern: /DATABASE_URL|SESSION_SECRET|_API_KEY\s*[:=]/ },
];

function assertNoLeakage(body: string, label: string) {
  for (const { name, pattern } of LEAK_PATTERNS) {
    assert.ok(!pattern.test(body), `${label}: response body must not contain a ${name}. Body: ${body.slice(0, 300)}`);
  }
}

const suffix = randomUUID();
const userIds: string[] = [];
const planIds: string[] = [];
let server: ReturnType<typeof app.listen> | undefined;

try {
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  // --- 1. Malformed JSON syntax (not just wrong-shape valid JSON) --------
  const malformed = await rawRequest(port, "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: '{"email": "test@example.test", "password": ',
  });
  assert.equal(malformed.status, 400, "malformed JSON syntax must be a clean 400, not a crash");
  assertNoLeakage(malformed.body, "malformed JSON body");
  const malformedParsed = JSON.parse(malformed.body);
  assert.ok(malformedParsed.error, "malformed JSON response must still be a well-formed API error body");
  assert.ok(!("stack" in malformedParsed), "malformed JSON response must not include a stack field");
  console.log("Malformed JSON syntax: PASS -- clean 400, no leakage.");

  // --- 2. Invalid ID format ------------------------------------------------
  // The security-relevant invariant (no internals in the client-facing
  // body) is a hard assertion regardless of status code. The status code
  // itself (ideally 400/404, not 500) is checked separately and reported
  // as a finding rather than failing the whole suite, since a malformed
  // ID reaching the database and being rejected there is a robustness/
  // input-validation defect, not a disclosure one -- see #10-F1 in the
  // Task #10 report.
  const invalidId = await rawRequest(port, "/api/education/public/centers/not-a-valid-uuid/reviews");
  assertNoLeakage(invalidId.body, "invalid ID response");
  const invalidIdParsed = JSON.parse(invalidId.body);
  assert.ok(!("stack" in invalidIdParsed) && !("query" in invalidIdParsed) && !("detail" in invalidIdParsed),
    "invalid ID response must not surface raw driver/query error fields");
  if (![400, 404].includes(invalidId.status)) {
    console.log(`#10-F1 (LOW): GET /education/public/centers/:centerId/reviews returns ${invalidId.status} for a malformed centerId instead of a clean 400/404 -- the route param is not validated as a UUID before reaching the database. Client-facing body remains clean (no leakage); see final report.`);
  } else {
    console.log("Invalid ID format: PASS -- clean 400/404, no leakage.");
  }

  // --- 3. Duplicate unique constraint (real Postgres 23505) ----------------
  const [plan] = await db.insert(subscriptionPlansTable).values({
    name: `Error Disclosure Plan ${suffix}`, price: 5000, audience: "education", active: true,
  }).returning();
  planIds.push(plan!.id);
  const email = `duplicate-${suffix}@example.test`;
  const registration = (overrides: Record<string, unknown> = {}) => ({
    firstName: "Dup", lastName: "Test", email, password: "StrongPass123!",
    phone: `+3816${suffix.replace(/\D/g, "").slice(0, 8).padEnd(8, "5")}`,
    businessType: "EDUCATION_CENTER", businessName: `Dup Centar ${suffix}`,
    pib: suffix.replace(/\D/g, "").slice(0, 9).padEnd(9, "1"),
    registrationNumber: suffix.replace(/\D/g, "").slice(0, 8).padEnd(8, "2"),
    bankAccount: suffix.replace(/\D/g, "").slice(0, 18).padEnd(18, "3"),
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    description: `Duplicate test ${suffix}`, planId: plan!.id, billingCycle: "monthly",
    ...overrides,
  });
  const firstRegistration = await rawRequest(port, "/api/auth/business-register", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(registration()),
  });
  assert.equal(firstRegistration.status, 201, "the first registration must succeed");
  const [createdUser] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  assert.ok(createdUser); userIds.push(createdUser!.id);

  // A second registration with the exact same email forces the unique
  // (users.email) collision path end-to-end through real HTTP.
  const duplicateRegistration = await rawRequest(port, "/api/auth/business-register", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(registration()),
  });
  assert.equal(duplicateRegistration.status, 409, "a duplicate-email registration must be a clean 409");
  assertNoLeakage(duplicateRegistration.body, "duplicate-constraint response");
  const duplicateParsed = JSON.parse(duplicateRegistration.body);
  assert.ok(!("stack" in duplicateParsed) && !("detail" in duplicateParsed) && !("constraint" in duplicateParsed),
    "duplicate-constraint response must not surface raw Postgres error fields (stack/detail/constraint)");
  console.log("Duplicate unique constraint (email): PASS -- clean 409, no leakage.");

  // --- 4. Response headers on an error response -----------------------------
  assert.equal(malformed.headers["x-powered-by"], undefined, "even an error response must not send X-Powered-By");
  console.log("Error-response headers: PASS -- no X-Powered-By.");

  console.log("Task #10 runtime-error-disclosure: ALL CHECKS PASSED.");
} finally {
  if (server) server.close();
  if (userIds.length) {
    const { educationCentersTable, educationFinancialAuditLogTable, sessionsTable } = await import("@workspace/db");
    await db.delete(educationFinancialAuditLogTable).where(inArray(educationFinancialAuditLogTable.actorUserId, userIds));
    await db.delete(educationCentersTable).where(inArray(educationCentersTable.ownerId, userIds));
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  if (planIds.length) await db.delete(subscriptionPlansTable).where(inArray(subscriptionPlansTable.id, planIds));
}
