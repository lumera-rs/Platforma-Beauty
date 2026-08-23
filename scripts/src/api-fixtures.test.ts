import assert from "node:assert/strict";
import test from "node:test";
import { assertApiFixture } from "./browser-api-fixtures";

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