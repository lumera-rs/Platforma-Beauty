import assert from "node:assert/strict";
import { safeIsoTimestamp } from "./date-serialization";

assert.equal(safeIsoTimestamp(new Date("2026-09-02T10:15:30.000Z")), "2026-09-02T10:15:30.000Z");
assert.equal(safeIsoTimestamp("2026-09-02T10:15:30.000Z"), "2026-09-02T10:15:30.000Z");
assert.equal(safeIsoTimestamp(null), null);
assert.equal(safeIsoTimestamp(undefined), null);
assert.equal(safeIsoTimestamp(new Date(Number.NaN)), null);
assert.equal(safeIsoTimestamp("not-a-timestamp"), null);
assert.equal(safeIsoTimestamp({}), null);

const rows = [
  { id: "damaged", createdAt: new Date(Number.NaN) },
  { id: "valid", createdAt: new Date("2026-09-02T10:15:30.000Z") },
];
const response = rows.map((row) => ({ id: row.id, createdAt: safeIsoTimestamp(row.createdAt) }));

assert.deepEqual(response, [
  { id: "damaged", createdAt: null },
  { id: "valid", createdAt: "2026-09-02T10:15:30.000Z" },
]);

process.stdout.write("✓ safe admin timestamp serialization regression suite passed\n");
