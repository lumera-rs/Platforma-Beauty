import { SUPPORTED_POSTGRES_MAJOR_VERSIONS } from "../schema-drift/model";

export const MIGRATION_DESCRIPTION_MAX_LENGTH = 500;
export const MIGRATION_RECOVERY_MAX_LENGTH = 2_000;
export const MIGRATION_CONDITION_MAX_LENGTH = 4_000;
export const MIGRATION_CONDITION_MAX_COUNT = 100;

export type MigrationMode = "transactional" | "nontransactional";

export interface MigrationMetadata {
  formatVersion: 1;
  migrationId: string;
  mode: MigrationMode;
  description: string;
  minPostgres: number;
  maxPostgres: number;
  preconditions: string[];
  postconditions: string[];
  recovery: string;
  sqlBody: string;
}

export class MigrationHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationHeaderError";
  }
}

type SingletonKey =
  | "migration-format"
  | "id"
  | "mode"
  | "description"
  | "min-postgres"
  | "max-postgres"
  | "recovery";
type RepeatableKey = "precondition-sql" | "postcondition-sql";
type DirectiveKey = SingletonKey | RepeatableKey | "end-header";

const FIRST_LINE = "-- lumera:migration-format 1";
const DIRECTIVE_LINE = /^-- lumera:([a-z][a-z0-9-]*)(?: ([^\r\n]*))?$/;
const SINGLETON_KEYS = new Set<SingletonKey>([
  "migration-format",
  "id",
  "mode",
  "description",
  "min-postgres",
  "max-postgres",
  "recovery",
]);
const REPEATABLE_KEYS = new Set<RepeatableKey>([
  "precondition-sql",
  "postcondition-sql",
]);
const KNOWN_KEYS = new Set<DirectiveKey>([
  ...SINGLETON_KEYS,
  ...REPEATABLE_KEYS,
  "end-header",
]);

function fail(message: string): never {
  throw new MigrationHeaderError(`Invalid Lumera migration header: ${message}`);
}

function decode(content: Uint8Array | string): string {
  if (typeof content === "string") return content;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
  } catch {
    return fail("migration.sql is not valid UTF-8");
  }
}

function rejectForbiddenCharacters(content: string): void {
  if (content.charCodeAt(0) === 0xfeff) fail("UTF-8 BOM is not allowed");
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code === 0x0d) {
      if (content.charCodeAt(index + 1) !== 0x0a) fail("lone CR is not allowed");
      index += 1;
      continue;
    }
    if ((code >= 0 && code < 0x20 && code !== 0x0a) || code === 0x7f) {
      fail(`control character U+${code.toString(16).padStart(4, "0")} is not allowed`);
    }
  }
}

function lineEnd(content: string, start: number): { line: string; next: number } {
  const lf = content.indexOf("\n", start);
  if (lf === -1) return { line: content.slice(start), next: content.length };
  const lineEndIndex = lf > start && content.charCodeAt(lf - 1) === 0x0d ? lf - 1 : lf;
  return { line: content.slice(start, lineEndIndex), next: lf + 1 };
}

function boundedValue(key: string, value: string | undefined, maximum: number): string {
  if (value === undefined || value.length === 0) fail(`${key} must have a value`);
  rejectHeaderValueCharacters(key, value);
  if (value !== value.trim()) fail(`${key} must not have leading or trailing whitespace`);
  if (value.length > maximum) fail(`${key} exceeds its ${maximum}-character limit`);
  return value;
}

function rejectHeaderValueCharacters(key: string, value: string): void {
  for (const character of value) {
    if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(character)) {
      const codePoint = character.codePointAt(0)!;
      fail(`${key} contains forbidden Unicode character U+${codePoint.toString(16).padStart(4, "0")}`);
    }
  }
}

