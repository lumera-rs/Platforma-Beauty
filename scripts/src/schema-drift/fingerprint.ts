import { createHash } from "node:crypto";
import {
  compareCodeUnits,
  normalizeSnapshot,
  POSTGRES_DEPARSE_FORMAT,
  SUPPORTED_POSTGRES_MAJOR_VERSIONS,
  type OwnershipException,
  type PostgresFingerprintCompatibility,
  type SchemaSnapshot,
  type TableDefinition,
} from "./model";

export const FINGERPRINT_ALGORITHM = "sha256" as const;
export const FINGERPRINT_VERSION = 2 as const;
export const FINGERPRINT_FORMAT_VERSION = 2 as const;
export const SCHEMA_FORMAT_VERSION = 1 as const;

interface StructuralKey {
  columns: string[];
  nullsNotDistinct?: boolean;
  deferrable?: boolean;
  initiallyDeferred?: boolean;
  validated?: boolean;
  indexMethod?: string | null;
  indexIncludeExpressions?: string[];
  indexKeyOptions?: number[];
  indexCollations?: string[];
  indexOpclasses?: string[];
  indexValid?: boolean;
  indexReady?: boolean;
}

interface StructuralForeignKey extends StructuralKey {
  foreignSchema: string;
  foreignTable: string;
  foreignColumns: string[];
  onDelete: string;
  onUpdate: string;
  matchType?: string;
  deleteSetColumns?: string[];
}

interface StructuralCheck {
  expression: string;
  validated?: boolean;
  noInherit?: boolean;
}

interface StructuralExclusion {
  definition: string;
  deferrable?: boolean;
  initiallyDeferred?: boolean;
  validated?: boolean;
}

interface StructuralIndex {
  expressions: string[];
  includeExpressions?: string[];
  keyOptions?: number[];
  collations?: string[];
  opclasses?: string[];
  unique: boolean;
  nullsNotDistinct?: boolean;
  predicate: string | null;
  method: string;
  valid?: boolean;
  ready?: boolean;
}

export interface StructuralTable {
  schema: string;
  name: string;
  columns: TableDefinition["columns"];
  primaryKey: StructuralKey | null;
  uniques: StructuralKey[];
  foreignKeys: StructuralForeignKey[];
  checks: StructuralCheck[];
  exclusions: StructuralExclusion[];
  indexes: StructuralIndex[];
}

export interface FingerprintPayload {
  fingerprintVersion: typeof FINGERPRINT_VERSION;
  schemaFormatVersion: typeof SCHEMA_FORMAT_VERSION;
  postgresDeparserFormat: typeof POSTGRES_DEPARSE_FORMAT;
  tables: StructuralTable[] | TableDefinition[];
}

export interface AppliedOwnershipException extends OwnershipException {
  handling: "EXCLUDED";
}

export interface CatalogFingerprintResult {
  formatVersion: typeof FINGERPRINT_FORMAT_VERSION;
  algorithm: typeof FINGERPRINT_ALGORITHM;
  fingerprintVersion: typeof FINGERPRINT_VERSION;
  schemaFormatVersion: typeof SCHEMA_FORMAT_VERSION;
  postgresCompatibility: PostgresFingerprintCompatibility;
  structuralFingerprint: string;
  physicalFingerprint: string;
  normalizedObjectCount: number;
  ownershipExceptions: AppliedOwnershipException[];
  structuralPayload: FingerprintPayload;
  physicalPayload: FingerprintPayload;
}

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const withoutName = <T extends { name: string }>(value: T): Omit<T, "name"> => {
  const { name: _name, ...semantic } = value;
  return semantic;
};

const bySerializedValue = <T>(left: T, right: T): number =>
  compareCodeUnits(stableSerialize(left), stableSerialize(right));

function structuralTable(table: TableDefinition): StructuralTable {
  return {
    schema: table.schema,
    name: table.name,
    columns: table.columns.map((column) => ({ ...column })),
    primaryKey: table.primaryKey && withoutName(table.primaryKey),
    uniques: table.uniques.map(withoutName).sort(bySerializedValue),
    foreignKeys: table.foreignKeys.map(withoutName).sort(bySerializedValue),
    checks: table.checks.map(withoutName).sort(bySerializedValue),
    exclusions: (table.exclusions ?? []).map(withoutName).sort(bySerializedValue),
    indexes: table.indexes.map(withoutName).sort(bySerializedValue),
  };
}

function ownershipKey(exception: OwnershipException): string {
  return [
    exception.objectType,
    exception.schema,
    exception.table ?? "",
    exception.name,
  ].join("\u0000");
}

