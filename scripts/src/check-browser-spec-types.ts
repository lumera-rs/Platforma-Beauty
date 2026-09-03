import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptsRoot = path.resolve(import.meta.dirname, "..");
const browserRoot = path.join(scriptsRoot, "browser");
const configPath = path.join(scriptsRoot, "tsconfig.browser.json");

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => scriptsRoot,
  getNewLine: () => ts.sys.newLine,
};

interface BrowserSpecTypeCheckOptions {
  rootNames?: string[];
  diagnosticRoot?: string;
}

interface BrowserConfigCoverageOptions {
  scriptsRoot?: string;
  configPath?: string;
}

interface BrowserFileCoverageOptions extends BrowserConfigCoverageOptions {
  browserRoot?: string;
}

interface BrowserProgram {
  program: ts.Program;
  rootNames: string[];
}

const browserRunnerConfigPattern =
  /^playwright(?:\.[^.]+)*\.config\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const browserFileExtensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function collectBrowserRunnerConfigs(root: string): string[] {
  return ts.sys
    .readDirectory(
      root,
      browserFileExtensions,
      ["**/node_modules/**"],
      ["**/playwright*.config.*"],
    )
    .map((fileName) => path.resolve(fileName))
    .filter((fileName) =>
      browserRunnerConfigPattern.test(path.basename(fileName)),
    )
    .sort();
}

function unwrapConfigExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isCallExpression(expression) &&
    expression.arguments.length > 0 &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "defineConfig"
  ) {
    return expression.arguments[0];
  }
  return expression;
}

interface StaticResolver {
  sourceFile: ts.SourceFile;
  resolving: Set<string>;
  consumedFiles?: Set<string>;
}

interface StaticExpression {
  expression: ts.Expression;
  sourceFile: ts.SourceFile;
}

type StaticConfigValue =
  | { kind: "object"; properties: Map<string, StaticExpression> }
  | { kind: "string"; value: string };

function staticConfigError(configFileName: string, detail: string): Error {
  return new Error(
    `Browser runner config must use only statically resolvable const objects, object spreads, and string testDir values so coverage can be checked (${detail}): ${configFileName}`,
  );
}

