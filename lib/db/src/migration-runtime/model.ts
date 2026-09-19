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
export interface EnumDefinition {
  schema: string;
  name: string;
  labels: string[];
}
export interface TriggerDefinition {
  tableSchema: string;
  tableName: string;
  name: string;
  enabled: string;
  timing: string;
  events: string[];
  updateColumns: string[];
  level: string;
  when: string | null;
  constraint: boolean;
  deferrable: boolean;
  initiallyDeferred: boolean;
  oldTransitionTable: string | null;
  newTransitionTable: string | null;
  functionSchema: string;
  functionName: string;
  argumentsBase64: string;
  definition: string;
  functionDefinition: string;
}
export interface FunctionDefinition {
  schema: string;
  name: string;
  kind: string;
  identityArguments: string;
  arguments: string;
  returnType: string;
  returnSet: boolean;
  language: string;
  volatility: string;
  parallel: string;
  strict: boolean;
  leakproof: boolean;
  securityDefiner: boolean;
  cost: number;
  rows: number;
  configuration: string[];
  definition: string;
}
export interface PolicyCensusEntry {
  schema: string;
  table: string;
  name: string;
  command: string;
  permissive: boolean;
  roles: string[];
  using: string | null;
  check: string | null;
}
export interface UnmodelledObjectCensus {
  views: Array<{ schema: string; name: string }>;
  materializedViews: Array<{ schema: string; name: string }>;
  foreignTables: Array<{ schema: string; name: string; server: string }>;
  sequences: Array<{ schema: string; name: string }>;
  applicationSchemas: string[];
  rlsTables: Array<{ schema: string; table: string; enabled: boolean; forced: boolean }>;
  policies: PolicyCensusEntry[];
  extensions: Array<{ name: string; schema: string; version: string }>;
}
export interface SchemaSnapshot {
  tables: TableDefinition[];
  enums?: EnumDefinition[];
  triggers?: TriggerDefinition[];
  functions?: FunctionDefinition[];
  unmodelled?: UnmodelledObjectCensus;
}
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
  columnTypes?: Map<string, string>;
}
interface SqlNormalizationOptions {
  preserveQuotedIdentifiers?: boolean;
  stripCasts?: boolean;
  auditCastTargetType?: string;
}