function appliedOwnershipExceptions(
  snapshot: SchemaSnapshot,
  registry: OwnershipException[],
): AppliedOwnershipException[] {
  const tableNames = new Set(snapshot.tables.map((table) => `${table.schema}\u0000${table.name}`));
  return registry
    .filter((exception) => exception.objectType === "TABLE"
      && exception.table === undefined
      && tableNames.has(`${exception.schema}\u0000${exception.name}`))
    .map((exception) => ({ ...exception, handling: "EXCLUDED" as const }))
    .sort((left, right) => compareCodeUnits(ownershipKey(left), ownershipKey(right)));
}

function withoutOwnedTables(
  snapshot: SchemaSnapshot,
  excluded: AppliedOwnershipException[],
): SchemaSnapshot {
  const excludedTables = new Set(excluded.map((exception) =>
    `${exception.schema}\u0000${exception.name}`));
  return {
    tables: snapshot.tables.filter((table) =>
      !excludedTables.has(`${table.schema}\u0000${table.name}`)),
  };
}

function objectCount(snapshot: SchemaSnapshot): number {
  return snapshot.tables.reduce((count, table) => count
    + 1
    + table.columns.length
    + (table.primaryKey ? 1 : 0)
    + table.uniques.length
    + table.foreignKeys.length
    + table.checks.length
    + (table.exclusions?.length ?? 0)
    + table.indexes.length, 0);
}

function digest(payload: FingerprintPayload): string {
  return createHash(FINGERPRINT_ALGORITHM)
    .update(Buffer.from(stableSerialize(payload), "utf8"))
    .digest("hex");
}

export function fingerprintSnapshot(
  snapshot: SchemaSnapshot,
  registry: OwnershipException[] = [],
  postgresCompatibility: PostgresFingerprintCompatibility,
): CatalogFingerprintResult {
  validatePostgresCompatibility(postgresCompatibility);
  validateSnapshot(snapshot, registry);
  const normalized = normalizeSnapshot(snapshot);
  const ownershipExceptions = appliedOwnershipExceptions(normalized, registry);
  const included = withoutOwnedTables(normalized, ownershipExceptions);
  const structuralPayload: FingerprintPayload = {
    fingerprintVersion: FINGERPRINT_VERSION,
    schemaFormatVersion: SCHEMA_FORMAT_VERSION,
    postgresDeparserFormat: postgresCompatibility.deparserFormat,
    tables: included.tables.map(structuralTable),
  };
  const physicalPayload: FingerprintPayload = {
    fingerprintVersion: FINGERPRINT_VERSION,
    schemaFormatVersion: SCHEMA_FORMAT_VERSION,
    postgresDeparserFormat: postgresCompatibility.deparserFormat,
    tables: included.tables,
  };
  return {
    formatVersion: FINGERPRINT_FORMAT_VERSION,
    algorithm: FINGERPRINT_ALGORITHM,
    fingerprintVersion: FINGERPRINT_VERSION,
    schemaFormatVersion: SCHEMA_FORMAT_VERSION,
    postgresCompatibility: { ...postgresCompatibility },
    structuralFingerprint: digest(structuralPayload),
    physicalFingerprint: digest(physicalPayload),
    normalizedObjectCount: objectCount(included),
    ownershipExceptions,
    structuralPayload,
    physicalPayload,
  };
}

function validatePostgresCompatibility(value: PostgresFingerprintCompatibility): void {
  if (
    !Number.isInteger(value.serverVersionNum)
    || !Number.isInteger(value.serverMajorVersion)
    || Math.floor(value.serverVersionNum / 10000) !== value.serverMajorVersion
    || !(SUPPORTED_POSTGRES_MAJOR_VERSIONS as readonly number[]).includes(value.serverMajorVersion)
    || value.deparserFormat !== POSTGRES_DEPARSE_FORMAT
  ) {
    throw new Error("Invalid PostgreSQL fingerprint compatibility metadata");
  }
}