function postgresMajor(key: string, value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) fail(`${key} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(`${key} must be a safe integer`);
  return parsed;
}

function isIdentifierContinuation(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

/**
 * Reserves directive-shaped Lumera line comments without treating decoys in
 * SQL literals, quoted identifiers, dollar strings, or block comments as
 * directives. This is only lexical namespace protection, not SQL validation.
 */
function rejectBodyDirectives(sqlBody: string): void {
  let cursor = 0;
  while (cursor < sqlBody.length) {
    if (sqlBody.startsWith("--", cursor)) {
      const commentEnd = sqlBody.indexOf("\n", cursor + 2);
      const end = commentEnd === -1 ? sqlBody.length : commentEnd;
      const comment = sqlBody.slice(cursor + 2, end);
      if (/^\s*lumera:/.test(comment)) {
        fail("reserved lumera: directive line is not allowed after end-header");
      }
      cursor = end;
      continue;
    }

    if (sqlBody.startsWith("/*", cursor)) {
      let depth = 1;
      cursor += 2;
      while (cursor < sqlBody.length && depth > 0) {
        if (sqlBody.startsWith("/*", cursor)) {
          depth += 1;
          cursor += 2;
        } else if (sqlBody.startsWith("*/", cursor)) {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      if (depth !== 0) fail("unterminated SQL block comment");
      continue;
    }

    if (sqlBody[cursor] === "\"") {
      cursor += 1;
      let terminated = false;
      while (cursor < sqlBody.length) {
        if (sqlBody[cursor] !== "\"") {
          cursor += 1;
        } else if (sqlBody[cursor + 1] === "\"") {
          cursor += 2;
        } else {
          cursor += 1;
          terminated = true;
          break;
        }
      }
      if (!terminated) fail("unterminated SQL quoted identifier");
      continue;
    }

    if (sqlBody[cursor] === "'") {
      const escapeString = (sqlBody[cursor - 1] === "E" || sqlBody[cursor - 1] === "e")
        && !isIdentifierContinuation(sqlBody[cursor - 2]);
      cursor += 1;
      let terminated = false;
      while (cursor < sqlBody.length) {
        if (escapeString && sqlBody[cursor] === "\\") {
          cursor += Math.min(2, sqlBody.length - cursor);
        } else if (sqlBody[cursor] !== "'") {
          cursor += 1;
        } else if (sqlBody[cursor + 1] === "'") {
          cursor += 2;
        } else {
          cursor += 1;
          terminated = true;
          break;
        }
      }
      if (!terminated) fail("unterminated SQL string literal");
      continue;
    }

    if (sqlBody[cursor] === "$" && !isIdentifierContinuation(sqlBody[cursor - 1])) {
      const delimiterMatch = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sqlBody.slice(cursor));
      if (delimiterMatch) {
        const delimiter = delimiterMatch[0];
        const close = sqlBody.indexOf(delimiter, cursor + delimiter.length);
        if (close === -1) fail("unterminated SQL dollar-quoted string");
        cursor = close + delimiter.length;
        continue;
      }
    }

    cursor += 1;
  }
}

/**
 * Parses metadata only. Conditions are deliberately retained as text: read-only
 * safety and execution belong to P.2e/P.2g because a catalog-regex validator is
 * not a SQL parser. P.2g also owns mode-specific SQL-body checks.
 */
export function parseMigrationHeader(
  input: Uint8Array | string,
  expectedMigrationId: string,
): MigrationMetadata {
  if (!/^\d{6}$/.test(expectedMigrationId)) {
    fail("expected migration ID must contain exactly six digits");
  }
  const content = decode(input);
  rejectForbiddenCharacters(content);
  if (!content.startsWith(FIRST_LINE)
    || (content.length > FIRST_LINE.length
      && content[FIRST_LINE.length] !== "\n"
      && content.slice(FIRST_LINE.length, FIRST_LINE.length + 2) !== "\r\n")) {
    fail(`the first line must be exactly "${FIRST_LINE}"`);
  }

  const singletons = new Map<SingletonKey, string>();
  const preconditions: string[] = [];
  const postconditions: string[] = [];
  let cursor = 0;
  let bodyStart: number | undefined;

  while (cursor < content.length) {
    const current = lineEnd(content, cursor);
    const match = DIRECTIVE_LINE.exec(current.line);
    if (!match) fail(`malformed directive line "${current.line}"`);
    const key = match[1]!;
    const value = match[2];
    if (!KNOWN_KEYS.has(key as DirectiveKey)) fail(`unknown directive lumera:${key}`);

    if (key === "end-header") {
      if (value !== undefined) fail("end-header must not have a value");
      bodyStart = current.next;
      break;
    }
    if (value === undefined) fail(`${key} must have a value`);
    rejectHeaderValueCharacters(key, value);
    if (value !== value.trim()) fail(`${key} must not have leading or trailing whitespace`);

    if (REPEATABLE_KEYS.has(key as RepeatableKey)) {
      const condition = boundedValue(key, value, MIGRATION_CONDITION_MAX_LENGTH);
      const target = key === "precondition-sql" ? preconditions : postconditions;
      if (target.length >= MIGRATION_CONDITION_MAX_COUNT) {
        fail(`${key} exceeds its ${MIGRATION_CONDITION_MAX_COUNT}-line limit`);
      }
      target.push(condition);
    } else {
      const singleton = key as SingletonKey;
      if (singletons.has(singleton)) fail(`duplicate directive lumera:${key}`);
      singletons.set(singleton, value);
    }
    cursor = current.next;
  }

  if (bodyStart === undefined) fail("missing required directive lumera:end-header");
  for (const key of SINGLETON_KEYS) {
    if (!singletons.has(key)) fail(`missing required directive lumera:${key}`);
  }

  const sqlBody = content.slice(bodyStart);
  if (sqlBody.trim().length === 0) fail("SQL body must not be empty");
  rejectBodyDirectives(sqlBody);

  const format = singletons.get("migration-format")!;
  if (format !== "1") fail("migration-format must be exactly 1");
  const migrationId = singletons.get("id")!;
  if (!/^\d{6}$/.test(migrationId)) fail("id must contain exactly six digits");
  if (migrationId !== expectedMigrationId) {
    fail(`id ${migrationId} does not match directory ID ${expectedMigrationId}`);
  }
  const mode = singletons.get("mode")!;
  if (mode !== "transactional" && mode !== "nontransactional") {
    fail("mode must be exactly transactional or nontransactional");
  }
  const description = boundedValue(
    "description",
    singletons.get("description"),
    MIGRATION_DESCRIPTION_MAX_LENGTH,
  );
  const recovery = boundedValue(
    "recovery",
    singletons.get("recovery"),
    MIGRATION_RECOVERY_MAX_LENGTH,
  );
  const minPostgres = postgresMajor("min-postgres", singletons.get("min-postgres")!);
  const maxPostgres = postgresMajor("max-postgres", singletons.get("max-postgres")!);
  if (minPostgres > maxPostgres) fail("min-postgres must not exceed max-postgres");
  const supported = new Set<number>(SUPPORTED_POSTGRES_MAJOR_VERSIONS);
  for (let major = minPostgres; major <= maxPostgres; major += 1) {
    if (!supported.has(major)) fail(`PostgreSQL major ${major} is unsupported`);
  }

  return {
    formatVersion: 1,
    migrationId,
    mode,
    description,
    minPostgres,
    maxPostgres,
    preconditions,
    postconditions,
    recovery,
    sqlBody,
  };
}