import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  MAX_DEPENDENCY_DECLARATION_BYTES,
  MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH,
  MAX_DEPENDENCY_DECLARATION_TOKENS,
  parseDependencyDeclarations,
} from "../../lib/api-spec/dependency-declaration-parser.mjs";
import {
  MAX_DEPENDENCY_PACKAGE_BYTES,
  MAX_DEPENDENCY_PACKAGE_NESTING_DEPTH,
  parseDependencyPackageJson,
} from "../../lib/api-spec/dependency-package-parser.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const scanRoots = ["scripts/src", "artifacts", "lib", "packages"];
const sharedParsers = new Set([
  "lib/api-spec/dependency-declaration-parser.mjs",
  "lib/api-spec/dependency-package-parser.mjs",
]);
const packageLabel = "Installed dependency package manifest";
const declarationLabel = "Installed dependency declarations";

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function assertTypeScriptAcceptsDeclaration(
  source: string,
  caseLabel: string,
): void {
  const sourceFile = ts.createSourceFile(
    `${caseLabel}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.deepEqual(
    (sourceFile as ts.SourceFile & {
      parseDiagnostics: readonly ts.Diagnostic[];
    }).parseDiagnostics,
    [],
    `TypeScript rejected valid declaration corpus case ${caseLabel}`,
  );
}

function countTypeScriptTokens(source: string): number {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
  );
  let count = 0;
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) count += 1;
  return count;
}

function assertDeclarationAccepted(
  declarations: string,
  caseLabel: string,
): void {
  assertTypeScriptAcceptsDeclaration(declarations, caseLabel);
  parseDependencyDeclarations({
    declarations,
    fileName: `${caseLabel}.d.ts`,
    label: declarationLabel,
  });
}

function createDeclarationCorpusCase(
  random: () => number,
  index: number,
): string {
  const unicodeNames = ["Café", "Živeli", "東京", "Δelta", "Пример", "Lumière"];
  const name = `${unicodeNames[Math.floor(random() * unicodeNames.length)]}${index}`;
  const genericDepth = 2 + Math.floor(random() * 10);
  const genericType = `${"ReadonlyArray<".repeat(genericDepth)}${name}${">".repeat(genericDepth)}`;
  const commentKind = random() < 0.5
    ? `// deterministic unicode comment ${name}\n`
    : `/* deterministic nested-generic comment ${name} */\n`;
  const templateSegments = 1 + Math.floor(random() * 5);
  const templateType = `\`${Array.from(
    { length: templateSegments },
    (_, segment) => `${segment === 0 ? name : "-"}\${Extract<keyof T, string>}`,
  ).join("")}\``;

  return [
    commentKind,
    `interface ${name} { readonly value: string; }`,
    `type Nested${index} = ${genericType};`,
    `type Template${index}<T extends Record<string, unknown>> = ${templateType};`,
    `type Mapped${index}<T> = { readonly [K in keyof T as \`get\${Capitalize<string & K>}\`]?: T[K] };`,
    `declare const value${index}: Mapped${index}<Nested${index}>;`,
  ].join("\n");
}

function assertSourceFreeDeclarationLimitError(
  declarations: string,
  expectedCode: string,
  markers: string[],
): void {
  assert.throws(
    () => parseDependencyDeclarations({
      declarations,
      fileName: "dependency-package.d.ts",
      label: declarationLabel,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        `${declarationLabel} is invalid: ${expectedCode}`,
      );
      for (const marker of markers) {
        assert.equal(error.message.includes(marker), false);
      }
      return true;
    },
  );
}

function createRandomJsonValue(
  random: () => number,
  depth = 0,
): unknown {
  const escapedStrings = [
    "",
    "plain",
    "\"quoted\"",
    "\\slash/\b\f\n\r\t",
    "\u0000\u001f",
    "unicode-\u2028-\u2029-\ud800-\udfff-\ud83d\ude80",
  ];
  const primitive = (): unknown => {
    switch (Math.floor(random() * 5)) {
      case 0: return null;
      case 1: return random() < 0.5;
      case 2: {
        const exponent = Math.floor(random() * 617) - 308;
        const value = (random() - 0.5) * Number(`1e${exponent}`);
        return Number.isFinite(value) ? value : 0;
      }
      default: return escapedStrings[Math.floor(random() * escapedStrings.length)];
    }
  };
  if (depth >= 7 || random() < 0.55) return primitive();
  if (random() < 0.5) {
    return Array.from(
      { length: Math.floor(random() * 5) },
      () => createRandomJsonValue(random, depth + 1),
    );
  }
  return Object.fromEntries(Array.from(
    { length: Math.floor(random() * 5) },
    (_, index) => [
      `${escapedStrings[Math.floor(random() * escapedStrings.length)]}-${index}`,
      createRandomJsonValue(random, depth + 1),
    ],
  ));
}

function assertSourceSafePackageError(
  contents: string,
  expectedLine: number,
  expectedColumn: number,
  markers: string[] = [],
): void {
  assert.throws(
    () => parseDependencyPackageJson({ contents, label: packageLabel }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        `${packageLabel} is invalid: DEPENDENCY_PACKAGE_JSON_INVALID at ${expectedLine}:${expectedColumn}`,
      );
      for (const marker of markers) {
        assert.ok(marker.length > 0);
        assert.equal(
          error.message.includes(marker),
          false,
          `Diagnostic exposed fixture source marker ${JSON.stringify(marker)}`,
        );
      }
      return true;
    },
  );
}

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
        /^Installed dependency declarations is invalid: DEPENDENCY_DECLARATIONS_INVALID_SYNTAX TS\d+ at 3:12$/,
      );
      assert.doesNotMatch(error.message, new RegExp(privateContent));
      assert.doesNotMatch(error.message, /interface DependencyOptions|broken\?:/);
      return true;
    },
  );
});

