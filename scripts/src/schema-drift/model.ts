export type DriftCategory =
  | "MISSING_IN_DB"
  | "EXTRA_IN_DB"
  | "DEFINITION_MISMATCH"
  | "SEMANTIC_MATCH_DIFFERENT_NAME"
  | "DESIGN_DIFFERENCE"
  | "OWNERSHIP_EXCEPTION";
export type Severity = "P0" | "P1" | "P2" | "P3";
export type EnforcementDirection = "DB_WEAKER" | "DB_STRICTER" | "EQUIVALENT" | "DIFFERENT" | "UNKNOWN";
export type ObjectType =
  | "TABLE"
  | "COLUMN"
  | "PRIMARY_KEY"
  | "UNIQUE"
  | "FOREIGN_KEY"
  | "CHECK"
  | "INDEX";

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  generated: string | null;
}
export interface KeyDefinition { name: string; columns: string[] }
export interface ForeignKeyDefinition extends KeyDefinition {
  foreignSchema: string;
  foreignTable: string;
  foreignColumns: string[];
  onDelete: string;
  onUpdate: string;
}
export interface CheckDefinition { name: string; expression: string }
export interface IndexDefinition {
  name: string;
  expressions: string[];
  unique: boolean;
  predicate: string | null;
  method: string;
}
export interface TableDefinition {
  schema: string;
  name: string;
  columns: ColumnDefinition[];
  primaryKey: KeyDefinition | null;
  uniques: KeyDefinition[];
  foreignKeys: ForeignKeyDefinition[];
  checks: CheckDefinition[];
  indexes: IndexDefinition[];
}
export interface SchemaSnapshot { tables: TableDefinition[] }

export interface OwnershipException {
  objectType: ObjectType;
  schema: string;
  table?: string;
  name: string;
  owner: string;
  mechanism: string;
  reason: string;
  temporary: boolean;
}

export interface Finding {
  category: DriftCategory;
  severity: Severity;
  objectType: ObjectType;
  objectPath: string;
  objectName: string;
  expected: unknown;
  actual: unknown;
  ownership: OwnershipException | null;
  semanticEquality: boolean;
  enforcementDirection: EnforcementDirection;
  decision: "MECHANICAL" | "NEEDS_DESIGN_DECISION";
  safety: string | null;
}

export interface AuditReport {
  formatVersion: 1;
  actionable: boolean;
  counts: Record<DriftCategory, number>;
  findings: Finding[];
}

export function normalizeSql(input: string | null | undefined): string | null {
  if (input == null || input.trim() === "") return null;
  let value = input
    .replace(/"/g, "")
    .replace(/\b(public\.)/gi, "")
    .replace(/\b[a-z_][a-z0-9_]*\./gi, "")
    .replace(/'([^']*)'\s*::\s*interval\b/gi, "interval '$1'")
    .replace(/::(?:character varying|timestamp with(?:out)? time zone|[a-z_][a-z0-9_]*(?:\[\])?)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*([=<>+\-*/])\s*/g, "$1")
    .trim()
    .toLowerCase();
  value = value
    .replace(/ not like /g, " !~~ ")
    .replace(/ like /g, " ~~ ")
    .replace(/(?<![a-z0-9_])\(([a-z_][a-z0-9_]*)\)(?=\s*(?:=|<>|>=|<=|>|<|~~|!~~|\bis\b))/g, "$1")
    .replace(
      /\b([a-z_][a-z0-9_]*(?:\([^()]*(?:\([^()]*\)[^()]*)*\))?) between\s*(-?\d+(?:\.\d+)?) and (-?\d+(?:\.\d+)?)/g,
      "$1>=$2 and $1<=$3",
    )
    .replace(/\b([a-z_][a-z0-9_]*) in \(([^()]+)\)/g, "$1=any (array[$2])");
  for (;;) {
    const unwrapped = value
      .replace(/\(([a-z_][a-z0-9_]*(?:[+\-*/][a-z_][a-z0-9_]*)+)\)/g, "$1")
      .replace(/\(([a-z_][a-z0-9_]*=any \(array\[[^\]]+\]\))\)/g, "$1");
    if (unwrapped === value) break;
    value = unwrapped;
  }
  // PostgreSQL's deparser omits parentheses around an AND-only term when
  // that term is an operand of OR. That grouping is redundant there. Do not
  // generalize this to every boolean group: `(a OR b) AND c` is meaningful
  // and must remain distinct from `a OR b AND c`.
  for (;;) {
    const unwrapped = removeRedundantOrGroups(value);
    if (unwrapped === value) break;
    value = unwrapped;
  }
  for (;;) {
    const unwrapped = value.replace(/\((-?\d+(?:\.\d+)?)\)/g, "$1");
    if (unwrapped === value) break;
    value = unwrapped;
  }
  while (value.startsWith("(") && value.endsWith(")")) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === "(") depth += 1;
      else if (value[i] === ")") depth -= 1;
      if (depth === 0 && i < value.length - 1) { wraps = false; break; }
    }
    if (!wraps) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

