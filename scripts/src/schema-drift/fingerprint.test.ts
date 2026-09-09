import assert from "node:assert/strict";
import test from "node:test";
import {
  fingerprintSnapshot,
  serializeFingerprint,
  type CatalogFingerprintResult,
} from "./fingerprint";
import type { OwnershipException, SchemaSnapshot, TableDefinition } from "./model";

function table(name = "orders"): TableDefinition {
  return {
    schema: "public",
    name,
    columns: [
      { position: 1, name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()", generated: null },
      { position: 2, name: "tenant_id", type: "uuid", nullable: false, default: null, generated: null },
      { position: 3, name: "amount", type: "integer", nullable: false, default: "0", generated: null },
    ],
    primaryKey: {
      name: `${name}_pkey`, columns: ["id"],
      indexMethod: "btree", indexIncludeExpressions: [], indexKeyOptions: [0],
      indexCollations: [""], indexOpclasses: ["pg_catalog.uuid_ops"],
      indexValid: true, indexReady: true,
    },
    uniques: [
      {
        name: `${name}_tenant_id_unique`, columns: ["tenant_id", "id"],
        indexMethod: "btree", indexIncludeExpressions: [], indexKeyOptions: [0, 0],
        indexCollations: ["", ""], indexOpclasses: ["pg_catalog.uuid_ops", "pg_catalog.uuid_ops"],
        indexValid: true, indexReady: true,
      },
      {
        name: `${name}_amount_unique`, columns: ["amount"],
        indexMethod: "btree", indexIncludeExpressions: [], indexKeyOptions: [0],
        indexCollations: [""], indexOpclasses: ["pg_catalog.int4_ops"],
        indexValid: true, indexReady: true,
      },
    ],
    foreignKeys: [{
      name: `${name}_tenant_fk`,
      columns: ["tenant_id"],
      foreignSchema: "public",
      foreignTable: "tenants",
      foreignColumns: ["id"],
      onDelete: "restrict",
      onUpdate: "cascade",
      deleteSetColumns: [],
    }],
    checks: [{
      name: `${name}_amount_check`, expression: "amount >= 0",
      validated: true, noInherit: false,
    }],
    exclusions: [{
      name: `${name}_active_amount_no_overlap`,
      definition: "EXCLUDE USING gist (tenant_id WITH =, amount WITH =) WHERE (amount > 0)",
      deferrable: false,
      initiallyDeferred: false,
      validated: true,
      indexMethod: "gist",
      indexIncludeExpressions: [],
      indexKeyOptions: [0, 0],
      indexCollations: ["", ""],
      indexOpclasses: ["pg_catalog.uuid_ops", "pg_catalog.int4_ops"],
      indexValid: true,
      indexReady: true,
    }],
    indexes: [{
      name: `${name}_amount_idx`,
      expressions: ["amount", "lower((tenant_id)::text)"],
      unique: false,
      predicate: "amount > 0",
      method: "btree",
      keyOptions: [0, 1],
      collations: ["", "pg_catalog.default"],
      opclasses: ["pg_catalog.int4_ops", "pg_catalog.text_ops"],
    }],
  };
}

const snapshot = (): SchemaSnapshot => ({
  tables: [table("orders"), table("invoices")],
});

const clone = (): SchemaSnapshot => structuredClone(snapshot());

function fingerprints(value: SchemaSnapshot): Pick<
CatalogFingerprintResult, "structuralFingerprint" | "physicalFingerprint"
> {
  const result = fingerprintSnapshot(value);
  return {
    structuralFingerprint: result.structuralFingerprint,
    physicalFingerprint: result.physicalFingerprint,
  };
}

test("identical, reordered, and repeated snapshots have byte-stable fingerprints", () => {
  const original = snapshot();
  const reordered = clone();
  reordered.tables.reverse();
  for (const current of reordered.tables) {
    current.columns.reverse();
    current.uniques.reverse();
    current.foreignKeys.reverse();
    current.checks.reverse();
    current.indexes.reverse();
  }
  const first = fingerprintSnapshot(original);
  const second = fingerprintSnapshot(reordered);
  const third = fingerprintSnapshot(original);
  assert.deepEqual(fingerprints(reordered), fingerprints(original));
  assert.deepEqual(fingerprints(original), fingerprints(original));
  assert.equal(serializeFingerprint(first), serializeFingerprint(second));
  assert.equal(serializeFingerprint(first), serializeFingerprint(third));
  assert.match(first.structuralFingerprint, /^[a-f0-9]{64}$/);
  assert.match(first.physicalFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.algorithm, "sha256");
  assert.equal(first.fingerprintVersion, 1);
  assert.equal(first.schemaFormatVersion, 1);
});

for (const [label, mutate] of [
  ["column order", (value: SchemaSnapshot) => { value.tables[0]!.columns[0]!.position = 2; value.tables[0]!.columns[1]!.position = 1; }],
  ["column type", (value: SchemaSnapshot) => { value.tables[0]!.columns[2]!.type = "bigint"; }],
  ["nullability", (value: SchemaSnapshot) => { value.tables[0]!.columns[2]!.nullable = true; }],
  ["default", (value: SchemaSnapshot) => { value.tables[0]!.columns[2]!.default = "1"; }],
  ["generated expression", (value: SchemaSnapshot) => { value.tables[0]!.columns[2]!.generated = "tenant_id"; }],
  ["generated mode", (value: SchemaSnapshot) => { value.tables[0]!.columns[2]!.generatedMode = "stored"; }],
  ["identity mode", (value: SchemaSnapshot) => { value.tables[0]!.columns[2]!.identity = "always"; }],
  ["column collation", (value: SchemaSnapshot) => { value.tables[0]!.columns[2]!.collation = "public.custom"; }],
  ["primary key order", (value: SchemaSnapshot) => {
    value.tables[0]!.primaryKey!.columns = ["tenant_id", "id"];
    value.tables[0]!.primaryKey!.indexKeyOptions = [0, 0];
    value.tables[0]!.primaryKey!.indexCollations = ["", ""];
    value.tables[0]!.primaryKey!.indexOpclasses = ["pg_catalog.uuid_ops", "pg_catalog.uuid_ops"];
  }],
  ["unique columns", (value: SchemaSnapshot) => {
    value.tables[0]!.uniques[0]!.columns = ["id"];
    value.tables[0]!.uniques[0]!.indexKeyOptions = [0];
    value.tables[0]!.uniques[0]!.indexCollations = [""];
    value.tables[0]!.uniques[0]!.indexOpclasses = ["pg_catalog.uuid_ops"];
  }],
  ["unique NULLS NOT DISTINCT", (value: SchemaSnapshot) => { value.tables[0]!.uniques[0]!.nullsNotDistinct = true; }],
  ["unique deferrability", (value: SchemaSnapshot) => { value.tables[0]!.uniques[0]!.deferrable = true; }],
  ["unique initially deferred state", (value: SchemaSnapshot) => { value.tables[0]!.uniques[0]!.initiallyDeferred = true; }],
  ["unique validation state", (value: SchemaSnapshot) => { value.tables[0]!.uniques[0]!.validated = false; }],
  ["unique backing index option", (value: SchemaSnapshot) => { value.tables[0]!.uniques[0]!.indexKeyOptions![0] = 1; }],
  ["unique backing index INCLUDE attribute", (value: SchemaSnapshot) => { value.tables[0]!.uniques[0]!.indexIncludeExpressions = ["amount"]; }],
  ["unique backing index collation", (value: SchemaSnapshot) => { value.tables[0]!.uniques[0]!.indexCollations![0] = "public.custom"; }],
  ["unique backing index opclass", (value: SchemaSnapshot) => { value.tables[0]!.uniques[0]!.indexOpclasses![0] = "public.custom_ops"; }],
  ["unique backing index validity", (value: SchemaSnapshot) => { value.tables[0]!.uniques[0]!.indexValid = false; }],
  ["check expression", (value: SchemaSnapshot) => { value.tables[0]!.checks[0]!.expression = "amount > 0"; }],
  ["check validation state", (value: SchemaSnapshot) => { value.tables[0]!.checks[0]!.validated = false; }],
  ["check NO INHERIT state", (value: SchemaSnapshot) => { value.tables[0]!.checks[0]!.noInherit = true; }],
  ["exclusion definition", (value: SchemaSnapshot) => { value.tables[0]!.exclusions![0]!.definition = "EXCLUDE USING gist (tenant_id WITH =, amount WITH <>)"; }],
  ["exclusion deferrability", (value: SchemaSnapshot) => { value.tables[0]!.exclusions![0]!.deferrable = true; }],
  ["exclusion initially deferred state", (value: SchemaSnapshot) => { value.tables[0]!.exclusions![0]!.initiallyDeferred = true; }],
  ["exclusion validation state", (value: SchemaSnapshot) => { value.tables[0]!.exclusions![0]!.validated = false; }],
  ["exclusion backing index option", (value: SchemaSnapshot) => { value.tables[0]!.exclusions![0]!.indexKeyOptions![0] = 2; }],
  ["exclusion backing index INCLUDE attribute", (value: SchemaSnapshot) => { value.tables[0]!.exclusions![0]!.indexIncludeExpressions = ["id"]; }],
  ["FK local columns", (value: SchemaSnapshot) => { value.tables[0]!.foreignKeys[0]!.columns = ["id"]; }],
  ["FK referenced columns", (value: SchemaSnapshot) => { value.tables[0]!.foreignKeys[0]!.foreignColumns = ["legacy_id"]; }],
  ["FK delete action", (value: SchemaSnapshot) => { value.tables[0]!.foreignKeys[0]!.onDelete = "cascade"; }],
  ["FK update action", (value: SchemaSnapshot) => { value.tables[0]!.foreignKeys[0]!.onUpdate = "restrict"; }],
  ["FK match type", (value: SchemaSnapshot) => { value.tables[0]!.foreignKeys[0]!.matchType = "full"; }],
  ["FK deferrability", (value: SchemaSnapshot) => { value.tables[0]!.foreignKeys[0]!.deferrable = true; }],
  ["FK initially deferred state", (value: SchemaSnapshot) => { value.tables[0]!.foreignKeys[0]!.initiallyDeferred = true; }],
  ["FK validation state", (value: SchemaSnapshot) => { value.tables[0]!.foreignKeys[0]!.validated = false; }],
  ["FK deletion-target columns", (value: SchemaSnapshot) => { value.tables[0]!.foreignKeys[0]!.deleteSetColumns = ["tenant_id"]; }],
  ["index expression order", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.expressions.reverse(); }],
  ["index include expressions", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.includeExpressions = ["tenant_id"]; }],
  ["index key ordering and opclass", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.expressions[0] = "amount int4_ops desc nulls first"; }],
  ["index predicate", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.predicate = "amount >= 0"; }],
  ["index uniqueness", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.unique = true; }],
  ["index NULLS NOT DISTINCT", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.nullsNotDistinct = true; }],
  ["index method", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.method = "hash"; }],
  ["index validity", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.valid = false; }],
  ["index readiness", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.ready = false; }],
  ["index key option", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.keyOptions![0] = 1; }],
  ["index collation", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.collations![0] = "public.custom"; }],
  ["index opclass", (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.opclasses![0] = "public.custom_ops"; }],
] as const) test(`${label} changes both fingerprints`, () => {
  const changed = clone();
  mutate(changed);
  const before = fingerprints(snapshot());
  const after = fingerprints(changed);
  assert.notEqual(after.structuralFingerprint, before.structuralFingerprint);
  assert.notEqual(after.physicalFingerprint, before.physicalFingerprint);
});

