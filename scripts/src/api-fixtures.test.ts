import assert from "node:assert/strict";
import test from "node:test";
import {
  adminIntegrationsFixture,
  adminSummaryFixture,
  adminWebhookFreshnessFixture,
  assertApiFixture,
} from "./browser-api-fixtures";

// Keep the generated schema source outside this package's TypeScript program:
// this test loads it at runtime without pulling lib/api-zod under scripts/rootDir.
const generatedApiPath = "../../lib/api-zod/src/generated/api.ts";
const apiSchemas = await import(generatedApiPath);

test("representative shared browser API fixtures match generated response schemas", () => {
  assert.doesNotThrow(() => {
    adminSummaryFixture(apiSchemas.GetAdminSummaryResponse);
    adminIntegrationsFixture(apiSchemas.AdminGetIntegrationsResponse);
    adminWebhookFreshnessFixture(apiSchemas.AdminGetWebhookFreshnessResponse);
  });
});

test("fixture validation names the endpoint and missing response field", () => {
  const schema = {
    safeParse: () => ({
      success: false as const,
      error: {
        issues: [{ path: ["totalUsers"], message: "Required" }],
      },
    }),
  };
  assert.throws(
    () => assertApiFixture("/api/admin/summary", schema, {}),
    /Invalid browser API fixture for \/api\/admin\/summary: totalUsers Required/,
  );
});

test("representative fixture validation fails when a generated response adds a required field", () => {
  const responseWithNewRequiredField = apiSchemas.GetAdminSummaryResponse.extend({
    newlyRequiredField: apiSchemas.GetAdminSummaryResponse.shape.totalUsers,
  });

  assert.throws(
    () => adminSummaryFixture(responseWithNewRequiredField),
    /Invalid browser API fixture for \/api\/admin\/summary: newlyRequiredField Required/,
  );
});

test("fixture validation preserves nested response field paths", () => {
  const schema = {
    safeParse: () => ({
      success: false as const,
      error: {
        issues: [{ path: ["items", 0, "createdAt"], message: "Required" }],
      },
    }),
  };
  assert.throws(
    () => assertApiFixture("/api/admin/products", schema, {}),
    /Invalid browser API fixture for \/api\/admin\/products: items\[0\]\.createdAt Required/,
  );
});