function removeRedundantOrGroups(value: string): string {
  const paired = value.replace(
    /\(([^()]*\band\b[^()]*)\)\s+or\s+\(([^()]*\band\b[^()]*)\)/g,
    "$1 or $2",
  );
  if (paired !== value) return paired;
  const pairs: Array<[number, number]> = [];
  const stack: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") stack.push(index);
    else if (value[index] === ")" && stack.length) {
      const start = stack.pop()!;
      pairs.push([start, index]);
    }
  }
  // Work from the innermost group outward, preserving nested function calls.
  pairs.sort((a, b) => b[0] - a[0]);
  for (const [start, end] of pairs) {
    const content = value.slice(start + 1, end);
    let depth = 0;
    let hasTopLevelAnd = false;
    let hasTopLevelOr = false;
    let hasTopLevelComparison = false;
    for (let index = 0; index < content.length; index += 1) {
      if (content[index] === "(") depth += 1;
      else if (content[index] === ")") depth -= 1;
      else if (depth === 0) {
        if (/\band\b/.test(content.slice(index, index + 4))) hasTopLevelAnd = true;
        if (/\bor\b/.test(content.slice(index, index + 3))) hasTopLevelOr = true;
        if (/^(?:=|<>|>=|<=|>|<|~~|!~~| is(?: not)?\b|->>)/.test(content.slice(index))) {
          hasTopLevelComparison = true;
        }
      }
    }
    if ((!hasTopLevelAnd && !hasTopLevelComparison) || hasTopLevelOr) continue;
    const before = value.slice(0, start).trimEnd();
    const after = value.slice(end + 1).trimStart();
    if (hasTopLevelAnd && !/\bor$/.test(before) && !/^or\b/.test(after)) continue;
    value = `${value.slice(0, start)}${content}${value.slice(end + 1)}`;
    return value;
  }
  return value;
}

export function normalizeSnapshot(snapshot: SchemaSnapshot): SchemaSnapshot {
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  return {
    tables: snapshot.tables.map((table) => ({
      ...table,
      columns: table.columns.map((column) => ({
        ...column,
        type: column.type.toLowerCase().replace("character varying", "varchar"),
        default: normalizeSql(column.default),
        generated: normalizeSql(column.generated),
      })).sort(byName),
      primaryKey: table.primaryKey && { ...table.primaryKey, columns: [...table.primaryKey.columns] },
      uniques: table.uniques.map((x) => ({ ...x, columns: [...x.columns] })).sort(byName),
      foreignKeys: table.foreignKeys.map((x) => ({
        ...x,
        onDelete: x.onDelete.toLowerCase(),
        onUpdate: x.onUpdate.toLowerCase(),
      })).sort(byName),
      checks: table.checks.map((x) => ({ ...x, expression: normalizeSql(x.expression)! })).sort(byName),
      indexes: table.indexes.map((x) => ({
        ...x,
        expressions: x.expressions.map((expression) => normalizeSql(expression)!),
        predicate: normalizeSql(x.predicate),
        method: x.method.toLowerCase(),
      })).sort(byName),
    })).sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`)),
  };
}