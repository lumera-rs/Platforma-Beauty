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
  position?: number;
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  generated: string | null;
  generatedMode?: string | null;
  identity?: string | null;
  collation?: string | null;
}
export interface BackingIndexDetails {
  indexMethod?: string | null;
  indexIncludeExpressions?: string[];
  indexKeyOptions?: number[];
  indexCollations?: string[];
  indexOpclasses?: string[];
  indexValid?: boolean;
  indexReady?: boolean;
}
export interface KeyDefinition extends BackingIndexDetails {
  name: string;
  columns: string[];
  nullsNotDistinct?: boolean;
  deferrable?: boolean;
  initiallyDeferred?: boolean;
  validated?: boolean;
}
export interface ForeignKeyDefinition extends KeyDefinition {
  foreignSchema: string;
  foreignTable: string;
  foreignColumns: string[];
  onDelete: string;
  onUpdate: string;
  matchType?: string;
  deleteSetColumns?: string[];
}
export interface CheckDefinition {
  name: string;
  expression: string;
  validated?: boolean;
  noInherit?: boolean;
}
export interface ExclusionDefinition extends BackingIndexDetails {
  name: string;
  definition: string;
  deferrable?: boolean;
  initiallyDeferred?: boolean;
  validated?: boolean;
}
export interface IndexDefinition {
  name: string;
  expressions: string[];
  unique: boolean;
  predicate: string | null;
  method: string;
  includeExpressions?: string[];
  keyOptions?: number[];
  collations?: string[];
  opclasses?: string[];
  nullsNotDistinct?: boolean;
  valid?: boolean;
  ready?: boolean;
}
export interface TableDefinition {
  schema: string;
  name: string;
  columns: ColumnDefinition[];
  primaryKey: KeyDefinition | null;
  uniques: KeyDefinition[];
  foreignKeys: ForeignKeyDefinition[];
  checks: CheckDefinition[];
  exclusions?: ExclusionDefinition[];
  indexes: IndexDefinition[];
}
export interface SchemaSnapshot { tables: TableDefinition[] }
export const SUPPORTED_POSTGRES_MAJOR_VERSIONS = [16] as const;
export const POSTGRES_DEPARSE_FORMAT = "postgresql-16-deparser-v1" as const;
export interface PostgresFingerprintCompatibility {
  serverVersionNum: number;
  serverMajorVersion: number;
  deparserFormat: typeof POSTGRES_DEPARSE_FORMAT;
}

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

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface SqlNormalizationContext {
  schema: string;
  table: string;
  columns: string[];
}
interface SqlNormalizationOptions {
  preserveQuotedIdentifiers?: boolean;
}

