import test from "node:test";
import assert from "node:assert/strict";
import { classifyTable, LEDGER, planMapping, type ColumnShape, type TableShape } from "./mapping";
import { parseTransferArguments } from "./cli";
import { stableRows } from "./seed-contract";
import { verifyConstraints } from "./constraints";

const column = (name: string, overrides: Partial<ColumnShape> = {}): ColumnShape =>
  ({ name, type: "integer", notNull: true, default: null, identity: "", generated: "", ...overrides });
const table = (...columns: ColumnShape[]): TableShape => ({ name: "public.items", columns, primaryKey: ["id"] });
test("mapping refuses a source-only column unless its exact qualified name is approved", () => {
  const source = table(column("id"), column("extra"));
  assert.deepEqual(planMapping(source, table(column("id"))).blockers, [{ code: "SOURCE_ONLY_COLUMN", table: "public.items", column: "extra" }]);
  assert.deepEqual(planMapping(source, table(column("id")), { dropColumns: ["public.items.extra"] }).drops, ["extra"]);
});
test("mapping blocks target-only required columns and preserves defaults or nullable columns", () => {
  const source = table(column("id"));
  assert.equal(planMapping(source, table(column("id"), column("required"))).blockers[0]?.code, "TARGET_REQUIRED_COLUMN");
  const result = planMapping(source, table(column("id"), column("nullable", { notNull: false }), column("seed", { default: "42" })));
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.defaults, ["nullable", "seed"]);
});
test("mapping accepts only named built-in lossless widening and never a narrowing cast", () => {
  const source = table(column("id"));
  const target = table(column("id", { type: "bigint" }));
  assert.equal(planMapping(source, target).blockers[0]?.code, "TYPE_DIFFERENCE");
  assert.deepEqual(planMapping(source, target, { casts: { "public.items.id": "integer->bigint" } }).blockers, []);
  assert.equal(planMapping(target, source, { casts: { "public.items.id": "bigint->integer" } }).blockers[0]?.code, "TYPE_DIFFERENCE");
});
test("classification defaults business data to transfer and leaves retention decisions unresolved", () => {
  assert.equal(classifyTable("public.payment_ledger", false).action, "transfer");
  assert.equal(classifyTable(LEDGER, false).action, "do-not-transfer");
  assert.deepEqual(classifyTable("public.sessions", false), { action: "transfer", ownerDecision: true });
  assert.deepEqual(classifyTable("public.subscription_plans", true), { action: "compare-with-seeded-rows", ownerDecision: false });
});
test("mapping refuses a missing shared primary key", () => {
  assert.ok(planMapping(table(column("other")), table(column("id"))).blockers.some(b => b.code === "SHARED_PRIMARY_KEY_REQUIRED"));
});
test("canonical tables without primary keys use deterministic row-multiset ordering", () => {
  const shape = { ...table(column("value")), primaryKey: [] };
  const plan = planMapping(shape, shape);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.ordering, "row-multiset");
  assert.deepEqual(plan.shared, ["value"]);
});
test("generated shared columns are verified but recomputed rather than inserted", () => {
  const source = table(column("id"), column("participant_key", { type: "text" }));
  const target = table(column("id"), column("participant_key", { type: "text", generated: "s" }));
  const plan = planMapping(source, target);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.shared, ["id", "participant_key"]);
  assert.deepEqual(plan.generated, ["participant_key"]);
});
test("target-only required generated columns are derived rather than refused as missing defaults", () => {
  const plan = planMapping(table(column("id")), table(column("id"), column("derived", { generated: "s" })));
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.generated, ["derived"]);
});
test("transfer CLI never accepts ambient targets or operator-supplied seed baselines", () => {
  assert.throws(() => parseTransferArguments([]), /EXPLICIT_CONNECTIONS_REQUIRED/u);
  assert.throws(() => parseTransferArguments(["--baseline=anything"]), /INVALID_ARGUMENTS/u);
  assert.throws(() => parseTransferArguments(["--source-url=postgresql://x/a", "--target-url=postgresql://x/b?options=bad"]), /INVALID_CONNECTION/u);
});
test("content projection supports more than fifty columns without variadic JSON arguments", async () => {
  let observed = "";
  await stableRows({ async query(sql) { observed = sql; return { rows: [] }; } },
    "public.items", Array.from({ length: 128 }, (_, i) => `column_${i}`), ["column_0"]);
  assert.match(observed, /to_jsonb\(projected\)/u);
  assert.doesNotMatch(observed, /jsonb_build_object/u);
  assert.match(observed, /r\."column_127"/u);
});
test("mapping refuses real-to-double transport rather than claiming JSON decimal widening is lossless", () => {
  const source = table(column("id"), column("value", { type: "real" }));
  const target = table(column("id"), column("value", { type: "double precision" }));
  assert.ok(planMapping(source, target, { casts: { "public.items.value": "real->double precision" } })
    .blockers.some(b => b.code === "TYPE_DIFFERENCE"));
});
test("mapping refuses raw json and json arrays because JSONB transport normalizes raw representation", () => {
  for (const type of ["json", "json[]"]) {
    const shape = table(column("id"), column("document", { type }));
    assert.ok(planMapping(shape, shape).blockers.some(b => b.code === "RAW_JSON_TRANSPORT_UNSUPPORTED"));
  }
});
test("mapping refuses omitted sequence-backed columns before any nontransactional nextval can run", () => {
  for (const sequence of [
    column("serial_id", { default: "nextval('public.items_seq'::regclass)" }),
    column("identity_id", { identity: "a" }),
  ]) {
    assert.ok(planMapping(table(column("id")), table(column("id"), sequence))
      .blockers.some(b => b.code === "TARGET_SEQUENCE_DEFAULT_UNSUPPORTED"));
  }
});
test("constraint verification scans standalone partial expression unique indexes with NULL semantics", async () => {
  for (const nullsNotDistinct of [false, true]) {
    const queries: string[] = [];
    const violations = await verifyConstraints({ async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM pg_index i JOIN")) return { rows: [{
        table_name: "items", index_name: "items_lower_name_unique", amname: "btree",
        default_opclasses: true, indisvalid: true, indisready: true,
        indnullsnotdistinct: nullsNotDistinct, predicate: "active",
        expressions: ["lower(name)"],
      }] };
      if (sql.includes("WITH keys AS MATERIALIZED")) return { rows: [{ count: "2" }] };
      return { rows: [] };
    } }, []);
    assert.deepEqual(violations, [{ code: "CONSTRAINT_VIOLATION", table: "public.items", constraint: "items_lower_name_unique", count: 2 }]);
    const scan = queries.find(sql => sql.includes("WITH keys AS MATERIALIZED"))!;
    assert.match(scan, /lower\(name\)/u);
    assert.match(scan, /WHERE \(active\) IS TRUE/u);
    assert.equal(scan.includes('"key_0" IS NOT NULL'), !nullsNotDistinct);
    assert.match(scan, /GROUP BY "key_0"/u);
  }
});
test("standalone unique indexes with unsupported operator classes fail closed", async () => {
  const violations = await verifyConstraints({ async query(sql) {
    return { rows: sql.includes("FROM pg_index i JOIN") ? [{
      table_name: "items", index_name: "custom_unique", amname: "btree",
      default_opclasses: false, indisvalid: true, indisready: true, expressions: ["name"],
    }] : [] };
  } }, []);
  assert.deepEqual(violations, [{ code: "UNSUPPORTED_UNIQUE_INDEX", table: "public.items", constraint: "custom_unique" }]);
});