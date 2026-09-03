import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { parseDependencyDeclarations } from "../../lib/api-spec/dependency-declaration-parser.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const scanRoots = ["scripts/src", "lib/api-spec"];
const sharedParser = "lib/api-spec/dependency-declaration-parser.mjs";

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(repoRoot, directory), {
    withFileTypes: true,
  });
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(relativePath);
    return /\.(?:[cm]?[jt]s|tsx)$/.test(entry.name) ? [relativePath] : [];
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

async function findUnsafeDependencyDeclarationParsers(): Promise<string[]> {
  const files = (await Promise.all(scanRoots.map(collectSourceFiles))).flat();
  const unsafe: string[] = [];
  await Promise.all(files.map(async (relativePath) => {
    if (relativePath === sharedParser) return;
    const source = await readFile(path.join(repoRoot, relativePath), "utf8");
    const sourceFile = ts.createSourceFile(
      relativePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isDependencyDeclarationParse(node)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        unsafe.push(`${relativePath}:${position.line + 1}:${position.character + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }));
  return unsafe.sort();
}

test("dependency declaration parsers use the source-safe shared parser", async () => {
  assert.deepEqual(
    await findUnsafeDependencyDeclarationParsers(),
    [],
    `Dependency declaration ingestion under ${scanRoots.join(" and ")} must use ${sharedParser}`,
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