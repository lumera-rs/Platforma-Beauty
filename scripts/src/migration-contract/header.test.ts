import assert from "node:assert/strict";
import test from "node:test";
import {
  MIGRATION_CONDITION_MAX_COUNT,
  MIGRATION_CONDITION_MAX_LENGTH,
  MIGRATION_DESCRIPTION_MAX_LENGTH,
  MIGRATION_RECOVERY_MAX_LENGTH,
  MigrationHeaderError,
  parseMigrationHeader,
} from "./header";

interface HeaderOptions {
  id?: string;
  mode?: string;
  description?: string;
  min?: string;
  max?: string;
  recovery?: string;
  beforeEnd?: string[];
  body?: string;
  eol?: "\n" | "\r\n";
}

function validHeader(options: HeaderOptions = {}): string {
  const eol = options.eol ?? "\n";
  return [
    "-- lumera:migration-format 1",
    `-- lumera:id ${options.id ?? "000001"}`,
    `-- lumera:mode ${options.mode ?? "transactional"}`,
    `-- lumera:description ${options.description ?? "Add a precise customer preference constraint."}`,
    `-- lumera:min-postgres ${options.min ?? "16"}`,
    `-- lumera:max-postgres ${options.max ?? "16"}`,
    ...(options.beforeEnd ?? []),
    `-- lumera:recovery ${options.recovery ?? "Drop the constraint and re-run the reviewed migration."}`,
    "-- lumera:end-header",
    options.body ?? "SELECT 'ž';\n",
  ].join(eol);
}

function rejects(source: Uint8Array | string, pattern: RegExp, id = "000001"): void {
  assert.throws(() => parseMigrationHeader(source, id), pattern);
}

test("header parser returns deterministic typed metadata and verbatim LF SQL body", () => {
  const source = validHeader({
    beforeEnd: [
      "-- lumera:precondition-sql SELECT true",
      "-- lumera:precondition-sql WITH ready AS (SELECT true) SELECT * FROM ready",
      "-- lumera:postcondition-sql SELECT count(*) = 1 FROM customer",
      "-- lumera:postcondition-sql SELECT true",
    ],
    body: "\nSELECT 'Luméra';\n",
  });
  const expected = {
    formatVersion: 1,
    migrationId: "000001",
    mode: "transactional",
    description: "Add a precise customer preference constraint.",
    minPostgres: 16,
    maxPostgres: 16,
    preconditions: [
      "SELECT true",
      "WITH ready AS (SELECT true) SELECT * FROM ready",
    ],
    postconditions: [
      "SELECT count(*) = 1 FROM customer",
      "SELECT true",
    ],
    recovery: "Drop the constraint and re-run the reviewed migration.",
    sqlBody: "\nSELECT 'Luméra';\n",
  };
  assert.deepEqual(parseMigrationHeader(source, "000001"), expected);
  assert.deepEqual(parseMigrationHeader(source, "000001"), expected);
});

test("accepts exact CRLF headers and nontransactional mode without body inspection", () => {
  const parsed = parseMigrationHeader(validHeader({
    eol: "\r\n",
    mode: "nontransactional",
    body: "VACUUM customer;\r\n",
  }), "000001");
  assert.equal(parsed.mode, "nontransactional");
  assert.equal(parsed.sqlBody, "VACUUM customer;\r\n");
});

test("rejects every missing required singleton and missing end-header", () => {
  const source = validHeader();
  for (const key of [
    "migration-format",
    "id",
    "mode",
    "description",
    "min-postgres",
    "max-postgres",
    "recovery",
  ]) {
    rejects(
      source.replace(new RegExp(`^-- lumera:${key} .+\\n`, "m"), ""),
      key === "migration-format" ? /first line/i : /missing required/i,
    );
  }
  rejects(source.replace("-- lumera:end-header\n", ""), /malformed directive|missing required/i);
});

test("rejects duplicate singleton directives, including a second end marker", () => {
  for (const line of [
    "-- lumera:migration-format 1",
    "-- lumera:id 000001",
    "-- lumera:mode transactional",
    "-- lumera:description Duplicate.",
    "-- lumera:min-postgres 16",
    "-- lumera:max-postgres 16",
    "-- lumera:recovery Duplicate.",
  ]) {
    rejects(validHeader({ beforeEnd: [line] }), /duplicate directive/i);
  }
  rejects(validHeader().replace("-- lumera:end-header", "-- lumera:end-header value"), /must not have a value/i);
  rejects(validHeader({ body: "-- lumera:end-header\nSELECT 1;\n" }), /reserved lumera:/i);
});

test("rejects unknown, malformed, misplaced, and strangely-spaced directives", () => {
  rejects(validHeader({ beforeEnd: ["-- lumera:future-option value"] }), /unknown directive/i);
  for (const line of [
    "--  lumera:precondition-sql SELECT 1",
    "-- lumera:precondition-sql  SELECT 1",
    "-- lumera:precondition-sql SELECT 1 ",
    "--\tlumera:precondition-sql SELECT 1",
    " -- lumera:precondition-sql SELECT 1",
    "-- LUMERA:precondition-sql SELECT 1",
    "-- lumera:precondition_sql SELECT 1",
  ]) rejects(validHeader({ beforeEnd: [line] }), /malformed|whitespace|control character/i);
  rejects(`SELECT 1;\n${validHeader()}`, /first line/i);
});