function validateSnapshot(snapshot: SchemaSnapshot, registry: OwnershipException[]): void {
  const tableKeys = new Set<string>();
  for (const table of snapshot.tables) {
    requireText(table.schema, "table schema");
    requireText(table.name, "table name");
    const tableKey = `${table.schema}.${table.name}`;
    if (tableKeys.has(tableKey)) throw new Error(`Duplicate catalog table: ${tableKey}`);
    tableKeys.add(tableKey);
    const columnNames = new Set<string>();
    const positions = new Set<number>();
    for (const column of table.columns) {
      requireText(column.name, `column name in ${tableKey}`);
      requireText(column.type, `column type for ${tableKey}.${column.name}`);
      if (!Number.isInteger(column.position) || column.position! <= 0) {
        throw new Error(`Invalid catalog column position for ${tableKey}.${column.name}`);
      }
      if (columnNames.has(column.name)) throw new Error(`Duplicate catalog column: ${tableKey}.${column.name}`);
      if (positions.has(column.position!)) throw new Error(`Duplicate catalog column position in ${tableKey}`);
      columnNames.add(column.name);
      positions.add(column.position!);
    }
    validateNamed(table.uniques, `${tableKey} unique constraint`);
    validateNamed(table.foreignKeys, `${tableKey} foreign key`);
    validateNamed(table.checks, `${tableKey} check constraint`);
    validateNamed(table.exclusions ?? [], `${tableKey} exclusion constraint`);
    validateNamed(table.indexes, `${tableKey} index`);
    if (table.primaryKey) {
      requireText(table.primaryKey.name, `${tableKey} primary key`);
      if (table.primaryKey.columns.length === 0) throw new Error(`Empty primary key in ${tableKey}`);
      validateBackingIndex(table.primaryKey, table.primaryKey.columns.length, `${tableKey} primary key`);
    }
    for (const key of table.uniques) {
      validateBackingIndex(key, key.columns.length, `${tableKey}.${key.name}`);
    }
    for (const exclusion of table.exclusions ?? []) {
      validateBackingIndex(exclusion, null, `${tableKey}.${exclusion.name}`);
    }
    for (const key of [...table.uniques, ...table.foreignKeys]) {
      if (key.columns.length === 0) throw new Error(`Empty key columns for ${tableKey}.${key.name}`);
    }
    for (const foreignKey of table.foreignKeys) {
      requireText(foreignKey.foreignSchema, `foreign schema for ${tableKey}.${foreignKey.name}`);
      requireText(foreignKey.foreignTable, `foreign table for ${tableKey}.${foreignKey.name}`);
      if (foreignKey.foreignColumns.length !== foreignKey.columns.length) {
        throw new Error(`Mismatched foreign key columns for ${tableKey}.${foreignKey.name}`);
      }
      for (const column of foreignKey.deleteSetColumns ?? []) {
        if (!foreignKey.columns.includes(column)) {
          throw new Error(`Invalid FK deletion-target column for ${tableKey}.${foreignKey.name}`);
        }
      }
    }
    for (const index of table.indexes) {
      requireText(index.method, `index method for ${tableKey}.${index.name}`);
      if (index.expressions.length === 0) throw new Error(`Empty index keys for ${tableKey}.${index.name}`);
      validateIndexVectors(
        index.keyOptions,
        index.collations,
        index.opclasses,
        index.expressions.length,
        `${tableKey}.${index.name}`,
      );
    }
  }
  const ownershipKeys = new Set<string>();
  for (const exception of registry) {
    if (exception.objectType !== "TABLE" || exception.table !== undefined) {
      throw new Error(`Unsupported ownership exception in catalog fingerprint: ${ownershipKey(exception)}`);
    }
    const key = ownershipKey(exception);
    if (ownershipKeys.has(key)) throw new Error(`Duplicate ownership exception: ${key}`);
    ownershipKeys.add(key);
  }
}

function validateBackingIndex(
  value: {
    indexMethod?: string | null;
    indexIncludeExpressions?: string[];
    indexKeyOptions?: number[];
    indexCollations?: string[];
    indexOpclasses?: string[];
  },
  expectedLength: number | null,
  label: string,
): void {
  const vectorsPresent = value.indexKeyOptions !== undefined
    || value.indexCollations !== undefined
    || value.indexOpclasses !== undefined;
  if (!vectorsPresent && value.indexMethod === undefined) return;
  if (!value.indexMethod) throw new Error(`Missing backing index method for ${label}`);
  if (!value.indexIncludeExpressions) {
    throw new Error(`Missing backing index INCLUDE attributes for ${label}`);
  }
  for (const expression of value.indexIncludeExpressions) {
    requireText(expression, `backing index INCLUDE attribute for ${label}`);
  }
  const length = expectedLength ?? value.indexKeyOptions?.length ?? 0;
  if (length === 0) throw new Error(`Empty backing index keys for ${label}`);
  validateIndexVectors(
    value.indexKeyOptions,
    value.indexCollations,
    value.indexOpclasses,
    length,
    `${label} backing index`,
  );
}

function validateIndexVectors(
  options: number[] | undefined,
  collations: string[] | undefined,
  opclasses: string[] | undefined,
  expectedLength: number,
  label: string,
): void {
  if (
    !options || !collations || !opclasses
    || options.length !== expectedLength
    || collations.length !== expectedLength
    || opclasses.length !== expectedLength
    || options.some((option) => !Number.isInteger(option))
    || opclasses.some((opclass) => opclass.trim() === "")
  ) {
    throw new Error(`Invalid index semantic vectors for ${label}`);
  }
}

function validateNamed(values: Array<{ name: string }>, label: string): void {
  const names = new Set<string>();
  for (const value of values) {
    requireText(value.name, label);
    if (names.has(value.name)) throw new Error(`Duplicate ${label}: ${value.name}`);
    names.add(value.name);
  }
}

function requireText(value: string, label: string): void {
  if (value.trim() === "") throw new Error(`Missing ${label}`);
}

export function serializeFingerprint(result: CatalogFingerprintResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}