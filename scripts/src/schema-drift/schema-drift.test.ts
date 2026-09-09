import assert from "node:assert/strict";
import test from "node:test";
import { compareSchemas, serializeReport } from "./compare";
import type { OwnershipException, SchemaSnapshot, TableDefinition } from "./model";

function table(): TableDefinition {
  return {
    schema: "public", name: "orders",
    columns: [
      { name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()", generated: null },
      { name: "tenant_id", type: "uuid", nullable: false, default: null, generated: null },
      { name: "amount", type: "integer", nullable: false, default: "0", generated: null },
    ],
    primaryKey: { name: "orders_pkey", columns: ["id"] },
    uniques: [{ name: "orders_tenant_unique", columns: ["tenant_id", "id"] }],
    foreignKeys: [{
      name: "orders_tenant_fk", columns: ["tenant_id"], foreignSchema: "public",
      foreignTable: "tenants", foreignColumns: ["id"], onDelete: "cascade", onUpdate: "no action",
    }],
    checks: [{ name: "orders_amount_check", expression: "amount >= 0" }],
    indexes: [{
      name: "orders_amount_idx", expressions: ["amount", "lower((tenant_id)::text)"],
      unique: false, predicate: "amount > 0", method: "btree",
    }],
  };
}
const snapshot = (value = table()): SchemaSnapshot => ({ tables: [value] });
const clone = (): SchemaSnapshot => structuredClone(snapshot());
const categories = (actual: SchemaSnapshot) =>
  compareSchemas(snapshot(), actual).findings.map((x) => `${x.category}:${x.objectType}:${x.objectName}`);

test("detects missing and extra columns", () => {
  const missing = clone(); missing.tables[0]!.columns.pop();
  assert.deepEqual(categories(missing), ["MISSING_IN_DB:COLUMN:amount"]);
  const extra = clone(); extra.tables[0]!.columns.push({
    name: "legacy", type: "text", nullable: true, default: null, generated: null,
  });
  assert.deepEqual(categories(extra), ["EXTRA_IN_DB:COLUMN:legacy"]);
});

for (const [label, edit] of [
  ["wrong type", (x: SchemaSnapshot) => { x.tables[0]!.columns[2]!.type = "bigint"; }],
  ["wrong nullability", (x: SchemaSnapshot) => { x.tables[0]!.columns[2]!.nullable = true; }],
  ["wrong default", (x: SchemaSnapshot) => { x.tables[0]!.columns[2]!.default = "1"; }],
] as const) test(`detects ${label}`, () => {
  const actual = clone(); edit(actual);
  assert.deepEqual(categories(actual), ["DEFINITION_MISMATCH:COLUMN:amount"]);
});

test("detects changed generated expression/status", () => {
  const desired = clone();
  desired.tables[0]!.columns[2]!.generated = "tenant_id";
  assert.deepEqual(
    compareSchemas(desired, clone()).findings.map((x) => `${x.category}:${x.objectType}:${x.objectName}`),
    ["DEFINITION_MISMATCH:COLUMN:amount"],
  );
});

test("detects missing FK and wrong FK delete action", () => {
  const missing = clone(); missing.tables[0]!.foreignKeys = [];
  assert.deepEqual(categories(missing), ["MISSING_IN_DB:FOREIGN_KEY:orders_tenant_fk"]);
  const wrong = clone(); wrong.tables[0]!.foreignKeys[0]!.onDelete = "restrict";
  assert.deepEqual(categories(wrong), ["DEFINITION_MISMATCH:FOREIGN_KEY:orders_tenant_fk"]);
});

test("detects missing and changed checks", () => {
  const missing = clone(); missing.tables[0]!.checks = [];
  assert.deepEqual(categories(missing), ["MISSING_IN_DB:CHECK:orders_amount_check"]);
  const changed = clone(); changed.tables[0]!.checks[0]!.expression = "amount > 0";
  assert.deepEqual(categories(changed), ["DEFINITION_MISMATCH:CHECK:orders_amount_check"]);
});

test("detects missing and changed index expressions/columns", () => {
  const missing = clone(); missing.tables[0]!.indexes = [];
  assert.deepEqual(categories(missing), ["MISSING_IN_DB:INDEX:orders_amount_idx"]);
  const changed = clone(); changed.tables[0]!.indexes[0]!.expressions = ["tenant_id"];
  assert.deepEqual(categories(changed), ["DEFINITION_MISMATCH:INDEX:orders_amount_idx"]);
});

test("detects wrong index uniqueness and predicate", () => {
  const unique = clone(); unique.tables[0]!.indexes[0]!.unique = true;
  assert.deepEqual(categories(unique), ["DEFINITION_MISMATCH:INDEX:orders_amount_idx"]);
  const partial = clone(); partial.tables[0]!.indexes[0]!.predicate = "amount >= 0";
  assert.deepEqual(categories(partial), ["DEFINITION_MISMATCH:INDEX:orders_amount_idx"]);
});

test("compares PK and unique constraints semantically rather than only by name", () => {
  const renamed = clone();
  renamed.tables[0]!.uniques[0]!.name = "database_generated_name";
  assert.deepEqual(categories(renamed), []);
  renamed.tables[0]!.uniques[0]!.columns = ["id"];
  assert.deepEqual(categories(renamed), [
    "EXTRA_IN_DB:UNIQUE:database_generated_name",
    "MISSING_IN_DB:UNIQUE:orders_tenant_unique",
  ]);
  const pk = clone(); pk.tables[0]!.primaryKey!.columns = ["tenant_id"];
  assert.deepEqual(categories(pk), ["DEFINITION_MISMATCH:PRIMARY_KEY:orders_pkey"]);
});

test("classifies an exact ownership exception as non-actionable", () => {
  const actual = clone();
  actual.tables.push({ ...table(), name: "extension_table" });
  const exception: OwnershipException = {
    objectType: "TABLE", schema: "public", name: "extension_table",
    owner: "extension", mechanism: "CREATE EXTENSION", reason: "owned externally", temporary: false,
  };
  const report = compareSchemas(snapshot(), actual, [exception]);
  assert.equal(report.actionable, false);
  assert.equal(report.findings[0]!.category, "OWNERSHIP_EXCEPTION");
  assert.deepEqual(report.findings[0]!.ownership, exception);
});

test("normalizes SQL formatting and produces deterministic sorted JSON", () => {
  const actual = clone();
  actual.tables[0]!.checks[0]!.expression = `(("orders"."amount") >= (0))`;
  actual.tables[0]!.indexes[0]!.predicate = `"orders"."amount" > 0`;
  assert.deepEqual(categories(actual), []);
  const withExtras = clone();
  withExtras.tables[0]!.columns.push(
    { name: "z", type: "text", nullable: true, default: null, generated: null },
    { name: "a", type: "text", nullable: true, default: null, generated: null },
  );
  const first = serializeReport(compareSchemas(snapshot(), withExtras));
  withExtras.tables[0]!.columns.reverse();
  assert.equal(serializeReport(compareSchemas(snapshot(), withExtras)), first);
  assert.ok(first.indexOf("public.orders.a") < first.indexOf("public.orders.z"));
});

test("never removes boolean grouping that changes AND/OR precedence", () => {
  const desired = clone();
  desired.tables[0]!.checks[0]!.expression = "(amount >= 0 or amount is null) and amount <= 100";
  const groupedActual = structuredClone(desired);
  groupedActual.tables[0]!.checks[0]!.expression = "amount >= 0 or amount is null and amount <= 100";
  const findings = compareSchemas(desired, groupedActual).findings;
  assert.deepEqual(
    findings.map((finding) => `${finding.category}:${finding.objectType}:${finding.objectName}`),
    ["DEFINITION_MISMATCH:CHECK:orders_amount_check"],
  );
});