export function normalizeSql(
  input: string | null | undefined,
  context?: SqlNormalizationContext,
  options: SqlNormalizationOptions = { preserveQuotedIdentifiers: true },
): string | null {
  if (input == null || input.trim() === "") return null;
  const protectedTokens: string[] = [];
  const stringLiteralTokenIndexes = new Set<number>();
  const protect = (
    token: string,
    kind: "string" | "identifier" | "dollar",
  ): string => {
    const index = protectedTokens.push(token) - 1;
    if (kind === "string") stringLiteralTokenIndexes.add(index);
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
  value = value.replace(/(\uE000\d+\uE001)\s*::\s*interval\b/gi, "interval $1");
  if (options.stripCasts) {
    // Legacy audit compatibility only. Fingerprints use the default strict
    // path and therefore retain execution-relevant casts. Only literal casts
    // emitted by PostgreSQL's deparser are tolerated; casts on columns,
    // function results, and compound expressions remain semantic.
    value = stripAuditLiteralCasts(
      value,
      protectedTokens,
      stringLiteralTokenIndexes,
      context,
      options.auditCastTargetType,
    );
  }
  value = value
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
  if (options.stripCasts) value = normalizeAuditExpressionGrouping(value);
  return value.replace(/\uE000(\d+)\uE001/g, (_match, index: string) =>
    protectedTokens[Number(index)]!);
}

function stripAuditLiteralCasts(
  value: string,
  protectedTokens: string[],
  stringLiteralTokenIndexes: Set<number>,
  context?: SqlNormalizationContext,
  targetType?: string,
): string {
  const token = "\uE000(\\d+)\uE001";
  const anyToken = "\uE000\\d+\uE001";
  const identifier = `(?:${anyToken}|[a-z_][a-z0-9_$]*)`;
  const qualifiedIdentifier = `${identifier}(?:\\s*\\.\\s*${identifier})?`;
  const multiWordType = [
    "timestamp\\s+(?:with|without)\\s+time\\s+zone",
    "time\\s+(?:with|without)\\s+time\\s+zone",
    "double\\s+precision",
    "national\\s+character\\s+varying",
    "character\\s+varying",
    "bit\\s+varying",
  ].join("|");
  const type = `(?:${multiWordType}|${qualifiedIdentifier})`;
  const cast = new RegExp(
    `(${token})\\s*::\\s*(${type})`
      + "(?![a-z0-9_$]|\\s*\\(|\\s*\\[|\\s+(?:with|without|precision|varying|zone)\\b)",
    "gi",
  );
  return value.replace(
    cast,
    (match, literalToken: string, tokenIndex: string, castType: string, offset: number) => {
      const index = Number(tokenIndex);
      if (!stringLiteralTokenIndexes.has(index)) return match;
      const normalizedCastType = normalizeAuditTypeIdentity(castType, protectedTokens);
      const start = offset;
      const end = start + match.length;
      if (isWholeTypedDefault(value, start, end, normalizedCastType, targetType)
        || isTypedComparisonLiteral(value, start, end, normalizedCastType, context)
        || isTypedAnyArrayLiteral(value, start, end, normalizedCastType, context)
        || isContextuallyRedundantTextLiteralCast(
          value,
          start,
          end,
          normalizedCastType,
          context,
        )) {
        return literalToken;
      }
      return match;
    },
  );
}

type AuditBooleanNode =
  | { kind: "atom"; value: string }
  | { kind: "and" | "or"; children: AuditBooleanNode[] };

function normalizeAuditExpressionGrouping(value: string): string {
  return serializeAuditBoolean(parseAuditBoolean(value));
}

function isSafeScalarComparatorOperand(value: string): boolean {
  const unwrapped = unwrapCompleteParentheses(value.trim());
  return unwrapped !== ""
    && !/[,[\]]/.test(value)
    && !/\b(?:and|or|not|between|in|case|when|then|else|end)\b/i.test(value)
    && findTopLevelComparator(unwrapped) === null;
}

function parseAuditBoolean(value: string): AuditBooleanNode {
  const unwrapped = unwrapCompleteParentheses(value.trim());
  const orParts = splitTopLevelBoolean(unwrapped, "or");
  if (orParts.length > 1) {
    return {
      kind: "or",
      children: orParts.flatMap((part) => {
        const child = parseAuditBoolean(part);
        return child.kind === "or" ? child.children : [child];
      }),
    };
  }
  const andParts = splitTopLevelBoolean(unwrapped, "and");
  if (andParts.length > 1) {
    return {
      kind: "and",
      children: andParts.flatMap((part) => {
        const child = parseAuditBoolean(part);
        return child.kind === "and" ? child.children : [child];
      }),
    };
  }
  return { kind: "atom", value: normalizeComparatorOperandGrouping(unwrapped) };
}

function normalizeComparatorOperandGrouping(value: string): string {
  const comparator = findTopLevelComparator(value);
  if (!comparator) return value;
  const left = value.slice(0, comparator.start).trim();
  const right = value.slice(comparator.end).trim();
  const normalizedLeft = isSafeScalarComparatorOperand(left)
    ? unwrapCompleteParentheses(left)
    : left;
  const normalizedRight = isSafeScalarComparatorOperand(right)
    ? unwrapCompleteParentheses(right)
    : right;
  return `${normalizedLeft}${comparator.operator}${normalizedRight}`;
}

function findTopLevelComparator(
  value: string,
): { start: number; end: number; operator: string } | null {
  let depth = 0;
  let caseDepth = 0;
  for (let index = 0; index < value.length;) {
    const character = value[index]!;
    if (character === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      index += 1;
      continue;
    }
    const word = value.slice(index).match(/^[a-z_][a-z0-9_$]*/i);
    if (word) {
      const token = word[0]!.toLowerCase();
      const end = index + word[0]!.length;
      if (depth === 0) {
        if (token === "case") caseDepth += 1;
        else if (token === "end" && caseDepth > 0) caseDepth -= 1;
        else if (caseDepth === 0 && token === "is") {
          return { start: index, end, operator: " is " };
        }
      }
      index = end;
      continue;
    }
    if (depth === 0 && caseDepth === 0 && /[=<>]/.test(character)) {
      if (character === ">" && (
        value[index - 1] === "-"
        || value[index - 1] === "#"
        || (value[index - 1] === ">"
          && (value[index - 2] === "-" || value[index - 2] === "#"))
      )) {
        index += 1;
        continue;
      }
      const pair = value.slice(index, index + 2);
      const operator = ["<=", ">=", "<>"].includes(pair) ? pair : character;
      return { start: index, end: index + operator.length, operator };
    }
    index += 1;
  }
  return null;
}

function normalizeAuditTypeIdentity(
  value: string,
  protectedTokens: string[],
): string {
  return normalizeType(
    value.replace(/\uE000(\d+)\uE001/g, (_match, index: string) =>
      protectedTokens[Number(index)]!),
  ).replace(/^pg_catalog\./, "");
}

function auditTypesEquivalent(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const normalizedLeft = normalizeType(left).replace(/^pg_catalog\./, "");
  if (normalizedLeft === right) return true;
  const textTypes = new Set(["text", "varchar"]);
  return textTypes.has(normalizedLeft) && textTypes.has(right);
}

function isWholeTypedDefault(
  value: string,
  start: number,
  end: number,
  castType: string,
  targetType: string | undefined,
): boolean {
  return value.slice(0, start).trim() === ""
    && value.slice(end).trim() === ""
    && auditTypesEquivalent(targetType, castType);
}

function isTypedComparisonLiteral(
  value: string,
  start: number,
  end: number,
  castType: string,
  context: SqlNormalizationContext | undefined,
): boolean {
  if (!context?.columnTypes) return false;
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  const leftMatch = prefix.match(
    /([a-z_][a-z0-9_$]*)\s*(?:=|<>|<=|>=|<|>|~|!~|~~|!~~)\s*$/i,
  );
  const left = leftMatch?.index !== undefined
    && isDirectOperandStartBoundary(prefix.slice(0, leftMatch.index))
    ? leftMatch[1]!.toLowerCase()
    : undefined;
  if (left && isComparisonOperandBoundary(suffix)
    && auditTypesEquivalent(context.columnTypes.get(left), castType)) {
    return true;
  }
  const comparator = findTopLevelComparator(prefix);
  if (castType === "text" && comparator
    && prefix.slice(comparator.end).trim() === ""
    && isComparisonOperandBoundary(suffix)
    && isKnownTextExpression(
      prefix.slice(0, comparator.start),
      context,
    )) {
    return true;
  }
  if (castType === "text"
    && /jsonb_typeof\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*=\s*$/i.test(prefix)
    && isComparisonOperandBoundary(suffix)) {
    return true;
  }
  return false;
}

function isComparisonOperandBoundary(value: string): boolean {
  return /^(?:\s*\))*\s*(?:(?:and|or|then)\b|$)/i.test(value);
}