test("dependency declaration parser enforces a deterministic UTF-8 size limit", () => {
  const accepted = `/*${"a".repeat(MAX_DEPENDENCY_DECLARATION_BYTES - 4)}*/`;
  parseDependencyDeclarations({
    declarations: accepted,
    fileName: "dependency-package.d.ts",
    label: declarationLabel,
  });

  const privateContent = "DO_NOT_REVEAL_OVERSIZE_DECLARATION";
  assert.throws(
    () => parseDependencyDeclarations({
      declarations: `${accepted}${privateContent}`,
      fileName: "dependency-package.d.ts",
      label: declarationLabel,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        `${declarationLabel} is invalid: DEPENDENCY_DECLARATIONS_TOO_LARGE`,
      );
      assert.doesNotMatch(error.message, new RegExp(privateContent));
      return true;
    },
  );
});

test("dependency declaration parser enforces a deterministic token limit", () => {
  const accepted = ";".repeat(MAX_DEPENDENCY_DECLARATION_TOKENS);
  parseDependencyDeclarations({
    declarations: accepted,
    fileName: "dependency-package.d.ts",
    label: declarationLabel,
  });

  const privateContent = "DO_NOT_REVEAL_TOKEN_HEAVY_DECLARATION";
  assert.throws(
    () => parseDependencyDeclarations({
      declarations: `${accepted};/*${privateContent}*/`,
      fileName: "dependency-package.d.ts",
      label: declarationLabel,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        `${declarationLabel} is invalid: DEPENDENCY_DECLARATIONS_TOO_MANY_TOKENS`,
      );
      assert.doesNotMatch(error.message, new RegExp(privateContent));
      return true;
    },
  );
});

test("dependency declaration parser enforces a deterministic nesting limit", () => {
  const accepted = `type Safe = ${"(".repeat(MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH)}string${")".repeat(MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH)};`;
  parseDependencyDeclarations({
    declarations: accepted,
    fileName: "dependency-package.d.ts",
    label: declarationLabel,
  });

  const privateContent = "DO_NOT_REVEAL_OVERDEEP_DECLARATION";
  assert.throws(
    () => parseDependencyDeclarations({
      declarations: `type ${privateContent} = (${accepted}`,
      fileName: "dependency-package.d.ts",
      label: declarationLabel,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        `${declarationLabel} is invalid: DEPENDENCY_DECLARATIONS_TOO_DEEP`,
      );
      assert.doesNotMatch(error.message, new RegExp(privateContent));
      return true;
    },
  );
});

