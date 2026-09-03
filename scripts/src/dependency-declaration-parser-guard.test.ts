import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { parseDependencyDeclarations } from "../../lib/api-spec/dependency-declaration-parser.mjs";
import { parseDependencyPackageJson } from "../../lib/api-spec/dependency-package-parser.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const scanRoots = ["scripts/src", "artifacts", "lib", "packages"];
const sharedParsers = new Set([
  "lib/api-spec/dependency-declaration-parser.mjs",
  "lib/api-spec/dependency-package-parser.mjs",
]);

async function collectSourceFiles(directory: string): Promise<string[]> {
  try {
    await access(path.join(repoRoot, directory));
  } catch {
    return [];
  }
  const entries = await readdir(path.join(repoRoot, directory), {
    withFileTypes: true,
  });
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(directory, entry.name);
    if (
      entry.isDirectory()
      && !["coverage", "dist", "node_modules"].includes(entry.name)
    ) {
      return collectSourceFiles(relativePath);
    }
    if (entry.isDirectory()) return [];
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [relativePath] : [];
  }));
  return files.flat();
}

function isDependencyDeclarationParse(call: ts.CallExpression): boolean {
  if (
    !ts.isPropertyAccessExpression(call.expression)
    || call.expression.name.text !== "createSourceFile"
  ) {
    return false;
  }
  const [fileName, contents] = call.arguments;
  return (
    (ts.isStringLiteralLike(fileName) && /\.d\.[cm]?ts$/i.test(fileName.text))
    || (contents !== undefined && /\b(?:declarations?|dts)\b/i.test(contents.getText()))
  );
}

function isJsonParse(call: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(call.expression)
    && ts.isIdentifier(call.expression.expression)
    && call.expression.expression.text === "JSON"
    && call.expression.name.text === "parse";
}

function sourceReferencesDependencyPackage(sourceFile: ts.SourceFile): boolean {
  let referencesPackage = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "require"
      && node.expression.name.text === "resolve"
      && ts.isStringLiteralLike(node.arguments[0])
      && /(?:^|[/\\])package\.json$/i.test(node.arguments[0].text)
    ) {
      referencesPackage = true;
    }
    if (
      ts.isStringLiteralLike(node)
      && /package\.json$/i.test(node.text)
    ) referencesPackage = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return referencesPackage;
}

async function findUnsafeDependencyFileParsers(): Promise<string[]> {
  const files = (await Promise.all(scanRoots.map(collectSourceFiles))).flat();
  const unsafe: string[] = [];
  await Promise.all(files.map(async (relativePath) => {
    if (sharedParsers.has(relativePath)) return;
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    const sourceFile = ts.createSourceFile(
      relativePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const referencesDependencyPackage = sourceReferencesDependencyPackage(sourceFile);
    const inventoriesPackageParsing =
      !relativePath.startsWith("scripts/src/")
      && !relativePath.startsWith("lib/api-spec/");
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && (
          isDependencyDeclarationParse(node)
          || (
            inventoriesPackageParsing
            && referencesDependencyPackage
            && isJsonParse(node)
          )
        )
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        unsafe.push(`${relativePath}:${position.line + 1}:${position.character + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }));
  return unsafe.sort();
}

test("third-party declaration and package parsers use source-safe shared parsers", async () => {
  assert.deepEqual(
    await findUnsafeDependencyFileParsers(),
    [],
    `Third-party declaration and package-file ingestion under ${scanRoots.join(", ")} must use the source-safe parsers in lib/api-spec`,
  );
});

test("dependency parser diagnostics include only a trustworthy code and location", () => {
  const privateContent = "DO_NOT_REVEAL_DEPENDENCY_SOURCE_7f41";
  const declarations = [
    "interface DependencyOptions {",
    `  // ${privateContent}`,
    "  broken?: ;",
    "}",
  ].join("\r\n");

  assert.throws(
    () => parseDependencyDeclarations({
      declarations,
      fileName: "dependency-package.d.ts",
      label: "Installed dependency declarations",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /^Installed dependency declarations must contain valid TypeScript syntax: TS\d+ at 3:12: .+$/,
      );
      assert.doesNotMatch(error.message, new RegExp(privateContent));
      assert.doesNotMatch(error.message, /interface DependencyOptions|broken\?:/);
      return true;
    },
  );
});

test("dependency package diagnostics include only a stable code and trustworthy location", () => {
  const privateContent = "DO_NOT_REVEAL_PACKAGE_CONTENTS_4de8";
  const contents = [
    "{",
    `  "private": "${privateContent}",`,
    '  "types": "./dist/index.d.ts",',
    '  "broken": ,',
    "}",
  ].join("\r\n");

  assert.throws(
    () => parseDependencyPackageJson({
      contents,
      label: "Installed dependency package manifest",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "Installed dependency package manifest is invalid: DEPENDENCY_PACKAGE_JSON_INVALID at 4:13",
      );
      assert.doesNotMatch(error.message, new RegExp(privateContent));
      assert.doesNotMatch(error.message, /types|broken|dist\/index/);
      return true;
    },
  );
});

test("dependency package parser preserves valid structured package data", () => {
  assert.deepEqual(
    parseDependencyPackageJson({
      contents: '{"name":"dependency","private":true,"exports":[null,1,-2.5e3]}',
      label: "Installed dependency package manifest",
    }),
    {
      name: "dependency",
      private: true,
      exports: [null, 1, -2500],
    },
  );
});