test("physical constraint and index renames affect only the physical fingerprint", () => {
  const changed = clone();
  changed.tables[0]!.primaryKey!.name = "renamed_pk";
  changed.tables[0]!.uniques[0]!.name = "renamed_unique";
  changed.tables[0]!.foreignKeys[0]!.name = "renamed_fk";
  changed.tables[0]!.checks[0]!.name = "renamed_check";
  changed.tables[0]!.exclusions![0]!.name = "renamed_exclusion";
  changed.tables[0]!.indexes[0]!.name = "renamed_index";
  const before = fingerprints(snapshot());
  const after = fingerprints(changed);
  assert.equal(after.structuralFingerprint, before.structuralFingerprint);
  assert.notEqual(after.physicalFingerprint, before.physicalFingerprint);
});

test("known normalization-equivalent SQL produces the same fingerprints", () => {
  const equivalent = clone();
  equivalent.tables[0]!.checks[0]!.expression = `((orders.amount) >= (0))`;
  equivalent.tables[0]!.indexes[0]!.predicate = `orders.amount > 0`;
  assert.deepEqual(fingerprints(equivalent), fingerprints(snapshot()));
});

test("preserves literal case, arithmetic grouping, casts, and function schema identity", () => {
  for (const mutate of [
    (value: SchemaSnapshot) => { value.tables[0]!.columns[2]!.default = "'ACTIVE'"; },
    (value: SchemaSnapshot) => { value.tables[0]!.checks[0]!.expression = "(amount+tenant_id)*id"; },
    (value: SchemaSnapshot) => { value.tables[0]!.indexes[0]!.expressions[0] = "amount::bigint"; },
    (value: SchemaSnapshot) => { value.tables[0]!.columns[2]!.default = "schema_a.make_value()"; },
  ]) {
    const left = clone();
    const right = clone();
    mutate(left);
    if (left.tables[0]!.columns[2]!.default === "'ACTIVE'") {
      right.tables[0]!.columns[2]!.default = "'active'";
    } else if (left.tables[0]!.checks[0]!.expression === "(amount+tenant_id)*id") {
      right.tables[0]!.checks[0]!.expression = "amount+tenant_id*id";
    } else if (left.tables[0]!.indexes[0]!.expressions[0] === "amount::bigint") {
      right.tables[0]!.indexes[0]!.expressions[0] = "amount";
    } else {
      right.tables[0]!.columns[2]!.default = "schema_b.make_value()";
    }
    assert.notDeepEqual(fingerprints(left), fingerprints(right));
  }
});

