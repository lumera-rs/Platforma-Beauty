import assert from "node:assert/strict";
import test from "node:test";
import { boundedSearchTerm, isAllowedBestsellerPeriod, isSupportedProductDocument } from "./commerce-g-domain";

test("product documents reject extension/content spoofing", () => {
  assert.equal(isSupportedProductDocument("manual.pdf", "application/pdf", Buffer.from("%PDF-1.7")), true);
  assert.equal(isSupportedProductDocument("manual.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("PK\u0003\u0004")), true);
  assert.equal(isSupportedProductDocument("manual.pdf", "application/pdf", Buffer.from("<html")), false);
  assert.equal(isSupportedProductDocument("manual.exe", "application/pdf", Buffer.from("%PDF-")), false);
});

test("search and bestseller inputs stay bounded", () => {
  assert.equal(boundedSearchTerm(`  ${"A".repeat(120)} `), "a".repeat(100));
  assert.equal(isAllowedBestsellerPeriod(30), true);
  assert.equal(isAllowedBestsellerPeriod(60), true);
  assert.equal(isAllowedBestsellerPeriod(90), false);
});