test("rejects bad format, IDs, modes, and directory/header mismatch", () => {
  rejects(validHeader().replace("migration-format 1", "migration-format 2"), /first line/i);
  rejects(validHeader({ id: "1" }), /six digits/i);
  rejects(validHeader({ id: "000002" }), /does not match/i);
  rejects(validHeader({ mode: "transaction" }), /mode must be exactly/i);
});

test("validates the complete PostgreSQL range against supported majors", () => {
  for (const [min, max, pattern] of [
    ["sixteen", "16", /integer/i],
    ["16", "16.0", /integer/i],
    ["016", "16", /integer/i],
    ["17", "16", /must not exceed/i],
    ["15", "16", /unsupported/i],
    ["16", "17", /unsupported/i],
  ] as const) rejects(validHeader({ min, max }), pattern);
});

test("rejects empty, padded, and overlong bounded values and condition counts", () => {
  rejects(validHeader({ description: "" }), /description must have a value/i);
  rejects(validHeader({ recovery: "" }), /recovery must have a value/i);
  rejects(validHeader({ description: " padded" }), /leading or trailing whitespace/i);
  rejects(validHeader({ description: "x".repeat(MIGRATION_DESCRIPTION_MAX_LENGTH + 1) }), /limit/i);
  rejects(validHeader({ recovery: "x".repeat(MIGRATION_RECOVERY_MAX_LENGTH + 1) }), /limit/i);
  rejects(validHeader({
    beforeEnd: [`-- lumera:precondition-sql ${"x".repeat(MIGRATION_CONDITION_MAX_LENGTH + 1)}`],
  }), /limit/i);
  rejects(validHeader({
    beforeEnd: Array.from(
      { length: MIGRATION_CONDITION_MAX_COUNT + 1 },
      () => "-- lumera:postcondition-sql SELECT true",
    ),
  }), /line limit/i);
});

test("rejects empty body and real Lumera directive line comments after end-header", () => {
  rejects(validHeader({ body: " \n" }), /body must not be empty/i);
  for (const body of [
    "-- lumera:anything in a SQL comment\nSELECT 1;\n",
    "--lumera:anything malformed spacing\nSELECT 1;\n",
    "--   lumera:unknown malformed spacing\nSELECT 1;\n",
    "SELECT 1; -- lumera:end-header\n",
    "-- lumera:end-header\nSELECT 1;\n",
  ]) rejects(validHeader({ body }), /reserved lumera: directive/i);
});

test("ignores directive decoys inside supported SQL lexical constructs", () => {
  for (const body of [
    "SELECT 'first\n-- lumera:not-a-directive\nthird';\n",
    "SELECT 'it''s safe\n-- lumera:not-a-directive';\n",
    "SELECT E'escaped quote \\'\n-- lumera:not-a-directive';\n",
    "SELECT \"quoted\n-- lumera:not-a-directive\";\n",
    "SELECT $$first\n-- lumera:not-a-directive\nthird$$;\n",
    "SELECT $body$first\n-- lumera:not-a-directive\nthird$body$;\n",
    "/* outer\n-- lumera:not-a-directive\n/* nested */\nstill outer */ SELECT 1;\n",
  ]) {
    const parsed = parseMigrationHeader(validHeader({ body }), "000001");
    assert.equal(parsed.sqlBody, body);
  }
});

test("finds a real directive after skipped strings and block comments", () => {
  for (const body of [
    "SELECT '-- lumera:decoy';\n-- lumera:real\nSELECT 1;\n",
    "SELECT $$-- lumera:decoy$$;\n--  lumera:malformed-real\nSELECT 1;\n",
    "/* -- lumera:decoy */\n-- lumera:end-header\nSELECT 1;\n",
  ]) rejects(validHeader({ body }), /reserved lumera: directive/i);
});

test("fails closed on unterminated supported SQL lexical constructs", () => {
  for (const body of [
    "SELECT 'unterminated\n-- lumera:decoy\n",
    "SELECT \"unterminated\n",
    "SELECT $tag$unterminated\n",
    "/* unterminated",
  ]) rejects(validHeader({ body }), /unterminated SQL/i);
});

test("rejects BOM, lone CR, controls, and fatally malformed UTF-8", () => {
  rejects(`\ufeff${validHeader()}`, /BOM/i);
  rejects(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(validHeader())]), /BOM/i);
  rejects(validHeader().replace("\n", "\r"), /lone CR/i);
  rejects(validHeader({ description: "bad\u0001value" }), /control character/i);
  rejects(new Uint8Array([0xc3, 0x28]), /valid UTF-8/i);
});

test("rejects Unicode controls, separators, and format/bidi characters in header values", () => {
  for (const character of [
    "\u0085",
    "\u009f",
    "\u061c",
    "\u200b",
    "\u2028",
    "\u2029",
    "\u202e",
    "\u2066",
    "\ufeff",
  ]) {
    rejects(validHeader({ description: `unsafe${character}value` }), /forbidden Unicode character/i);
  }
});