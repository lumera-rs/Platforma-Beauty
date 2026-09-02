import assert from "node:assert/strict";
import test from "node:test";
import { parseB2bImportCsv } from "../routes/marketplace";

test("B2B CSV parser preserves RFC4180 quoted commas, escaped quotes, and row numbers", () => {
  const parsed = parseB2bImportCsv('SKU,Quantity\r\n"SKU,WITH,COMMAS",2\r\n"QUOTE""D",3\r\n');
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.rows, [
    ["SKU", "Quantity"],
    ["SKU,WITH,COMMAS", "2"],
    ['QUOTE"D', "3"],
  ]);
});

test("B2B CSV parser rejects an unclosed quoted field", () => {
  assert.equal(parseB2bImportCsv('SKU,Quantity\r\n"broken,1').error, "CSV sadrži nezatvoren navodnik.");
});