test("preserves double quotes inside literals and table-named function schemas", () => {
  const quotedLiteral = clone();
  const plainLiteral = clone();
  quotedLiteral.tables[0]!.columns[2]!.default = `'\"active\"'`;
  plainLiteral.tables[0]!.columns[2]!.default = "'active'";
  assert.notDeepEqual(fingerprints(quotedLiteral), fingerprints(plainLiteral));

  const qualifiedFunction = clone();
  const unqualifiedFunction = clone();
  qualifiedFunction.tables[0]!.columns[2]!.default = "invoices.make_value()";
  unqualifiedFunction.tables[0]!.columns[2]!.default = "make_value()";
  assert.notDeepEqual(fingerprints(qualifiedFunction), fingerprints(unqualifiedFunction));
});

test("preserves function-call parentheses and NOT grouping", () => {
  const functionCall = clone();
  const identifier = clone();
  functionCall.tables[0]!.checks[0]!.expression = "amount > abs(1)";
  identifier.tables[0]!.checks[0]!.expression = "amount > abs1";
  assert.notDeepEqual(fingerprints(functionCall), fingerprints(identifier));

  const groupedNot = clone();
  const ungroupedNot = clone();
  groupedNot.tables[0]!.checks[0]!.expression =
    "not (amount > 0 and tenant_id is not null) or id is null";
  ungroupedNot.tables[0]!.checks[0]!.expression =
    "not amount > 0 and tenant_id is not null or id is null";
  assert.notDeepEqual(fingerprints(groupedNot), fingerprints(ungroupedNot));
});