export function normalizeSql(
  input: string | null | undefined,
  context?: SqlNormalizationContext,
  options: SqlNormalizationOptions = { preserveQuotedIdentifiers: true },
): string | null {
  if (input == null || input.trim() === "") return null;
  const protectedTokens: string[] = [];
  const protect = (token: string): string => {
    const index = protectedTokens.push(token) - 1;
    return `\uE000${index}\uE001`;
  };
  let value = protectSqlLexicalTokens(input, protect, options).toLowerCase();
  if (context) {
    const schema = escapeRegex(context.schema.toLowerCase());
    const table = escapeRegex(context.table.toLowerCase());
    for (const columnName of context.columns) {
      const column = escapeRegex(columnName.toLowerCase());
      value = value.replace(
        new RegExp(`\\b(?:${schema}\\.)?${table}\\.${column}(?![a-z0-9_]|\\s*\\()`, "g"),
        columnName.toLowerCase(),
      );
    }
  }
  value = value
    .replace(/(\uE000\d+\uE001)\s*::\s*interval\b/gi, "interval $1")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*([=<>+\-*/])\s*/g, "$1")
    .trim();
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
      .replace(/\(([a-z_][a-z0-9_]*=any \(array\[[^\]]+\]\))\)/g, "$1");
    if (unwrapped === value) break;
    value = unwrapped;
  }
  // PostgreSQL's deparser omits parentheses around an AND-only term when
  // that term is an operand of OR. That grouping is redundant there. Do not
  // generalize this to every boolean group: `(a OR b) AND c` is meaningful
  // and must remain distinct from `a OR b AND c`.
  for (;;) {
    const unwrapped = value.replace(
      /(^|<=|>=|<>|=|<|>|\+|-|\*|\/|,)\((-?\d+(?:\.\d+)?)\)/g,
      "$1$2",
    );
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
  return value.replace(/\uE000(\d+)\uE001/g, (_match, index: string) =>
    protectedTokens[Number(index)]!);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectSqlLexicalTokens(
  input: string,
  protect: (token: string) => string,
  options: SqlNormalizationOptions,
): string {
  let output = "";
  for (let index = 0; index < input.length;) {
    const character = input[index]!;
    if (character === "'") {
      const start = index;
      const escapeBackslashes = index > 0
        && /[eE]/.test(input[index - 1]!)
        && (index < 2 || !/[a-z0-9_$]/i.test(input[index - 2]!));
      index += 1;
      let closed = false;
      while (index < input.length) {
        if (escapeBackslashes && input[index] === "\\") {
          index += Math.min(2, input.length - index);
        } else if (input[index] === "'" && input[index + 1] === "'") {
          index += 2;
        } else if (input[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) throw new Error("Unterminated SQL string literal");
      output += protect(input.slice(start, index));
      continue;
    }
    if (character === '"') {
      const start = index;
      index += 1;
      let closed = false;
      while (index < input.length) {
        if (input[index] === '"' && input[index + 1] === '"') {
          index += 2;
        } else if (input[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) throw new Error("Unterminated SQL quoted identifier");
      const identifier = input.slice(start, index);
      const decoded = identifier.slice(1, -1).replace(/""/g, '"');
      output += options.preserveQuotedIdentifiers === false
        && /^[a-z_][a-z0-9_]*$/.test(decoded)
        ? decoded
        : protect(identifier);
      continue;
    }
    if (character === "$") {
      const delimiter = input.slice(index).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i)?.[0];
      if (delimiter) {
        const end = input.indexOf(delimiter, index + delimiter.length);
        if (end < 0) throw new Error("Unterminated SQL dollar-quoted literal");
        const next = end + delimiter.length;
        output += protect(input.slice(index, next));
        index = next;
        continue;
      }
    }
    output += character;
    index += 1;
  }
  return output;
}

function normalizeType(input: string): string {
  const quotedIdentifiers: string[] = [];
  const value = input
    .replace(/"(?:[^"]|"")*"/g, (identifier) => {
      const index = quotedIdentifiers.push(identifier) - 1;
      return `\uE000${index}\uE001`;
    })
    .toLowerCase()
    .replace(/\bcharacter varying\b/g, "varchar");
  return value.replace(/\uE000(\d+)\uE001/g, (_match, index: string) =>
    quotedIdentifiers[Number(index)]!);
}

function normalizedBackingIndex(
  value: BackingIndexDetails,
  context: SqlNormalizationContext,
  options: SqlNormalizationOptions,
): Required<BackingIndexDetails> {
  return {
    indexMethod: value.indexMethod?.toLowerCase() ?? null,
    indexIncludeExpressions: (value.indexIncludeExpressions ?? [])
      .map((expression) => normalizeSql(expression, context, options)!),
    indexKeyOptions: [...(value.indexKeyOptions ?? [])],
    indexCollations: [...(value.indexCollations ?? [])],
    indexOpclasses: [...(value.indexOpclasses ?? [])],
    indexValid: value.indexValid ?? true,
    indexReady: value.indexReady ?? true,
  };
}

export function normalizeSnapshot(
  snapshot: SchemaSnapshot,
  options: SqlNormalizationOptions = { preserveQuotedIdentifiers: true },
): SchemaSnapshot {
  const byName = <T extends { name: string }>(a: T, b: T) => compareCodeUnits(a.name, b.name);
  return {
    tables: snapshot.tables.map((table) => {
      const context = {
        schema: table.schema,
        table: table.name,
        columns: table.columns.map((column) => column.name),
      };
      return {
        ...table,
        columns: table.columns.map((column, inputIndex) => ({
        ...column,
        position: column.position ?? inputIndex + 1,
        type: normalizeType(column.type),
        default: normalizeSql(column.default, context, options),
        generated: normalizeSql(column.generated, context, options),
        generatedMode: column.generatedMode?.toLowerCase() ?? null,
        identity: column.identity?.toLowerCase() ?? null,
        collation: column.collation ?? null,
      })).sort((a, b) => a.position - b.position || compareCodeUnits(a.name, b.name))
        .map((column, position) => ({ ...column, position: position + 1 })),
      primaryKey: table.primaryKey && {
        ...table.primaryKey,
        ...normalizedBackingIndex(table.primaryKey, context, options),
        columns: [...table.primaryKey.columns],
        nullsNotDistinct: table.primaryKey.nullsNotDistinct ?? false,
        deferrable: table.primaryKey.deferrable ?? false,
        initiallyDeferred: table.primaryKey.initiallyDeferred ?? false,
        validated: table.primaryKey.validated ?? true,
      },
      uniques: table.uniques.map((x) => ({
        ...x,
        ...normalizedBackingIndex(x, context, options),
        columns: [...x.columns],
        nullsNotDistinct: x.nullsNotDistinct ?? false,
        deferrable: x.deferrable ?? false,
        initiallyDeferred: x.initiallyDeferred ?? false,
        validated: x.validated ?? true,
      })).sort(byName),
      foreignKeys: table.foreignKeys.map((x) => ({
        ...x,
        onDelete: x.onDelete.toLowerCase(),
        onUpdate: x.onUpdate.toLowerCase(),
        matchType: (x.matchType ?? "simple").toLowerCase(),
        deleteSetColumns: [...(x.deleteSetColumns ?? [])].sort(compareCodeUnits),
        deferrable: x.deferrable ?? false,
        initiallyDeferred: x.initiallyDeferred ?? false,
        validated: x.validated ?? true,
      })).sort(byName),
      checks: table.checks.map((x) => ({
        ...x,
        expression: normalizeSql(x.expression, context, options)!,
        validated: x.validated ?? true,
        noInherit: x.noInherit ?? false,
      })).sort(byName),
      exclusions: (table.exclusions ?? []).map((x) => ({
        ...x,
        ...normalizedBackingIndex(x, context, options),
        definition: normalizeSql(x.definition, context, options)!,
        deferrable: x.deferrable ?? false,
        initiallyDeferred: x.initiallyDeferred ?? false,
        validated: x.validated ?? true,
      })).sort(byName),
      indexes: table.indexes.map((x) => ({
        ...x,
        expressions: x.expressions.map((expression) => normalizeSql(expression, context, options)!),
        includeExpressions: (x.includeExpressions ?? [])
          .map((expression) => normalizeSql(expression, context, options)!),
        keyOptions: [...(x.keyOptions ?? [])],
        collations: [...(x.collations ?? [])],
        opclasses: [...(x.opclasses ?? [])],
        predicate: normalizeSql(x.predicate, context, options),
        method: x.method.toLowerCase(),
        nullsNotDistinct: x.nullsNotDistinct ?? false,
        valid: x.valid ?? true,
        ready: x.ready ?? true,
      })).sort(byName),
      };
    }).sort((a, b) => compareCodeUnits(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`)),
  };
}