test("dependency declaration parser bounds recursive type grammar without nested delimiters", () => {
  const accepted = `type Safe = ${"() => ".repeat(MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH)}string;`;
  parseDependencyDeclarations({
    declarations: accepted,
    fileName: "dependency-package.d.ts",
    label: declarationLabel,
  });

  const privateContent = "DO_NOT_REVEAL_RECURSIVE_TYPE_DECLARATION";
  const rejectedArrow = `type ${privateContent} = ${"() => ".repeat(MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH + 1)}string;`;
  const rejectedConditional = `type ${privateContent}<T> = ${"T extends string ? string : ".repeat(MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH + 1)}T;`;
  for (const declarations of [rejectedArrow, rejectedConditional]) {
    assert.throws(
      () => parseDependencyDeclarations({
        declarations,
        fileName: "dependency-package.d.ts",
        label: declarationLabel,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          `${declarationLabel} is invalid: DEPENDENCY_DECLARATIONS_TOO_DEEP`,
        );
        assert.doesNotMatch(error.message, new RegExp(privateContent));
        return true;
      },
    );
  }
});

test("dependency declaration parser accepts deterministic complex valid syntax below every limit", () => {
  const random = createDeterministicRandom(0xdec1a7e);
  for (let index = 0; index < 250; index += 1) {
    const declarations = createDeclarationCorpusCase(random, index);
    assert.ok(
      Buffer.byteLength(declarations, "utf8") < MAX_DEPENDENCY_DECLARATION_BYTES,
    );
    assertDeclarationAccepted(declarations, `complex-corpus-${index}`);
  }

  const complexTail = "type Café<T> = { readonly [K in keyof T]?: `${string & K}-東京` };";
  const tokenBoundary = `${";".repeat(
    MAX_DEPENDENCY_DECLARATION_TOKENS - countTypeScriptTokens(complexTail),
  )}${complexTail}`;
  assert.equal(
    countTypeScriptTokens(tokenBoundary),
    MAX_DEPENDENCY_DECLARATION_TOKENS,
  );
  assertDeclarationAccepted(tokenBoundary, "complex-token-boundary");

  const nestingBoundary = `type Živeli = ${"ReadonlyArray<".repeat(MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH)}string${">".repeat(MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH)};`;
  assertDeclarationAccepted(nestingBoundary, "complex-nesting-boundary");
});

