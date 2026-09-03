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

function readConfiguredTestDir(configFileName: string): string {
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
  const configExpression = unwrapConfigExpression(exportAssignment.expression);
  if (!ts.isObjectLiteralExpression(configExpression)) {
    throw new Error(
      `Browser runner config must default-export an object or defineConfig({...}) so its testDir can be checked: ${configFileName}`,
    );
  }
  const testDirProperty = configExpression.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === "testDir") ||
        (ts.isStringLiteral(property.name) && property.name.text === "testDir")),
  );
  if (!testDirProperty) {
    return path.dirname(configFileName);
  }
  if (
    !ts.isStringLiteral(testDirProperty.initializer) &&
    !ts.isNoSubstitutionTemplateLiteral(testDirProperty.initializer)
  ) {
    throw new Error(
      `Browser runner config testDir must be a static string so coverage can be checked: ${configFileName}`,
    );
  }
  return path.resolve(
    path.dirname(configFileName),
    testDirProperty.initializer.text,
  );
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
  const { program, rootNames } = loadBrowserProgram(options.rootNames);
  const diagnosticFiles = new Set(
    rootNames
      .map((fileName) => path.resolve(fileName))
      .filter(
        (fileName) =>
          fileName !== diagnosticRoot && !fileName.startsWith(diagnosticPrefix),
      ),
  );

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