function findConstInitializer(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Expression | undefined {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name
      ) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

interface PackageEntryResolution {
  entry?: string;
  blocksFallback: boolean;
}

function resolvePackageEntry(directory: string): PackageEntryResolution {
  const manifestPath = path.join(directory, "package.json");
  const manifestText = ts.sys.readFile(manifestPath);
  if (manifestText === undefined) {
    return { blocksFallback: false };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return { blocksFallback: false };
  }
  if (!manifest || typeof manifest !== "object") {
    return { blocksFallback: false };
  }
  const packageManifest = manifest as {
    exports?: unknown;
    main?: unknown;
  };
  const hasExports = Object.prototype.hasOwnProperty.call(
    packageManifest,
    "exports",
  );
  let entry: unknown;
  if (hasExports) {
    const exportsValue = packageManifest.exports;
    if (typeof exportsValue === "string") {
      entry = exportsValue;
    } else if (
      exportsValue &&
      typeof exportsValue === "object" &&
      !Array.isArray(exportsValue) &&
      Object.keys(exportsValue).length === 1 &&
      typeof (exportsValue as { "."?: unknown })["."] === "string"
    ) {
      entry = (exportsValue as { ".": string })["."];
    } else {
      return { blocksFallback: true };
    }
  } else {
    entry = packageManifest.main;
  }
  if (typeof entry !== "string" || !browserFileExtensions.includes(path.extname(entry))) {
    return { blocksFallback: hasExports };
  }
  const resolvedDirectory = path.resolve(directory);
  const resolvedEntry = path.resolve(resolvedDirectory, entry);
  const directoryPrefix = resolvedDirectory.endsWith(path.sep)
    ? resolvedDirectory
    : resolvedDirectory + path.sep;
  if (!resolvedEntry.startsWith(directoryPrefix)) {
    return { blocksFallback: hasExports };
  }
  return {
    entry: ts.sys.fileExists(resolvedEntry) ? resolvedEntry : undefined,
    blocksFallback: hasExports,
  };
}

function resolveRelativeImport(
  sourceFile: ts.SourceFile,
  localName: string,
  consumedFiles?: Set<string>,
): { sourceFile: ts.SourceFile; importedName: string } | undefined {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith(".")
    ) {
      continue;
    }
    let importedName: string | undefined;
    if (statement.importClause.name?.text === localName) {
      importedName = "default";
    } else {
      const binding = statement.importClause.namedBindings;
      if (binding && ts.isNamedImports(binding)) {
        const element = binding.elements.find(
          ({ name }) => name.text === localName,
        );
        importedName = element?.propertyName?.text ?? element?.name.text;
      }
    }
    if (!importedName) {
      continue;
    }
    const unresolved = path.resolve(
      path.dirname(sourceFile.fileName),
      statement.moduleSpecifier.text,
    );
    const packageEntry = resolvePackageEntry(unresolved);
    const candidates = browserFileExtensions.includes(path.extname(unresolved))
      ? [unresolved]
      : [
          ...browserFileExtensions.map((extension) => unresolved + extension),
          packageEntry.entry,
          ...(packageEntry.blocksFallback
            ? []
            : browserFileExtensions.map((extension) =>
                path.join(unresolved, `index${extension}`),
              )),
        ].filter((candidate): candidate is string => candidate !== undefined);
    const importedFileName = candidates.find(ts.sys.fileExists);
    if (!importedFileName) {
      return undefined;
    }
    const sourceText = ts.sys.readFile(importedFileName);
    if (sourceText === undefined) {
      return undefined;
    }
    consumedFiles?.add(path.resolve(importedFileName));
    return {
      sourceFile: ts.createSourceFile(
        importedFileName,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
      ),
      importedName,
    };
  }
  return undefined;
}

function resolveStaticIdentifier(
  identifier: ts.Identifier,
  resolver: StaticResolver,
  configFileName: string,
): StaticConfigValue {
  const key = `${resolver.sourceFile.fileName}:${identifier.text}`;
  if (resolver.resolving.has(key)) {
    throw staticConfigError(configFileName, `cyclic reference ${identifier.text}`);
  }
  resolver.resolving.add(key);
  try {
    const localInitializer = findConstInitializer(
      resolver.sourceFile,
      identifier.text,
    );
    if (localInitializer) {
      return resolveStaticValue(localInitializer, resolver, configFileName);
    }
    const imported = resolveRelativeImport(
      resolver.sourceFile,
      identifier.text,
      resolver.consumedFiles,
    );
    if (!imported) {
      throw staticConfigError(
        configFileName,
        `unresolvable identifier ${identifier.text}`,
      );
    }
    let initializer: ts.Expression | undefined;
    if (imported.importedName === "default") {
      const exported = imported.sourceFile.statements.find(
        (statement): statement is ts.ExportAssignment =>
          ts.isExportAssignment(statement) && !statement.isExportEquals,
      );
      initializer = exported?.expression;
    } else {
      initializer = findConstInitializer(imported.sourceFile, imported.importedName);
    }
    if (!initializer) {
      throw staticConfigError(
        configFileName,
        `imported value ${identifier.text} is not a const or default expression`,
      );
    }
    return resolveStaticValue(
      initializer,
      {
        sourceFile: imported.sourceFile,
        resolving: resolver.resolving,
        consumedFiles: resolver.consumedFiles,
      },
      configFileName,
    );
  } finally {
    resolver.resolving.delete(key);
  }
}

