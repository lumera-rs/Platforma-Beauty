import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isReviewedPostgresPatch } from "@workspace/db/migration-runtime";
import { parsePreflightOptions, redactPreflightError } from "./preflight-cli";

test("preflight requires one explicit target and confirmation without ambient fallback", () => {
  assert.throws(() => parsePreflightOptions([]), /explicit --database-url-file/u);
  assert.throws(
    () => parsePreflightOptions(["--database-url-file=\/proc\/self\/fd\/3"]),
    /confirm-preflight/u,
  );
  assert.deepEqual(
    parsePreflightOptions([
      "--database-url-file=/proc/self/fd/3",
      "--confirm-preflight",
    ]),
    { databaseUrlFile: "/proc/self/fd/3" },
  );
  assert.throws(
    () => parsePreflightOptions([
      "--database-url-file=/proc/self/fd/3",
      "--confirm-preflight",
      "--confirm",
    ]),
    /Usage/u,
  );
});

test("preflight errors redact PostgreSQL URLs", () => {
  const output = redactPreflightError(
    new Error("failed postgresql://operator:password@private.example/prod?sslmode=require"),
  );
  assert.doesNotMatch(output, /operator|password|private\.example/u);
  assert.equal(output, "Preflight failed; connection details were withheld");
});

test("runtime and adoption compatibility admit only reviewed PostgreSQL 16 patches", () => {
  const compatibility = {
    postgresServerMajorVersion: 16,
    postgresServerVersionNum: 160011,
    postgresDeparserFormat: "postgresql-16-deparser-v1",
  };
  assert.equal(isReviewedPostgresPatch(compatibility), true);
  assert.equal(isReviewedPostgresPatch({ ...compatibility, postgresServerVersionNum: 160010 }), true);
  assert.equal(isReviewedPostgresPatch({
    ...compatibility,
    postgresServerVersionNum: 160011,
    postgresDeparserFormat: "postgresql-15-deparser-v1",
  }), false);
  assert.equal(isReviewedPostgresPatch({
    ...compatibility,
    postgresServerMajorVersion: 15,
    postgresServerVersionNum: 150011,
  }), false);
});

test("preflight runtime has no migration mutation imports or calls", async () => {
  const runtimeFiles = [
    "./preflight.ts",
    "./read-only-ledger.ts",
    "../schema-drift/catalog.ts",
    "../schema-drift/fingerprint.ts",
    "../schema-drift/fingerprint-transaction.ts",
    "../schema-drift/ownership.ts",
    "../schema-drift/read-only-query.ts",
    "../../../lib/db/src/migration-runtime/read-only-query.ts",
    "../../../lib/db/src/migration-runtime/fingerprint-transaction.ts",
  ];
  const sources = await Promise.all(runtimeFiles.map(async (file) => ({
    file,
    source: await readFile(new URL(file, import.meta.url), "utf8"),
  })));
  for (const { file, source } of sources) {
    assert.doesNotMatch(source, /from ["'].\/runner["']/u, file);
    assert.doesNotMatch(source, /from ["'].\/ledger["']/u, file);
    assert.doesNotMatch(source, /\b(?:applyMigrations|adoptBaseline|ensureLedger|adoptLedgerRow)\b/u, file);
    if ([
      "./preflight.ts",
      "./read-only-ledger.ts",
      "../schema-drift/catalog.ts",
      "../schema-drift/fingerprint-transaction.ts",
    ].includes(file)) {
      assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/u, file);
    }
  }
  assert.match(sources[0]!.source, /beginFingerprintTransaction\(client\)/u);
  const queryGuard = sources.find(
    ({ file }) => file === "../../../lib/db/src/migration-runtime/read-only-query.ts",
  )!.source;
  for (const verb of ["CREATE", "ALTER", "DROP", "INSERT", "UPDATE", "DELETE"]) {
    assert.match(queryGuard, new RegExp(`\\b[^\\n]*${verb}[^\\n]*\\b`, "u"), verb);
  }
});