test("complex declaration mutations keep limit diagnostics stable and source-free", () => {
  const tokenMarker = "DO_NOT_REVEAL_COMPLEX_TOKEN_MUTATION";
  const tokenMutation = `${";".repeat(MAX_DEPENDENCY_DECLARATION_TOKENS + 1)}/* ${tokenMarker} 東京 */`;
  assertSourceFreeDeclarationLimitError(
    tokenMutation,
    "DEPENDENCY_DECLARATIONS_TOO_MANY_TOKENS",
    [tokenMarker, "東京"],
  );

  const depthMarker = "DO_NOT_REVEAL_COMPLEX_DEPTH_MUTATION";
  const depthMutation = [
    `/* ${depthMarker} Živeli */`,
    `type TooDeep = ${"ReadonlyArray<".repeat(MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH + 1)}string${">".repeat(MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH + 1)};`,
  ].join("\n");
  assertSourceFreeDeclarationLimitError(
    depthMutation,
    "DEPENDENCY_DECLARATIONS_TOO_DEEP",
    [depthMarker, "Živeli"],
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

test("dependency package parser accepts deterministic randomized native-valid JSON", () => {
  const random = createDeterministicRandom(0x5afe815);
  for (let index = 0; index < 500; index += 1) {
    const contents = JSON.stringify(createRandomJsonValue(random));
    const nativeValue = JSON.parse(contents);
    assert.deepEqual(
      parseDependencyPackageJson({ contents, label: packageLabel }),
      nativeValue,
      `Safe parser rejected randomized native-valid JSON case ${index}`,
    );
  }

  const deeplyNested = `${"[".repeat(MAX_DEPENDENCY_PACKAGE_NESTING_DEPTH)}"deep-marker"${"]".repeat(MAX_DEPENDENCY_PACKAGE_NESTING_DEPTH)}`;
  assert.deepEqual(
    parseDependencyPackageJson({ contents: deeplyNested, label: packageLabel }),
    JSON.parse(deeplyNested),
  );
});

test("dependency package parser enforces a deterministic UTF-8 size limit", () => {
  const accepted = `"${"a".repeat(MAX_DEPENDENCY_PACKAGE_BYTES - 2)}"`;
  assert.equal(
    parseDependencyPackageJson({ contents: accepted, label: packageLabel }),
    "a".repeat(MAX_DEPENDENCY_PACKAGE_BYTES - 2),
  );

  const privateContent = "DO_NOT_REVEAL_OVERSIZE_PACKAGE_CONTENT";
  const rejected = `${accepted} ${privateContent}`;
  assert.throws(
    () => parseDependencyPackageJson({ contents: rejected, label: packageLabel }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        `${packageLabel} is invalid: DEPENDENCY_PACKAGE_JSON_TOO_LARGE`,
      );
      assert.doesNotMatch(error.message, new RegExp(privateContent));
      return true;
    },
  );
});

test("dependency package parser enforces a deterministic nesting limit", () => {
  const privateContent = "DO_NOT_REVEAL_OVERDEEP_PACKAGE_CONTENT";
  const accepted = `${"[".repeat(MAX_DEPENDENCY_PACKAGE_NESTING_DEPTH)}"${privateContent}"${"]".repeat(MAX_DEPENDENCY_PACKAGE_NESTING_DEPTH)}`;
  assert.deepEqual(
    parseDependencyPackageJson({ contents: accepted, label: packageLabel }),
    JSON.parse(accepted),
  );

  const rejected = `[${accepted}]`;
  assert.throws(
    () => parseDependencyPackageJson({ contents: rejected, label: packageLabel }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        `${packageLabel} is invalid: DEPENDENCY_PACKAGE_JSON_TOO_DEEP`,
      );
      assert.doesNotMatch(error.message, new RegExp(privateContent));
      return true;
    },
  );
});

test("dependency package diagnostics stay source-free across malformed edge cases", () => {
  const fixtures = [
    { contents: '{"n":01,"secret":"LEAK_NUMBER"}', line: 1, column: 7, markers: ["LEAK_NUMBER", '"n":01'] },
    { contents: '{"escape":"\\x","secret":"LEAK_ESCAPE"}', line: 1, column: 13, markers: ["LEAK_ESCAPE", "\\x"] },
    { contents: '{"unicode":"\\u12G4","secret":"LEAK_UNICODE"}', line: 1, column: 17, markers: ["LEAK_UNICODE", "\\u12G4"] },
    { contents: '{"truncated":"LEAK_TRUNCATED', line: 1, column: 29, markers: ["LEAK_TRUNCATED", "truncated"] },
    { contents: '{"a":[[[{"private":"LEAK_DEEP"}]]]', line: 1, column: 35, markers: ["LEAK_DEEP", "private"] },
    { contents: '{"a":1,// LEAK_COMMENT\r\n"b":2}', line: 1, column: 8, markers: ["LEAK_COMMENT", "//"] },
    { contents: '{"a":1,\r\n}', line: 2, column: 1, markers: ['"a":1'] },
    { contents: '{"a":1,\r}', line: 2, column: 1, markers: ['"a":1'] },
    { contents: '{"a":1,\u2028}', line: 1, column: 8, markers: ['"a":1'] },
    { contents: '{"a":1,\u2029}', line: 1, column: 8, markers: ['"a":1'] },
    { contents: '["LEAK_ARRAY",]', line: 1, column: 15, markers: ["LEAK_ARRAY"] },
    { contents: '{"secret":"LEAK_VALUE","value":truee}', line: 1, column: 36, markers: ["LEAK_VALUE", "truee"] },
  ];

  for (const fixture of fixtures) {
    assert.throws(() => JSON.parse(fixture.contents));
    assertSourceSafePackageError(
      fixture.contents,
      fixture.line,
      fixture.column,
      fixture.markers,
    );
  }
});