function resolveStaticValue(
  expression: ts.Expression,
  resolver: StaticResolver,
  configFileName: string,
): StaticConfigValue {
  const unwrapped = unwrapConfigExpression(expression);
  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return { kind: "string", value: unwrapped.text };
  }
  if (ts.isIdentifier(unwrapped)) {
    return resolveStaticIdentifier(unwrapped, resolver, configFileName);
  }
  if (!ts.isObjectLiteralExpression(unwrapped)) {
    throw staticConfigError(configFileName, "runtime-dependent expression");
  }
  const properties = new Map<string, StaticExpression>();
  for (const property of unwrapped.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = resolveStaticValue(
        property.expression,
        resolver,
        configFileName,
      );
      if (spread.kind !== "object") {
        throw staticConfigError(configFileName, "spread value is not an object");
      }
      for (const [name, initializer] of spread.properties) {
        properties.set(name, initializer);
      }
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(property.name.text, {
        expression: property.name,
        sourceFile: resolver.sourceFile,
      });
      continue;
    }
    if (
      !ts.isPropertyAssignment(property) ||
      (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
    ) {
      throw staticConfigError(configFileName, "unsupported object property");
    }
    properties.set(property.name.text, {
      expression: property.initializer,
      sourceFile: resolver.sourceFile,
    });
  }
  return { kind: "object", properties };
}

function readStaticBrowserConfig(
  configFileName: string,
  consumedFiles?: Set<string>,
): StaticConfigValue {
  const sourceText = ts.sys.readFile(configFileName);
  if (sourceText === undefined) {
    throw new Error(`Browser runner config could not be read: ${configFileName}`);
  }
  const sourceFile = ts.createSourceFile(
    configFileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const exportAssignment = sourceFile.statements.find(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  if (!exportAssignment) {
    throw new Error(
      `Browser runner config must have a default export so its testDir can be checked: ${configFileName}`,
    );
  }
  return resolveStaticValue(
    exportAssignment.expression,
    { sourceFile, resolving: new Set(), consumedFiles },
    configFileName,
  );
}

function readConfiguredTestDir(configFileName: string): string {
  const config = readStaticBrowserConfig(configFileName);
  if (config.kind !== "object") {
    throw staticConfigError(configFileName, "default export is not an object");
  }
  const testDirProperty = config.properties.get("testDir");
  if (!testDirProperty) {
    return path.dirname(configFileName);
  }
  const testDir = resolveStaticValue(
    testDirProperty.expression,
    { sourceFile: testDirProperty.sourceFile, resolving: new Set() },
    configFileName,
  );
  if (testDir.kind !== "string") {
    throw staticConfigError(configFileName, "testDir is not a static string");
  }
  return path.resolve(path.dirname(configFileName), testDir.value);
}

export function collectBrowserTestDirectories(
  options: BrowserConfigCoverageOptions = {},
): string[] {
  const root = path.resolve(options.scriptsRoot ?? scriptsRoot);
  return [
    ...new Set(
      collectBrowserRunnerConfigs(root).map((configFileName) =>
        readConfiguredTestDir(configFileName),
      ),
    ),
  ].sort();
}

function loadBrowserProgram(
  rootNames?: string[],
  root = scriptsRoot,
  projectPath = configPath,
): BrowserProgram {
  const configFile = ts.readConfigFile(projectPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, formatHost));
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    root,
    undefined,
    projectPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(ts.formatDiagnostics(parsed.errors, formatHost));
  }

  const programRootNames = rootNames ?? parsed.fileNames;
  return {
    program: ts.createProgram({
      rootNames: programRootNames,
      options: parsed.options,
      projectReferences: parsed.projectReferences,
    }),
    rootNames: programRootNames,
  };
}

export function collectUncoveredBrowserRunnerConfigs(
  options: BrowserConfigCoverageOptions = {},
): string[] {
  const root = path.resolve(options.scriptsRoot ?? scriptsRoot);
  const projectPath = path.resolve(options.configPath ?? configPath);
  const includedRoots = new Set(
    loadBrowserProgram(undefined, root, projectPath).rootNames.map((fileName) =>
      path.resolve(fileName),
    ),
  );

  return collectBrowserRunnerConfigs(root)
    .filter(
      (fileName) =>
        !includedRoots.has(fileName),
    )
    .sort();
}

