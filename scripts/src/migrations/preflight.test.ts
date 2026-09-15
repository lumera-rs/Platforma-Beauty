import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
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

test("preflight runtime has no migration mutation imports or calls", async () => {
  const source = await readFile(new URL("./preflight.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'].\/runner["']/u);
  assert.doesNotMatch(source, /from ["'].\/ledger["']/u);
  assert.doesNotMatch(source, /\b(?:applyMigrations|adoptBaseline|ensureLedger|adoptLedgerRow)\b/u);
  assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/u);
  assert.match(source, /beginFingerprintTransaction\(client\)/u);
});