test("preserves quoted type identity", () => {
  const titleCase = clone();
  const upperCase = clone();
  titleCase.tables[0]!.columns[2]!.type = `"Status"`;
  upperCase.tables[0]!.columns[2]!.type = `"STATUS"`;
  assert.notDeepEqual(fingerprints(titleCase), fingerprints(upperCase));
});

test("preserves escaped quotes in complete quoted identifiers", () => {
  const escapedQuote = clone();
  const plainIdentifier = clone();
  for (const value of [escapedQuote, plainIdentifier]) {
    value.tables[0]!.columns.push(
      { position: 4, name: `foo"bar`, type: "text", nullable: true, default: null, generated: null },
      { position: 5, name: "foobar", type: "text", nullable: true, default: null, generated: null },
    );
  }
  escapedQuote.tables[0]!.checks[0]!.expression = `"foo""bar" is not null`;
  plainIdentifier.tables[0]!.checks[0]!.expression = `"foobar" is not null`;
  assert.notDeepEqual(fingerprints(escapedQuote), fingerprints(plainIdentifier));
});

test("distinguishes a quoted keyword column from the SQL boolean constant", () => {
  const quotedColumn = clone();
  const booleanConstant = clone();
  for (const value of [quotedColumn, booleanConstant]) {
    value.tables[0]!.columns.push({
      position: 4, name: "true", type: "boolean",
      nullable: false, default: "false", generated: null,
    });
  }
  quotedColumn.tables[0]!.checks[0]!.expression = `"true"`;
  booleanConstant.tables[0]!.checks[0]!.expression = "true";
  assert.notDeepEqual(fingerprints(quotedColumn), fingerprints(booleanConstant));
});