function isTypedAnyArrayLiteral(
  value: string,
  start: number,
  end: number,
  castType: string,
  context: SqlNormalizationContext | undefined,
): boolean {
  if (!context?.columnTypes) return false;
  const prefix = value.slice(0, start);
  const array = findLastArrayConstructor(prefix);
  if (!array || !isWholeTopLevelArrayElement(value, array.open, start, end)) {
    return false;
  }
  const comparisonPrefix = prefix.slice(0, array.start);
  const columnMatch = comparisonPrefix.match(
    /([a-z_][a-z0-9_$]*)\s*=\s*any\s*\(\s*$/i,
  );
  const column = columnMatch?.index !== undefined
    && isDirectOperandStartBoundary(
      comparisonPrefix.slice(0, columnMatch.index),
    )
    ? columnMatch[1]!.toLowerCase()
    : undefined;
  return column !== undefined
    && auditTypesEquivalent(context.columnTypes.get(column), castType);
}

function isDirectOperandStartBoundary(value: string): boolean {
  return /(?:^|\b(?:and|or|when|then|not)\s*|[,(]\s*)$/i.test(value);
}

function findLastArrayConstructor(
  value: string,
): { start: number; open: number } | null {
  const pattern = /\barray\s*\[/gi;
  let result: { start: number; open: number } | null = null;
  for (const match of value.matchAll(pattern)) {
    result = {
      start: match.index,
      open: match.index + match[0].lastIndexOf("["),
    };
  }
  return result;
}

function isWholeTopLevelArrayElement(
  value: string,
  arrayOpen: number,
  start: number,
  end: number,
): boolean {
  let parentheses = 0;
  let brackets = 0;
  let elementStart = arrayOpen + 1;
  for (let index = arrayOpen + 1; index < start; index += 1) {
    const character = value[index]!;
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "," && parentheses === 0 && brackets === 0) {
      elementStart = index + 1;
    }
  }
  if (parentheses !== 0 || brackets !== 0
    || value.slice(elementStart, start).trim() !== "") return false;

  parentheses = 0;
  brackets = 0;
  for (let index = end; index < value.length; index += 1) {
    const character = value[index]!;
    if ((character === "," || character === "]")
      && parentheses === 0 && brackets === 0) {
      return value.slice(end, index).trim() === "";
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
  }
  return false;
}

function isContextuallyRedundantTextLiteralCast(
  value: string,
  start: number,
  end: number,
  castType: string,
  context: SqlNormalizationContext | undefined,
): boolean {
  if (castType !== "text") return false;
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  if (/->>\s*$/i.test(prefix) && isJsonTextKeyBoundary(suffix)) return true;

  const call = findInnermostFunctionArgument(value, start);
  if (call && call.arguments[call.argumentIndex]?.trim()
    === value.slice(start, end).trim()) {
    const fixedTextArguments: Record<string, Set<number>> = {
      regexp_replace: new Set([0, 1, 2, 3]),
      replace: new Set([0, 1, 2]),
    };
    if (fixedTextArguments[call.name]?.has(call.argumentIndex)) return true;
    if ((call.name === "coalesce" || call.name === "nullif")
      && call.arguments.some((argument, index) =>
        index !== call.argumentIndex && isKnownTextExpression(argument, context))) {
      return true;
    }
  }

  const leftOperator = prefix.match(/(?:!~~|~~|!~|~|\|\|)\s*$/);
  if (leftOperator && isComparisonOperandBoundary(suffix)) {
    const operatorStart = prefix.length - leftOperator[0].length;
    const leftOperand = immediateLeftOperand(prefix, operatorStart);
    if (leftOperand && isKnownTextExpression(leftOperand, context)) return true;
  }
  const rightConcat = suffix.match(/^\s*\|\|/);
  if (!rightConcat || !isTextOperandStartBoundary(prefix)) return false;
  const rightOperand = immediateRightOperand(
    value,
    end + rightConcat[0].length,
  );
  return rightOperand !== null
    && isKnownTextExpression(rightOperand, context);
}

function isJsonTextKeyBoundary(value: string): boolean {
  return /^\s*(?:\)*\s*)*(?:(?:is|and|or)\b|(?:=|<>|<=|>=|<|>)|$)/i.test(value);
}

function isTextOperandStartBoundary(value: string): boolean {
  return /(?:^|\bthen\s*|\belse\s*|[,(]\s*)$/i.test(value);
}

function immediateLeftOperand(value: string, before: number): string | null {
  let end = before;
  while (end > 0 && /\s/.test(value[end - 1]!)) end -= 1;
  if (end === 0) return null;
  if (value[end - 1] !== ")") {
    return value.slice(0, end).match(/([a-z_][a-z0-9_$]*)$/i)?.[1] ?? null;
  }
  let depth = 0;
  let open = -1;
  for (let index = end - 1; index >= 0; index -= 1) {
    if (value[index] === ")") depth += 1;
    else if (value[index] === "(") {
      depth -= 1;
      if (depth === 0) {
        open = index;
        break;
      }
    }
  }
  if (open < 0) return null;
  const identifier = String.raw`(?:[a-z_][a-z0-9_$]*|\uE002\d+\uE003)`;
  const qualifiedName = new RegExp(
    String.raw`((?:${identifier}\s*\.\s*)*${identifier})\s*$`,
    "i",
  );
  const name = value.slice(0, open).match(qualifiedName);
  if (!name || name.index === undefined) return null;
  return value.slice(name.index, end).trim();
}

function immediateRightOperand(value: string, after: number): string | null {
  let start = after;
  while (start < value.length && /\s/.test(value[start]!)) start += 1;
  if (start === value.length) return null;
  let parentheses = 0;
  let brackets = 0;
  for (let index = start; index < value.length;) {
    const character = value[index]!;
    if (character === "(") {
      parentheses += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      if (parentheses === 0 && brackets === 0) {
        return value.slice(start, index).trim() || null;
      }
      parentheses -= 1;
      index += 1;
      continue;
    }
    if (character === "[") {
      brackets += 1;
      index += 1;
      continue;
    }
    if (character === "]") {
      if (brackets === 0 && parentheses === 0) {
        return value.slice(start, index).trim() || null;
      }
      brackets -= 1;
      index += 1;
      continue;
    }
    if (parentheses === 0 && brackets === 0) {
      if (character === "," || /[=<>]/.test(character)) {
        return value.slice(start, index).trim() || null;
      }
      const word = value.slice(index).match(/^[a-z_][a-z0-9_$]*/i);
      if (word) {
        const token = word[0]!.toLowerCase();
        if (["and", "or", "then", "else", "when", "end"].includes(token)) {
          return value.slice(start, index).trim() || null;
        }
        index += word[0]!.length;
        continue;
      }
    }
    index += 1;
  }
  return value.slice(start).trim() || null;
}

function findInnermostFunctionArgument(
  value: string,
  position: number,
): { name: string; argumentIndex: number; arguments: string[] } | null {
  const stack: number[] = [];
  for (let index = 0; index < position; index += 1) {
    if (value[index] === "(") stack.push(index);
    else if (value[index] === ")") stack.pop();
  }
  const open = stack.at(-1);
  if (open === undefined) return null;
  const nameMatch = value.slice(0, open).match(/([a-z_][a-z0-9_$]*)\s*$/i);
  if (!nameMatch || nameMatch.index === undefined) return null;
  const nameStart = open - nameMatch[0].length;
  if (value.slice(0, nameStart).trimEnd().endsWith(".")) return null;
  const name = nameMatch[1]!.toLowerCase();

  let depth = 1;
  let close = -1;
  for (let index = open + 1; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0 || position >= close) return null;

  const arguments_: string[] = [];
  let argumentStart = open + 1;
  let argumentIndex = 0;
  depth = 0;
  for (let index = open + 1; index < close; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      arguments_.push(value.slice(argumentStart, index).trim());
      if (position > index) argumentIndex += 1;
      argumentStart = index + 1;
    }
  }
  arguments_.push(value.slice(argumentStart, close).trim());
  return { name, argumentIndex, arguments: arguments_ };
}

function isKnownTextExpression(
  value: string,
  context: SqlNormalizationContext | undefined,
): boolean {
  const expression = value.trim();
  if (/^[a-z_][a-z0-9_$]*\s*::\s*(?:pg_catalog\.)?text$/i.test(expression)) {
    return true;
  }
  if (/^\uE000\d+\uE001\s*::\s*(?:pg_catalog\.)?text$/i.test(expression)) {
    return true;
  }
  const call = parseCompleteFunctionCall(expression);
  if (call && new Set(["regexp_replace", "replace", "jsonb_typeof"])
    .has(call.name)) return true;
  if (call && new Set(["lower", "upper", "btrim", "ltrim", "rtrim"])
    .has(call.name)
    && call.arguments[0] !== undefined
    && isKnownTextExpression(call.arguments[0], context)) return true;
  if (call && (call.name === "substring" || call.name === "substr")) {
    const source = substringSourceExpression(call.arguments);
    if (source && isKnownTextExpression(source, context)) return true;
  }
  const concatenated = splitTopLevelOperator(expression, "||");
  if (concatenated.length > 1
    && concatenated.every((part) => isKnownTextExpression(part, context))) {
    return true;
  }
  const caseResults = parseCompleteCaseResults(expression);
  if (caseResults && caseResults.every((part) =>
    isKnownTextExpression(part, context))) return true;
  if (!context?.columnTypes) return false;
  const identifier = expression.match(/^[a-z_][a-z0-9_$]*$/i)?.[0]?.toLowerCase();
  return identifier !== undefined
    && auditTypesEquivalent(context.columnTypes.get(identifier), "text");
}

function substringSourceExpression(arguments_: string[]): string | null {
  if (arguments_.length > 1) return arguments_[0] ?? null;
  const argument = arguments_[0];
  if (!argument) return null;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < argument.length;) {
    if (argument[index] === "(") {
      parentheses += 1;
      index += 1;
      continue;
    }
    if (argument[index] === ")") {
      parentheses -= 1;
      index += 1;
      continue;
    }
    if (argument[index] === "[") {
      brackets += 1;
      index += 1;
      continue;
    }
    if (argument[index] === "]") {
      brackets -= 1;
      index += 1;
      continue;
    }
    const word = argument.slice(index).match(/^[a-z_][a-z0-9_$]*/i);
    if (word) {
      const token = word[0]!.toLowerCase();
      if (parentheses === 0 && brackets === 0
        && (token === "from" || token === "for")) {
        return argument.slice(0, index).trim() || null;
      }
      index += word[0]!.length;
      continue;
    }
    index += 1;
  }
  return argument;
}

function parseCompleteFunctionCall(
  value: string,
): { name: string; arguments: string[] } | null {
  const opening = value.match(/^([a-z_][a-z0-9_$]*)\s*\(/i);
  if (!opening) return null;
  const open = opening[0].lastIndexOf("(");
  let depth = 0;
  let close = -1;
  for (let index = open; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close !== value.length - 1) return null;
  return {
    name: opening[1]!.toLowerCase(),
    arguments: splitTopLevelCommaList(value.slice(open + 1, close)),
  };
}

function splitTopLevelCommaList(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "," && parentheses === 0 && brackets === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function splitTopLevelOperator(value: string, operator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index <= value.length - operator.length; index += 1) {
    const character = value[index]!;
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (parentheses === 0 && brackets === 0
      && value.slice(index, index + operator.length) === operator) {
      parts.push(value.slice(start, index).trim());
      start = index + operator.length;
      index += operator.length - 1;
    }
  }
  if (parts.length === 0) return [value];
  parts.push(value.slice(start).trim());
  return parts;
}

function parseCompleteCaseResults(value: string): string[] | null {
  if (!/^case\b/i.test(value) || !/\bend$/i.test(value)) return null;
  const results: string[] = [];
  let parentheses = 0;
  let caseDepth = 0;
  let resultStart: number | null = null;
  for (let index = 0; index < value.length;) {
    if (value[index] === "(") {
      parentheses += 1;
      index += 1;
      continue;
    }
    if (value[index] === ")") {
      parentheses -= 1;
      index += 1;
      continue;
    }
    const word = value.slice(index).match(/^[a-z_][a-z0-9_$]*/i);
    if (!word) {
      index += 1;
      continue;
    }
    const token = word[0]!.toLowerCase();
    const end = index + word[0]!.length;
    if (parentheses === 0) {
      if (token === "case") caseDepth += 1;
      else if (token === "end") {
        if (caseDepth === 1 && resultStart !== null) {
          results.push(value.slice(resultStart, index).trim());
          resultStart = null;
        }
        caseDepth -= 1;
      } else if (caseDepth === 1 && token === "then") {
        resultStart = end;
      } else if (caseDepth === 1 && (token === "when" || token === "else")) {
        if (resultStart !== null) {
          results.push(value.slice(resultStart, index).trim());
          resultStart = null;
        }
        if (token === "else") resultStart = end;
      }
    }
    index = end;
  }
  return caseDepth === 0 && results.length >= 2 ? results : null;
}

function serializeAuditBoolean(
  node: AuditBooleanNode,
  parentPrecedence = 0,
): string {
  if (node.kind === "atom") return node.value;
  const precedence = node.kind === "or" ? 1 : 2;
  const serialized = node.children
    .map((child) => serializeAuditBoolean(child, precedence))
    .join(` ${node.kind} `);
  return precedence < parentPrecedence ? `(${serialized})` : serialized;
}

function unwrapCompleteParentheses(value: string): string {
  let result = value;
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let wraps = true;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === "(") depth += 1;
      else if (result[index] === ")") depth -= 1;
      if (depth < 0 || (depth === 0 && index < result.length - 1)) {
        wraps = false;
        break;
      }
    }
    if (!wraps || depth !== 0) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function splitTopLevelBoolean(
  value: string,
  operator: "and" | "or",
): string[] {
  const boundaries: Array<[number, number]> = [];
  let depth = 0;
  let caseDepth = 0;
  let betweenPending = false;
  for (let index = 0; index < value.length;) {
    if (value[index] === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (value[index] === ")") {
      depth -= 1;
      index += 1;
      continue;
    }
    const word = value.slice(index).match(/^[a-z_][a-z0-9_$]*/i);
    if (!word) {
      index += 1;
      continue;
    }
    const token = word[0]!.toLowerCase();
    const end = index + word[0]!.length;
    if (depth === 0) {
      if (token === "case") caseDepth += 1;
      else if (token === "end" && caseDepth > 0) caseDepth -= 1;
      else if (caseDepth === 0 && token === "between") betweenPending = true;
      else if (caseDepth === 0 && token === "and" && betweenPending) {
        betweenPending = false;
      } else if (caseDepth === 0 && token === operator) {
        boundaries.push([index, end]);
      }
    }
    index = end;
  }
  if (boundaries.length === 0) return [value];
  const parts: string[] = [];
  let start = 0;
  for (const [boundaryStart, boundaryEnd] of boundaries) {
    parts.push(value.slice(start, boundaryStart).trim());
    start = boundaryEnd;
  }
  parts.push(value.slice(start).trim());
  return parts.some((part) => part === "") ? [value] : parts;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectSqlLexicalTokens(
  input: string,
  protect: (
    token: string,
    kind: "string" | "identifier" | "dollar",
  ) => string,
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
      output += protect(input.slice(start, index), "string");
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
        : protect(identifier, "identifier");
      continue;
    }
    if (character === "$") {
      const delimiter = input.slice(index).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i)?.[0];
      if (delimiter) {
        const end = input.indexOf(delimiter, index + delimiter.length);
        if (end < 0) throw new Error("Unterminated SQL dollar-quoted literal");
        const next = end + delimiter.length;
        output += protect(input.slice(index, next), "dollar");
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
        columnTypes: new Map(table.columns.map((column) =>
          [column.name.toLowerCase(), normalizeType(column.type)])),
      };
      return {
        ...table,
        columns: table.columns.map((column, inputIndex) => ({
        ...column,
        position: column.position ?? inputIndex + 1,
        type: normalizeType(column.type),
        default: normalizeSql(
          column.default,
          context,
          options.stripCasts
            ? { ...options, auditCastTargetType: normalizeType(column.type) }
            : options,
        ),
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
    enums: (snapshot.enums ?? []).map((value) => ({
      schema: value.schema,
      name: value.name,
      labels: [...value.labels],
    })).sort((a, b) => compareCodeUnits(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`)),
    triggers: (snapshot.triggers ?? []).map((value) => ({
      ...value,
      enabled: value.enabled.toLowerCase(),
      timing: value.timing.toLowerCase(),
      events: [...value.events].map((event) => event.toLowerCase()).sort(compareCodeUnits),
      updateColumns: [...value.updateColumns],
      level: value.level.toLowerCase(),
      when: normalizeSql(value.when, undefined, options),
      definition: normalizeSql(value.definition, undefined, options)!,
      functionDefinition: normalizeSql(value.functionDefinition, undefined, options)!,
    })).sort((a, b) => compareCodeUnits(
      `${a.tableSchema}.${a.tableName}.${a.name}`,
      `${b.tableSchema}.${b.tableName}.${b.name}`,
    )),
    functions: (snapshot.functions ?? []).map((value) => ({
      ...value,
      kind: value.kind.toLowerCase(),
      identityArguments: normalizeSql(value.identityArguments, undefined, options) ?? "",
      arguments: normalizeSql(value.arguments, undefined, options) ?? "",
      returnType: normalizeSql(value.returnType, undefined, options) ?? "",
      language: value.language.toLowerCase(),
      volatility: value.volatility.toLowerCase(),
      parallel: value.parallel.toLowerCase(),
      configuration: [...value.configuration].sort(compareCodeUnits),
      definition: normalizeSql(value.definition, undefined, options)!,
    })).sort((a, b) => compareCodeUnits(
      `${a.schema}.${a.name}.${a.kind}.${a.identityArguments}`,
      `${b.schema}.${b.name}.${b.kind}.${b.identityArguments}`,
    )),
    unmodelled: normalizeCensus(snapshot.unmodelled),
  };
}

function normalizeCensus(value: UnmodelledObjectCensus | undefined): UnmodelledObjectCensus {
  const census = value ?? {
    views: [], materializedViews: [], foreignTables: [], sequences: [],
    applicationSchemas: [], rlsTables: [], policies: [], extensions: [],
  };
  const sortKey = (item: unknown): string => item !== null && typeof item === "object"
    ? JSON.stringify(Object.fromEntries(Object.entries(item)
      .sort(([left], [right]) => compareCodeUnits(left, right))))
    : JSON.stringify(item);
  const sorted = <T>(items: T[]) => [...items].sort((a, b) =>
    compareCodeUnits(sortKey(a), sortKey(b)));
  return {
    views: sorted(census.views),
    materializedViews: sorted(census.materializedViews),
    foreignTables: sorted(census.foreignTables),
    sequences: sorted(census.sequences),
    applicationSchemas: [...census.applicationSchemas].sort(compareCodeUnits),
    rlsTables: sorted(census.rlsTables),
    policies: census.policies.map((policy) => ({
      ...policy,
      roles: [...policy.roles].sort(compareCodeUnits),
    })).sort((a, b) => compareCodeUnits(
      `${a.schema}.${a.table}.${a.name}`,
      `${b.schema}.${b.table}.${b.name}`,
    )),
    extensions: sorted(census.extensions),
  };
}