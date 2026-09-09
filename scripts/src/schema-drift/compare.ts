import {
  type AuditReport, type Finding, type ObjectType, type OwnershipException,
  type SchemaSnapshot, normalizeSnapshot,
} from "./model";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const semantic = (value: { name: string } | null) => value == null
  ? "null"
  : stable(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "name")));

function severity(type: ObjectType, category: Finding["category"]): Finding["severity"] {
  if (category === "OWNERSHIP_EXCEPTION") return "P3";
  if (type === "TABLE" || type === "PRIMARY_KEY") return "P0";
  if (type === "COLUMN" || type === "FOREIGN_KEY" || type === "CHECK") return "P1";
  return "P2";
}

function exceptionFor(
  registry: OwnershipException[], type: ObjectType, schema: string, table: string | undefined, name: string,
) {
  return registry.find((x) => x.objectType === type && x.schema === schema
    && x.table === table && x.name === name) ?? null;
}

export function compareSchemas(
  desiredInput: SchemaSnapshot,
  actualInput: SchemaSnapshot,
  registry: OwnershipException[] = [],
): AuditReport {
  const desired = normalizeSnapshot(desiredInput);
  const actual = normalizeSnapshot(actualInput);
  const findings: Finding[] = [];
  const add = (
    category: Finding["category"], objectType: ObjectType, schema: string,
    table: string | undefined, name: string, expected: unknown, found: unknown,
  ) => {
    const ownership = category === "EXTRA_IN_DB"
      ? exceptionFor(registry, objectType, schema, table, name)
      : null;
    const finalCategory = ownership ? "OWNERSHIP_EXCEPTION" : category;
    findings.push({
      category: finalCategory,
      severity: severity(objectType, finalCategory),
      objectType,
      objectPath: [schema, table, name].filter(Boolean).join("."),
      objectName: name,
      expected,
      actual: found,
      ownership,
    });
  };

  const actualTables = new Map(actual.tables.map((x) => [`${x.schema}.${x.name}`, x]));
  for (const expectedTable of desired.tables) {
    const key = `${expectedTable.schema}.${expectedTable.name}`;
    const actualTable = actualTables.get(key);
    if (!actualTable) {
      add("MISSING_IN_DB", "TABLE", expectedTable.schema, undefined, expectedTable.name, expectedTable, null);
      continue;
    }
    actualTables.delete(key);
    compareNamed(expectedTable.columns, actualTable.columns, "COLUMN", expectedTable.schema, expectedTable.name, add);
    compareSingleton(expectedTable.primaryKey, actualTable.primaryKey, "PRIMARY_KEY", expectedTable.schema, expectedTable.name, add);
    const actualUniques = [...actualTable.uniques];
    const actualIndexes = [...actualTable.indexes];
    // PostgreSQL bootstrap SQL sometimes implements a Drizzle uniqueIndex as
    // a UNIQUE constraint (or vice versa). They are equivalent for an
    // unqualified btree key, so reconcile these representations before
    // comparing their names and definitions.
    for (const wanted of expectedTable.indexes.filter((x) => x.unique && !x.predicate && x.method === "btree")) {
      const match = actualUniques.findIndex((x) =>
        stable(x.columns) === stable(wanted.expressions));
      if (match >= 0) {
        const [unique] = actualUniques.splice(match, 1);
        actualIndexes.push({
          name: unique!.name, expressions: unique!.columns, unique: true,
          predicate: null, method: "btree",
        });
      }
    }
    for (const wanted of expectedTable.uniques) {
      const match = actualIndexes.findIndex((x) =>
        x.unique && !x.predicate && x.method === "btree"
        && stable(x.expressions) === stable(wanted.columns));
      if (match >= 0) {
        const [index] = actualIndexes.splice(match, 1);
        actualUniques.push({ name: index!.name, columns: index!.expressions });
      }
    }
    compareNamed(expectedTable.uniques, actualUniques, "UNIQUE", expectedTable.schema, expectedTable.name, add, true);
    compareNamed(expectedTable.foreignKeys, actualTable.foreignKeys, "FOREIGN_KEY", expectedTable.schema, expectedTable.name, add, true);
    compareNamed(expectedTable.checks, actualTable.checks, "CHECK", expectedTable.schema, expectedTable.name, add, true);
    compareNamed(expectedTable.indexes, actualIndexes, "INDEX", expectedTable.schema, expectedTable.name, add, true);
  }
  for (const table of actualTables.values()) {
    add("EXTRA_IN_DB", "TABLE", table.schema, undefined, table.name, null, table);
  }
  findings.sort((a, b) =>
    a.objectPath.localeCompare(b.objectPath)
    || a.objectType.localeCompare(b.objectType)
    || a.category.localeCompare(b.category));
  const counts: AuditReport["counts"] = {
    MISSING_IN_DB: 0, EXTRA_IN_DB: 0, DEFINITION_MISMATCH: 0, OWNERSHIP_EXCEPTION: 0,
  };
  for (const finding of findings) counts[finding.category] += 1;
  return {
    formatVersion: 1,
    actionable: findings.some((x) => x.category !== "OWNERSHIP_EXCEPTION"),
    counts,
    findings,
  };
}

type Add = (
  category: Finding["category"], type: ObjectType, schema: string, table: string | undefined,
  name: string, expected: unknown, actual: unknown,
) => void;

function compareSingleton(
  expected: { name: string } | null, actual: { name: string } | null,
  type: ObjectType, schema: string, table: string, add: Add,
) {
  if (!expected && !actual) return;
  if (!expected) add("EXTRA_IN_DB", type, schema, table, actual!.name, null, actual);
  else if (!actual) add("MISSING_IN_DB", type, schema, table, expected.name, expected, null);
  else if (semantic(expected) !== semantic(actual)) {
    add("DEFINITION_MISMATCH", type, schema, table, expected.name, expected, actual);
  }
}

function compareNamed<T extends { name: string }>(
  expected: T[], actual: T[], type: ObjectType, schema: string, table: string,
  add: Add, allowSemanticRename = false,
) {
  const remaining = [...actual];
  for (const wanted of expected) {
    let index = remaining.findIndex((x) => x.name === wanted.name);
    if (index < 0 && allowSemanticRename) {
      index = remaining.findIndex((x) => semantic(x) === semantic(wanted));
    }
    if (index < 0) {
      add("MISSING_IN_DB", type, schema, table, wanted.name, wanted, null);
      continue;
    }
    const found = remaining.splice(index, 1)[0]!;
    if (semantic(found) !== semantic(wanted)) {
      add("DEFINITION_MISMATCH", type, schema, table, wanted.name, wanted, found);
    }
  }
  for (const extra of remaining) add("EXTRA_IN_DB", type, schema, table, extra.name, null, extra);
}

export function serializeReport(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function summarizeReport(report: AuditReport): string {
  return `Schema drift: ${report.findings.length} finding(s), `
    + `${report.findings.length - report.counts.OWNERSHIP_EXCEPTION} actionable, `
    + `${report.counts.OWNERSHIP_EXCEPTION} ownership exception(s).`;
}