test("preserves apostrophes inside complete quoted identifiers", () => {
  const firstColumn = clone();
  const secondColumn = clone();
  for (const value of [firstColumn, secondColumn]) {
    value.tables[0]!.columns.push(
      { position: 4, name: "a'X'b", type: "integer", nullable: true, default: null, generated: null },
      { position: 5, name: "a'Y'b", type: "integer", nullable: true, default: null, generated: null },
    );
  }
  firstColumn.tables[0]!.checks[0]!.expression = `"a'X'b" > 0`;
  secondColumn.tables[0]!.checks[0]!.expression = `"a'Y'b" > 0`;
  const first = fingerprintSnapshot(firstColumn);
  const second = fingerprintSnapshot(secondColumn);
  assert.notEqual(first.structuralFingerprint, second.structuralFingerprint);
  assert.notEqual(first.physicalFingerprint, second.physicalFingerprint);
  const payload = JSON.stringify(first.structuralPayload);
  assert.match(payload, /a'X'b/);
  assert.equal(payload.includes("\uE000"), false);
  assert.equal(payload.includes("\uE001"), false);
});

test("dropped-column ordinal gaps normalize to contiguous logical positions", () => {
  const withGaps = clone();
  withGaps.tables[0]!.columns[0]!.position = 1;
  withGaps.tables[0]!.columns[1]!.position = 3;
  withGaps.tables[0]!.columns[2]!.position = 8;
  assert.deepEqual(fingerprints(withGaps), fingerprints(snapshot()));
  assert.deepEqual(
    fingerprintSnapshot(withGaps).physicalPayload.tables[1]!.columns.map((column) => column.position),
    [1, 2, 3],
  );
});

test("fails closed for malformed or duplicate catalog identity", () => {
  const duplicateTable = clone();
  duplicateTable.tables.push(structuredClone(duplicateTable.tables[0]!));
  assert.throws(() => fingerprintSnapshot(duplicateTable), /Duplicate catalog table/);

  const duplicatePosition = clone();
  duplicatePosition.tables[0]!.columns[1]!.position = 1;
  assert.throws(() => fingerprintSnapshot(duplicatePosition), /Duplicate catalog column position/);

  const missingPosition = clone();
  delete missingPosition.tables[0]!.columns[0]!.position;
  assert.throws(() => fingerprintSnapshot(missingPosition), /Invalid catalog column position/);

  const duplicateIndex = clone();
  duplicateIndex.tables[0]!.indexes.push(structuredClone(duplicateIndex.tables[0]!.indexes[0]!));
  assert.throws(() => fingerprintSnapshot(duplicateIndex), /Duplicate .* index/);
});

test("ownership exceptions are exact, explicit, sorted, and excluded", () => {
  const owned = table("spatial_ref_sys");
  const unknown = table("unknown_extra");
  const input: SchemaSnapshot = { tables: [unknown, owned, table("orders")] };
  const registry: OwnershipException[] = [{
    objectType: "TABLE",
    schema: "public",
    name: "spatial_ref_sys",
    owner: "PostGIS extension",
    mechanism: "CREATE EXTENSION postgis",
    reason: "extension owned",
    temporary: false,
  }];
  const result = fingerprintSnapshot(input, registry);
  assert.deepEqual(result.ownershipExceptions, [{ ...registry[0], handling: "EXCLUDED" }]);
  assert.equal(result.structuralPayload.tables.some((item) => item.name === "spatial_ref_sys"), false);
  assert.equal(result.physicalPayload.tables.some((item) => item.name === "spatial_ref_sys"), false);
  assert.equal(result.structuralPayload.tables.some((item) => item.name === "unknown_extra"), true);
  assert.equal(result.physicalPayload.tables.some((item) => item.name === "unknown_extra"), true);
  assert.notDeepEqual(
    fingerprints({ tables: [table("orders"), unknown] }),
    fingerprints({ tables: [table("orders")] }),
  );
});

test("absent ownership registry entries are not reported as applied", () => {
  const registry: OwnershipException[] = [{
    objectType: "TABLE",
    schema: "public",
    name: "spatial_ref_sys",
    owner: "PostGIS extension",
    mechanism: "CREATE EXTENSION postgis",
    reason: "extension owned",
    temporary: false,
  }];
  assert.deepEqual(fingerprintSnapshot(snapshot(), registry).ownershipExceptions, []);
});