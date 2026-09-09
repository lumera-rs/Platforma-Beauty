import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import {
  REPOSITORY_BASELINE_MANIFEST_URL,
  validateEligibilityCliArguments,
} from "./eligibility-cli";

test("eligibility CLI accepts no operator-controlled arguments", () => {
  assert.doesNotThrow(() => validateEligibilityCliArguments([]));
  for (const argument of [
    "--adopt-known-legacy=legacy-v1",
    "--adoption-actor=operator",
    "--eligibility-manifest=/tmp/operator.json",
    "--unknown",
  ]) {
    assert.throws(
      () => validateEligibilityCliArguments([argument]),
      /Unknown eligibility argument/,
    );
  }
});

test("eligibility CLI authority is the fixed repository manifest", async () => {
  const manifest = JSON.parse(
    await readFile(REPOSITORY_BASELINE_MANIFEST_URL, "utf8"),
  ) as { formatVersion: number; expected: unknown[] };
  assert.deepEqual(manifest, { formatVersion: 1, expected: [] });
});

const runtimeAllowlist = new Set([
  "eligibility-cli.ts",
  "catalog.ts",
  "eligibility.ts",
  "fingerprint.ts",
  "fingerprint-transaction.ts",
  "ownership.ts",
  "read-only-query.ts",
  "compare.ts",
  "model.ts",
]);

const forbiddenRuntimeCapability =
  /\b(?:BEGIN\s+READ\s+WRITE|CREATE\s+(?:SCHEMA|TABLE)|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|LOCK\s+TABLE|ACCESS\s+EXCLUSIVE|pg_advisory_lock|adoptKnownLegacy|baseline_adoptions)\b/i;

function runtimeModuleSpecifiers(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const add = (value: ts.Expression | undefined): void => {
    if (value && ts.isStringLiteralLike(value)) specifiers.push(value.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const allNamedImportsAreTypeOnly = clause?.namedBindings
        && !clause.name
        && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.length > 0
        && clause.namedBindings.elements.every((element) => element.isTypeOnly);
      if (!clause?.isTypeOnly && !allNamedImportsAreTypeOnly) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) add(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node)
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

async function auditRuntimeGraph(
  entry: string,
  allowedFiles: ReadonlySet<string>,
  load: (path: string) => Promise<string>,
): Promise<Set<string>> {
  const pending = [entry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    assert.equal(allowedFiles.has(path), true, `unreviewed runtime dependency: ${path}`);
    const source = await load(path);
    assert.equal(
      forbiddenRuntimeCapability.test(source),
      false,
      `write-capable runtime dependency: ${path}`,
    );
    for (const specifier of runtimeModuleSpecifiers(source, path)) {
      if (specifier.startsWith("node:") || specifier === "pg") continue;
      assert.equal(specifier.startsWith("."), true, `unreviewed package import: ${specifier}`);
      pending.push(resolve(dirname(path), `${specifier}.ts`));
    }
  }
  return visited;
}

test("eligibility CLI runtime dependency graph is explicitly read-only", async () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const allowed = new Set([...runtimeAllowlist].map((file) => resolve(root, file)));
  const visited = await auditRuntimeGraph(
    resolve(root, "eligibility-cli.ts"),
    allowed,
    (path) => readFile(path, "utf8"),
  );
  assert.deepEqual(visited, allowed);
});

test("runtime dependency audit rejects an indirect write path without executing it", async () => {
  const sources = new Map([
    ["/virtual/entry.ts", 'import "./reader";'],
    ["/virtual/reader.ts", 'export * from "./writer";'],
    ["/virtual/writer.ts", 'export const sql = "INSERT INTO baseline_adoptions VALUES (1)";'],
  ]);
  await assert.rejects(
    () => auditRuntimeGraph(
      "/virtual/entry.ts",
      new Set(sources.keys()),
      async (path) => sources.get(path)!,
    ),
    /write-capable runtime dependency: \/virtual\/writer\.ts/,
  );
});