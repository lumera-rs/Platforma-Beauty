import {
  type AuditReport, type EnforcementDirection, type Finding, type ObjectType, type OwnershipException,
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

function classify(
  type: ObjectType, category: Finding["category"], expected: unknown, actual: unknown,
): Pick<Finding, "severity" | "enforcementDirection" | "decision" | "safety"> {
  if (category === "SEMANTIC_MATCH_DIFFERENT_NAME") {
    return { severity: "P3", enforcementDirection: "EQUIVALENT", decision: "MECHANICAL", safety: null };
  }
  if (category === "DESIGN_DIFFERENCE") {
    return {
      severity: "P2", enforcementDirection: "EQUIVALENT", decision: "NEEDS_DESIGN_DECISION",
      safety: "Object type differs. Do not drop the primary key before replacement uniqueness exists.",
    };
  }
  if (category === "OWNERSHIP_EXCEPTION") {
    return { severity: "P3", enforcementDirection: "UNKNOWN", decision: "MECHANICAL", safety: null };
  }
  if (category === "MISSING_IN_DB") {
    return {
      severity: type === "TABLE" ? "P0" : type === "INDEX" || type === "UNIQUE"
        || type === "PRIMARY_KEY" || type === "FOREIGN_KEY" || type === "CHECK" || type === "COLUMN" ? "P1" : "P2",
      enforcementDirection: "DB_WEAKER", decision: "MECHANICAL", safety: null,
    };
  }
  if (category === "EXTRA_IN_DB") {
    return {
      severity: type === "TABLE" ? "P1" : "P2", enforcementDirection: "DB_STRICTER",
      decision: "NEEDS_DESIGN_DECISION", safety: "Review ownership and dependent data before removal.",
    };
  }
  if (type === "FOREIGN_KEY") {
    const wanted = expected as { onDelete?: string };
    const found = actual as { onDelete?: string };
    const destructiveCascade = found?.onDelete === "cascade" && wanted?.onDelete !== "cascade";
    return {
      severity: destructiveCascade ? "P0" : "P1",
      enforcementDirection: destructiveCascade ? "DIFFERENT" : "UNKNOWN",
      decision: destructiveCascade ? "MECHANICAL" : "NEEDS_DESIGN_DECISION",
      safety: destructiveCascade ? "DB CASCADE can delete dependent data where canonical behavior would not." : null,
    };
  }
  if (type === "COLUMN") {
    const wanted = expected as { nullable?: boolean };
    const found = actual as { nullable?: boolean };
    const direction: EnforcementDirection = wanted?.nullable === false && found?.nullable === true
      ? "DB_WEAKER" : wanted?.nullable === true && found?.nullable === false ? "DB_STRICTER" : "UNKNOWN";
    return {
      severity: direction === "DB_WEAKER" ? "P1" : "P2", enforcementDirection: direction,
      decision: direction === "UNKNOWN" ? "NEEDS_DESIGN_DECISION" : "MECHANICAL", safety: null,
    };
  }
  return {
    severity: type === "PRIMARY_KEY" || type === "UNIQUE" || type === "CHECK" ? "P1" : "P2",
    enforcementDirection: "UNKNOWN", decision: "NEEDS_DESIGN_DECISION", safety: null,
  };
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
    const classification = finalCategory === "OWNERSHIP_EXCEPTION"
      ? { severity: "P3" as const, enforcementDirection: "UNKNOWN" as const, decision: "MECHANICAL" as const, safety: null }
      : classify(objectType, finalCategory, expected, found);
    findings.push({
      category: finalCategory,
      ...classification,
      objectType,
      objectPath: [schema, table, name].filter(Boolean).join("."),
      objectName: name,
      expected,
      actual: found,
      ownership,
      semanticEquality: finalCategory === "SEMANTIC_MATCH_DIFFERENT_NAME"
        || finalCategory === "DESIGN_DIFFERENCE",
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
    let actualPrimary = actualTable.primaryKey;
    const actualUniques = [...actualTable.uniques];
    const actualIndexes = [...actualTable.indexes];
    // A Drizzle unique index and a database PK enforce the same key only when
    // every key column is NOT NULL. Keep the representation difference visible
    // as one safety-bearing finding rather than reporting missing + extra.
    if (!expectedTable.primaryKey && actualPrimary) {
      const pkIndex = expectedTable.indexes.findIndex((index) =>
        index.unique && !index.predicate && index.method === "btree"
        && stable(index.expressions) === stable(actualPrimary!.columns)
        && index.expressions.every((name) => expectedTable.columns.find((column) => column.name === name)?.nullable === false));
      if (pkIndex >= 0) {
        const wanted = expectedTable.indexes[pkIndex]!;
        expectedTable.indexes.splice(pkIndex, 1);
        add("DESIGN_DIFFERENCE", "PRIMARY_KEY", expectedTable.schema, expectedTable.name,
          wanted.name, { representation: "UNIQUE_INDEX", definition: wanted },
          { representation: "PRIMARY_KEY", definition: actualPrimary });
        actualPrimary = null;
      }
    }
    compareSingleton(expectedTable.primaryKey, actualPrimary, "PRIMARY_KEY", expectedTable.schema, expectedTable.name, add);
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
        x.unique && x.method === "btree"
        && stable(x.expressions) === stable(wanted.columns)
        && (!x.predicate || nullableUniquePredicateEquivalent(
          wanted.columns, x.predicate, expectedTable.columns)));
      if (match >= 0) {
        const [index] = actualIndexes.splice(match, 1);
        actualUniques.push({ name: index!.name, columns: index!.expressions });
      }
    }
    for (const wanted of expectedTable.indexes.filter((x) => x.unique && !x.predicate && x.method === "btree")) {
      const match = actualIndexes.find((x) =>
        x.unique && x.method === "btree" && x.predicate
        && stable(x.expressions) === stable(wanted.expressions)
        && nullableUniquePredicateEquivalent(wanted.expressions, x.predicate, expectedTable.columns));
      if (match) match.predicate = null;
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
    MISSING_IN_DB: 0, EXTRA_IN_DB: 0, DEFINITION_MISMATCH: 0,
    SEMANTIC_MATCH_DIFFERENT_NAME: 0, DESIGN_DIFFERENCE: 0, OWNERSHIP_EXCEPTION: 0,
  };
  for (const finding of findings) counts[finding.category] += 1;
  return {
    formatVersion: 1,
    actionable: findings.some((x) =>
      x.category !== "OWNERSHIP_EXCEPTION" && x.category !== "SEMANTIC_MATCH_DIFFERENT_NAME"),
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
  } else if (expected.name !== actual.name) {
    add("SEMANTIC_MATCH_DIFFERENT_NAME", type, schema, table, expected.name, expected, actual);
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
    } else if (found.name !== wanted.name) {
      add("SEMANTIC_MATCH_DIFFERENT_NAME", type, schema, table, wanted.name, wanted, found);
    }
  }
  for (const extra of remaining) add("EXTRA_IN_DB", type, schema, table, extra.name, null, extra);
}

function nullableUniquePredicateEquivalent(
  columns: string[], predicate: string, definitions: Array<{ name: string; nullable: boolean }>,
): boolean {
  const nullable = columns.filter((name) => definitions.find((column) => column.name === name)?.nullable);
  if (nullable.length !== 1) return false;
  if (columns.some((name) => !definitions.some((column) => column.name === name))) return false;
  return predicate === `${nullable[0]} is not null`;
}

export function serializeReport(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function summarizeReport(report: AuditReport): string {
  const informational = report.counts.OWNERSHIP_EXCEPTION
    + report.counts.SEMANTIC_MATCH_DIFFERENT_NAME;
  return `Schema drift: ${report.findings.length} finding(s), `
    + `${report.findings.length - informational} actionable, `
    + `${report.counts.OWNERSHIP_EXCEPTION} ownership exception(s).`;
}