export function collectUncoveredBrowserFiles(
  options: BrowserFileCoverageOptions = {},
): string[] {
  const root = path.resolve(options.scriptsRoot ?? scriptsRoot);
  const projectPath = path.resolve(options.configPath ?? configPath);
  const fileRoots = options.browserRoot
    ? [path.resolve(options.browserRoot)]
    : collectBrowserTestDirectories({ scriptsRoot: root });
  const includedRoots = new Set(
    loadBrowserProgram(undefined, root, projectPath).rootNames.map((fileName) =>
      path.resolve(fileName),
    ),
  );

  return fileRoots
    .flatMap((filesRoot) =>
      ts.sys.readDirectory(filesRoot, browserFileExtensions, [
        "**/node_modules/**",
      ]),
    )
    .map((fileName) => path.resolve(fileName))
    .filter((fileName) => !includedRoots.has(fileName))
    .filter((fileName, index, files) => files.indexOf(fileName) === index)
    .sort();
}

export function collectBrowserSpecDiagnostics(
  options: BrowserSpecTypeCheckOptions = {},
): ts.Diagnostic[] {
  const diagnosticRoot = path.resolve(options.diagnosticRoot ?? browserRoot);
  const diagnosticPrefix = diagnosticRoot.endsWith(path.sep)
    ? diagnosticRoot
    : diagnosticRoot + path.sep;
  let { program, rootNames } = loadBrowserProgram(options.rootNames);
  const diagnosticFiles = new Set(
    rootNames
      .map((fileName) => path.resolve(fileName))
      .filter(
        (fileName) =>
          fileName !== diagnosticRoot && !fileName.startsWith(diagnosticPrefix),
      ),
  );
  for (const rootName of rootNames) {
    const resolvedRootName = path.resolve(rootName);
    if (!browserRunnerConfigPattern.test(path.basename(resolvedRootName))) {
      continue;
    }
    const sourceText = ts.sys.readFile(resolvedRootName);
    if (sourceText === undefined) {
      continue;
    }
    const sourceFile = ts.createSourceFile(
      resolvedRootName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
    );
    const hasDefaultExport = sourceFile.statements.some(
      (statement) =>
        ts.isExportAssignment(statement) && !statement.isExportEquals,
    );
    if (hasDefaultExport) {
      readStaticBrowserConfig(resolvedRootName, diagnosticFiles);
    }
  }
  const additionalRoots = [...diagnosticFiles].filter(
    (fileName) => !rootNames.some((rootName) => path.resolve(rootName) === fileName),
  );
  if (additionalRoots.length > 0) {
    ({ program, rootNames } = loadBrowserProgram([
      ...rootNames,
      ...additionalRoots,
    ]));
  }

  return ts.getPreEmitDiagnostics(program).filter((diagnostic) => {
    if (!diagnostic.file) {
      return false;
    }
    const fileName = path.resolve(diagnostic.file.fileName);
    return (
      fileName === diagnosticRoot ||
      fileName.startsWith(diagnosticPrefix) ||
      diagnosticFiles.has(fileName)
    );
  });
}

export function runBrowserSpecTypeCheck(): void {
  const uncoveredConfigs = collectUncoveredBrowserRunnerConfigs();
  if (uncoveredConfigs.length > 0) {
    const relativeConfigs = uncoveredConfigs
      .map((fileName) => path.relative(scriptsRoot, fileName))
      .join(", ");
    throw new Error(
      `Browser runner configs are missing from tsconfig.browser.json: ${relativeConfigs}`,
    );
  }

  const uncoveredBrowserFiles = collectUncoveredBrowserFiles();
  if (uncoveredBrowserFiles.length > 0) {
    const relativeFiles = uncoveredBrowserFiles
      .map((fileName) => path.relative(scriptsRoot, fileName))
      .join(", ");
    throw new Error(
      `Browser test or fixture files under a Playwright testDir are missing from tsconfig.browser.json: ${relativeFiles}`,
    );
  }

  const diagnostics = collectBrowserSpecDiagnostics();
  if (diagnostics.length > 0) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost),
    );
    throw new Error("Browser spec type checks failed.");
  }
  console.info("Browser spec types are valid.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    runBrowserSpecTypeCheck();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
