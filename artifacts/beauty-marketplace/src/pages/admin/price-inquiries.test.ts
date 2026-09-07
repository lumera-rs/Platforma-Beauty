import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./price-inquiries.tsx", import.meta.url), "utf8");

test("price inquiry updates invalidate every generated filtered-list query", () => {
  assert.match(
    source,
    /invalidateQueries\(\{\s*queryKey:\s*getAdminListPriceInquiriesQueryKey\(\)\s*\}\)/,
  );
  assert.doesNotMatch(source, /\["admin",\s*"price-inquiries"\]/);
});