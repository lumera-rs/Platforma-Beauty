import assert from "node:assert/strict";
import test from "node:test";
import { pgTable, integer, text, primaryKey, unique, foreignKey, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { buildCanonicalSnapshot } from "./canonical";
import { readPostgresSnapshot } from "./catalog";
import { compareSchemas, serializeReport } from "./compare";
import { fingerprintSnapshot } from "./fingerprint";
import { normalizeSql } from "./model";
import type { OwnershipException, SchemaSnapshot, TableDefinition } from "./model";
import { readOnlyQueryLayer } from "./read-only-query";

const POSTGRES_16 = {
  serverVersionNum: 160010,
  serverMajorVersion: 16,
  deparserFormat: "postgresql-16-deparser-v1",
} as const;

function table(): TableDefinition {
  return {
    schema: "public", name: "orders",
    columns: [
      { position: 1, name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()", generated: null },
      { position: 2, name: "tenant_id", type: "uuid", nullable: false, default: null, generated: null },
      { position: 3, name: "amount", type: "integer", nullable: false, default: "0", generated: null },
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
    position: 4, name: "legacy", type: "text", nullable: true, default: null, generated: null,
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
  assert.deepEqual(categories(renamed), [
    "SEMANTIC_MATCH_DIFFERENT_NAME:UNIQUE:orders_tenant_unique",
  ]);
  renamed.tables[0]!.uniques[0]!.columns = ["id"];
  assert.deepEqual(categories(renamed), [
    "EXTRA_IN_DB:UNIQUE:database_generated_name",
    "MISSING_IN_DB:UNIQUE:orders_tenant_unique",
  ]);
  const pk = clone(); pk.tables[0]!.primaryKey!.columns = ["tenant_id"];
  assert.deepEqual(categories(pk), ["DEFINITION_MISMATCH:PRIMARY_KEY:orders_pkey"]);
});

test("normalizeSql preserves semantics while normalizing PostgreSQL renderings", () => {
  assert.equal(normalizeSql("now() + interval '180 days'"), normalizeSql("now() + '180 days'::interval"));
  assert.notEqual(normalizeSql("'ACTIVE'"), normalizeSql("'active'"));
  assert.notEqual(normalizeSql("(a+b)*c"), normalizeSql("a+b*c"));
  assert.notEqual(normalizeSql("schema_a.make_value()"), normalizeSql("schema_b.make_value()"));
  assert.notEqual(normalizeSql("value::bigint"), normalizeSql("value"));
  assert.notEqual(normalizeSql(`'\"active\"'`), normalizeSql("'active'"));
  assert.notEqual(normalizeSql(`"foo""bar"`), normalizeSql(`"foobar"`));
  assert.notEqual(normalizeSql(`"a'X'b"`), normalizeSql(`"a'Y'b"`));
  assert.notEqual(normalizeSql("abs(1)"), normalizeSql("abs1"));
  assert.notEqual(
    normalizeSql("not (a > 0 and b > 0) or c > 0"),
    normalizeSql("not a > 0 and b > 0 or c > 0"),
  );
  assert.notEqual(normalizeSql("interval '180 days'"), normalizeSql("interval '181 days'"));
  assert.notEqual(normalizeSql("now() + interval '180 days'"), normalizeSql("now() - interval '180 days'"));
  assert.equal(normalizeSql("value BETWEEN -1 AND 5"), "value>=-1 and value<=5");
  assert.equal(normalizeSql("value between 1 and 5"), "value>=1 and value<=5");
  for (const expression of ["value < -1", "value > -1", "value <= -1", "value >= -1"]) {
    assert.ok(normalizeSql(expression)?.includes(expression.replaceAll(" ", "")));
  }
  assert.notEqual(normalizeSql("value is null"), normalizeSql("value is not null"));
  assert.equal(normalizeSql("jsonb_array_length(portfolio_media) > 0"), "jsonb_array_length(portfolio_media)>0");
  assert.equal(normalizeSql("coalesce(length(trim(name)),0) > 0"), "coalesce(length(trim(name)),0)>0");
  assert.equal(normalizeSql("(value) > 0"), "value>0");
  assert.notEqual(normalizeSql("(a or b) and c"), normalizeSql("a or b and c"));
});

test("canonical extraction covers keys, actions, checks, generated columns, and indexes", () => {
  const parent = pgTable("fixture_parent", {
    left: integer("left").notNull(),
    right: integer("right").notNull(),
  }, (t) => [primaryKey({ name: "fixture_parent_pk", columns: [t.left, t.right] })]);
  const child = pgTable("fixture_child", {
    id: integer("id").primaryKey(),
    parentLeft: integer("parent_left").notNull(),
    parentRight: integer("parent_right").notNull(),
    code: text("code").unique("fixture_child_code_unique"),
    generated: text("generated").generatedAlwaysAs(sql`lower(code)`),
  }, (t) => [
    unique("fixture_child_pair_unique").on(t.parentLeft, t.parentRight),
    foreignKey({
      name: "fixture_child_parent_fk",
      columns: [t.parentLeft, t.parentRight],
      foreignColumns: [parent.left, parent.right],
    }).onDelete("restrict").onUpdate("cascade"),
    check("fixture_child_check", sql`${t.parentLeft} > 0`),
    index("fixture_child_expression_idx").on(sql`lower(${t.code})`),
    uniqueIndex("fixture_child_partial_idx").on(t.code).where(sql`${t.code} is not null`),
  ]);
  const snapshot = buildCanonicalSnapshot([parent, child]);
  const extractedParent = snapshot.tables.find((table) => table.name === "fixture_parent")!;
  const extracted = snapshot.tables.find((table) => table.name === "fixture_child")!;
  assert.deepEqual(extractedParent.primaryKey?.columns, ["left", "right"]);
  assert.deepEqual(extracted.primaryKey?.columns, ["id"]);
  assert.ok(extracted.uniques.some((item) => item.name === "fixture_child_code_unique"));
  assert.ok(extracted.uniques.some((item) => item.name === "fixture_child_pair_unique"));
  assert.deepEqual(extracted.foreignKeys[0]?.columns, ["parent_left", "parent_right"]);
  assert.equal(extracted.foreignKeys[0]?.onDelete, "restrict");
  assert.equal(extracted.foreignKeys[0]?.onUpdate, "cascade");
  assert.equal(extracted.checks.length, 1);
  assert.ok(extracted.columns.find((column) => column.name === "generated")?.generated);
  assert.ok(extracted.indexes.find((item) => item.name === "fixture_child_expression_idx")?.expressions[0]?.includes("lower"));
  assert.ok(extracted.indexes.find((item) => item.name === "fixture_child_partial_idx")?.predicate);
});

test("catalog extraction excludes all constraint backing indexes and preserves catalog detail", async () => {
  const queries: string[] = [];
  const results = [
    { rows: [{ schema_name: "public", table_name: "fixture" }] },
    { rows: [
      { schema_name: "public", table_name: "fixture", column_position: 1, column_name: "a", data_type: "integer",
        nullable: false, column_default: null, generated: null },
      { schema_name: "public", table_name: "fixture", column_position: 2, column_name: "b", data_type: "integer",
        nullable: false, column_default: null, generated: null },
    ] },
    { rows: [
      {
        schema_name: "public", table_name: "fixture", conname: "fixture_fk", contype: "f",
        columns: "{b,a}", foreign_schema: "public", foreign_table: "parent",
        foreign_columns: "{y,x}", on_delete: "restrict", on_update: "cascade",
        match_type: "simple", delete_set_columns: ["a"], no_inherit: false,
      },
      {
        schema_name: "public", table_name: "fixture", conname: "fixture_no_overlap", contype: "x",
        columns: "{a,b}", exclusion_definition: "EXCLUDE USING gist (a WITH =, b WITH &&)",
        index_method: "gist", index_include_expressions: ["b"], index_key_options: [0, 0],
        index_collations: ["", "pg_catalog.default"],
        index_opclasses: ["pg_catalog.int4_ops", "pg_catalog.int4_ops"],
        index_valid: true, index_ready: true,
      },
    ] },
    { rows: [{
      schema_name: "public", table_name: "fixture", index_name: "fixture_expression_partial",
      is_unique: false, method: "gist", expressions: "{lower(a::text)}", predicate: "b > 0",
      key_options: [3], collations: ["pg_catalog.default"],
      opclasses: ["pg_catalog.text_ops"],
    }] },
  ];
  const client = { async query(query: string) {
    queries.push(query);
    return results[queries.length - 1]!;
  } };
  const extracted = await readPostgresSnapshot(client);
  assert.match(queries[1]!, /NOT a\.attisdropped/);
  assert.match(queries[2]!, /indnullsnotdistinct/);
  assert.match(queries[2]!, /condeferrable/);
  assert.doesNotMatch(queries[2]!, /con\.contype IN/);
  assert.match(queries[2]!, /pg_get_constraintdef/);
  assert.match(queries[3]!, /con\.contype IN \('p','u','x'\)/);
  assert.match(queries[3]!, /indnatts/);
  assert.match(queries[3]!, /indisvalid/);
  assert.match(queries[3]!, /indoption/);
  assert.match(queries[3]!, /indcollation/);
  assert.match(queries[3]!, /indclass/);
  assert.deepEqual(extracted.tables[0]?.foreignKeys[0]?.columns, ["b", "a"]);
  assert.deepEqual(extracted.tables[0]?.foreignKeys[0]?.foreignColumns, ["y", "x"]);
  assert.deepEqual(extracted.tables[0]?.foreignKeys[0]?.deleteSetColumns, ["a"]);
  assert.equal(extracted.tables[0]?.indexes[0]?.method, "gist");
  assert.equal(extracted.tables[0]?.indexes[0]?.predicate, "b > 0");
  assert.deepEqual(extracted.tables[0]?.indexes[0]?.keyOptions, [3]);
  assert.deepEqual(extracted.tables[0]?.indexes[0]?.collations, ["pg_catalog.default"]);
  assert.deepEqual(extracted.tables[0]?.indexes[0]?.opclasses, ["pg_catalog.text_ops"]);
  assert.equal(extracted.tables[0]?.exclusions?.[0]?.name, "fixture_no_overlap");
  assert.match(extracted.tables[0]?.exclusions?.[0]?.definition ?? "", /EXCLUDE USING gist/);
  assert.deepEqual(extracted.tables[0]?.exclusions?.[0]?.indexKeyOptions, [0, 0]);
  assert.deepEqual(extracted.tables[0]?.exclusions?.[0]?.indexIncludeExpressions, ["b"]);
});

test("catalog-extracted index vectors and quoted types affect fingerprints", async () => {
  const extract = async ({
    type = `"Status"`,
    identity = null,
    columnCollation = "pg_catalog.default",
    option = 0,
    collation = "pg_catalog.default",
    opclass = "pg_catalog.text_ops",
  }: {
    type?: string;
    identity?: string | null;
    columnCollation?: string | null;
    option?: number;
    collation?: string;
    opclass?: string;
  } = {}) => {
    const results = [
      { rows: [{ schema_name: "public", table_name: "fixture" }] },
      { rows: [{
        schema_name: "public", table_name: "fixture", column_position: 1,
        column_name: "status", data_type: type, nullable: false,
        column_default: null, generated: null, generated_mode: null,
        identity_mode: identity, column_collation: columnCollation,
      }] },
      { rows: [] },
      { rows: [{
        schema_name: "public", table_name: "fixture", index_name: "fixture_status_idx",
        is_unique: false, method: "btree", expressions: ["status"],
        include_expressions: [], predicate: null, nulls_not_distinct: false,
        is_valid: true, is_ready: true, key_options: [option],
        collations: [collation], opclasses: [opclass],
      }] },
    ];
    let index = 0;
    return fingerprintSnapshot(await readPostgresSnapshot({
      async query() { return results[index++]!; },
    }), [], POSTGRES_16);
  };
  const original = await extract();
  for (const changed of [
    await extract({ option: 1 }),
    await extract({ collation: "public.custom_collation" }),
    await extract({ opclass: "public.custom_ops" }),
    await extract({ type: `"STATUS"` }),
    await extract({ identity: "always" }),
    await extract({ columnCollation: "public.custom_collation" }),
  ]) {
    assert.notEqual(changed.structuralFingerprint, original.structuralFingerprint);
    assert.notEqual(changed.physicalFingerprint, original.physicalFingerprint);
  }
});

test("catalog-extracted UNIQUE backing-index INCLUDE changes both fingerprints", async () => {
  const extract = async (includeColumn: "included_a" | "included_b") => {
    const results = [
      { rows: [{ schema_name: "public", table_name: "fixture" }] },
      { rows: ["key", "included_a", "included_b"].map((column_name, index) => ({
        schema_name: "public", table_name: "fixture", column_position: index + 1,
        column_name, data_type: "text", nullable: false,
        column_default: null, generated: null,
      })) },
      { rows: [{
        schema_name: "public", table_name: "fixture", conname: "fixture_key_unique",
        contype: "u", columns: ["key"], deferrable: false,
        initially_deferred: false, validated: true, nulls_not_distinct: false,
        index_method: "btree", index_include_expressions: [includeColumn],
        index_key_options: [0], index_collations: ["pg_catalog.default"],
        index_opclasses: ["pg_catalog.text_ops"], index_valid: true, index_ready: true,
      }] },
      { rows: [] },
    ];
    let index = 0;
    return fingerprintSnapshot(await readPostgresSnapshot({
      async query() { return results[index++]!; },
    }), [], POSTGRES_16);
  };
  const first = await extract("included_a");
  const second = await extract("included_b");
  assert.notEqual(first.structuralFingerprint, second.structuralFingerprint);
  assert.notEqual(first.physicalFingerprint, second.physicalFingerprint);
});

test("catalog-extracted FK SET targets and CHECK inheritance affect fingerprints", async () => {
  const extract = async ({
    deleteSetColumns = ["tenant_id", "item_id"],
    noInherit = false,
  }: {
    deleteSetColumns?: string[];
    noInherit?: boolean;
  } = {}) => {
    const results = [
      { rows: [{ schema_name: "public", table_name: "fixture" }] },
      { rows: ["tenant_id", "item_id"].map((column_name, index) => ({
        schema_name: "public", table_name: "fixture", column_position: index + 1,
        column_name, data_type: "uuid", nullable: true,
        column_default: null, generated: null,
      })) },
      { rows: [
        {
          schema_name: "public", table_name: "fixture", conname: "fixture_parent_fk",
          contype: "f", columns: ["tenant_id", "item_id"],
          foreign_schema: "public", foreign_table: "parent",
          foreign_columns: ["tenant_id", "item_id"], on_delete: "set null",
          on_update: "no action", match_type: "simple",
          delete_set_columns: deleteSetColumns, deferrable: false,
          initially_deferred: false, validated: true,
        },
        {
          schema_name: "public", table_name: "fixture", conname: "fixture_item_check",
          contype: "c", columns: ["item_id"], expression: "item_id is not null",
          no_inherit: noInherit, deferrable: false,
          initially_deferred: false, validated: true,
        },
      ] },
      { rows: [] },
    ];
    let index = 0;
    return fingerprintSnapshot(await readPostgresSnapshot({
      async query() { return results[index++]!; },
    }), [], POSTGRES_16);
  };
  const original = await extract();
  for (const changed of [
    await extract({ deleteSetColumns: ["item_id"] }),
    await extract({ noInherit: true }),
  ]) {
    assert.notEqual(changed.structuralFingerprint, original.structuralFingerprint);
    assert.notEqual(changed.physicalFingerprint, original.physicalFingerprint);
  }
});

test("catalog extraction fails when a child row has no table snapshot", async () => {
  const results = [
    { rows: [] },
    { rows: [{
      schema_name: "public", table_name: "missing", column_position: 1,
      column_name: "id", data_type: "uuid", nullable: false,
      column_default: null, generated: null,
    }] },
    { rows: [] },
    { rows: [] },
  ];
  let index = 0;
  await assert.rejects(
    () => readPostgresSnapshot({ async query() { return results[index++]!; } }),
    /child object for unknown table/,
  );
});

test("read-only query layer rejects a mutating CTE before touching its client", async () => {
  let calls = 0;
  const layer = readOnlyQueryLayer({ async query() { calls += 1; return { rows: [] }; } });
  assert.throws(
    () => layer.query("WITH removed AS (DELETE FROM orders RETURNING *) SELECT * FROM removed"),
    /refused/,
  );
  assert.equal(calls, 0);
  await layer.query("WITH catalog AS (SELECT 1) SELECT * FROM catalog");
  assert.equal(calls, 1);
});

test("reconciles nullable partial uniqueness and reports PK representation safely", () => {
  const desired = clone();
  desired.tables[0]!.uniques = [{ name: "amount_unique", columns: ["amount"] }];
  desired.tables[0]!.columns[2]!.nullable = true;
  const actual = structuredClone(desired);
  actual.tables[0]!.uniques = [];
  actual.tables[0]!.indexes.push({
    name: "amount_partial_unique", expressions: ["amount"], unique: true,
    predicate: "amount is not null", method: "btree",
  });
  const partial = compareSchemas(desired, actual).findings;
  assert.deepEqual(partial.map((finding) => finding.category), ["SEMANTIC_MATCH_DIFFERENT_NAME"]);
  actual.tables[0]!.indexes.at(-1)!.predicate = "amount > 0";
  assert.deepEqual(compareSchemas(desired, actual).findings.map((finding) => finding.category),
    ["EXTRA_IN_DB", "MISSING_IN_DB"]);

  const wantedPk = clone();
  wantedPk.tables[0]!.primaryKey = null;
  wantedPk.tables[0]!.indexes.push({
    name: "orders_id_unique", expressions: ["id"], unique: true, predicate: null, method: "btree",
  });
  const pkReport = compareSchemas(wantedPk, clone()).findings;
  assert.equal(pkReport.filter((finding) => finding.category === "DESIGN_DIFFERENCE").length, 1);
  assert.equal(pkReport.find((finding) => finding.category === "DESIGN_DIFFERENCE")?.decision, "NEEDS_DESIGN_DECISION");
});

test("severity follows category and enforcement direction", () => {
  const missingUnique = clone();
  missingUnique.tables[0]!.uniques = [];
  assert.equal(compareSchemas(snapshot(), missingUnique).findings[0]?.severity, "P1");

  const cascade = clone();
  cascade.tables[0]!.foreignKeys[0]!.onDelete = "restrict";
  const cascadeReport = compareSchemas(cascade, clone()).findings[0]!;
  assert.equal(cascadeReport.severity, "P0");
  assert.equal(cascadeReport.enforcementDirection, "DIFFERENT");

  const extraFkDesired = clone();
  extraFkDesired.tables[0]!.foreignKeys = [];
  const extraFk = compareSchemas(extraFkDesired, clone()).findings[0]!;
  assert.equal(extraFk.severity, "P2");
  assert.equal(extraFk.decision, "NEEDS_DESIGN_DECISION");
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
    { position: 4, name: "z", type: "text", nullable: true, default: null, generated: null },
    { position: 5, name: "a", type: "text", nullable: true, default: null, generated: null },
  );
  const first = serializeReport(compareSchemas(snapshot(), withExtras));
  withExtras.tables[0]!.columns.reverse();
  assert.equal(serializeReport(compareSchemas(snapshot(), withExtras)), first);
  assert.ok(first.indexOf("public.orders.a") < first.indexOf("public.orders.z"));
});

test("legacy audit JSON does not expose fingerprint-only catalog fields", () => {
  const actual = clone();
  actual.tables[0]!.columns[2]!.type = "bigint";
  actual.tables[0]!.uniques[0]!.nullsNotDistinct = true;
  actual.tables[0]!.indexes[0]!.includeExpressions = ["tenant_id"];
  const serialized = serializeReport(compareSchemas(snapshot(), actual));
  assert.equal(serialized.includes('"position"'), false);
  assert.equal(serialized.includes('"nullsNotDistinct"'), false);
  assert.equal(serialized.includes('"includeExpressions"'), false);
  assert.equal(serialized.includes('"generatedMode"'), false);
  assert.equal(serialized.includes('"identity"'), false);
  assert.equal(serialized.includes('"collation"'), false);
  assert.equal(serialized.includes('"deleteSetColumns"'), false);
  assert.equal(serialized.includes('"noInherit"'), false);
  assert.equal(serialized.includes('"exclusions"'), false);
  assert.match(serialized, /^\{\n  "formatVersion": 1,/);
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