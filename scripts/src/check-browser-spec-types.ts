import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptsRoot = path.resolve(import.meta.dirname, "..");
const browserRoot = path.join(scriptsRoot, "browser");
const configPath = path.join(scriptsRoot, "tsconfig.browser.json");
const importAndIdentifierDiagnosticCodes = new Set([
  1192, // Module has no default export.
  2304, // Cannot find name.
  2305, // Module has no exported member.
  2307, // Cannot find module.
  2552, // Cannot find name. Did you mean ...?
  2581, // Cannot find name '$'.
  2592, // Cannot find name. Install type definitions?
  2724, // Module has no exported member. Did you mean ...?
  18004, // No value exists in scope for a shorthand property.
]);

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => scriptsRoot,
  getNewLine: () => ts.sys.newLine,
};

interface BrowserSpecTypeCheckOptions {
  rootNames?: string[];
  diagnosticRoot?: string;
}

function loadBrowserProgram(rootNames?: string[]): ts.Program {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, formatHost));
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    scriptsRoot,
    undefined,
    configPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(ts.formatDiagnostics(parsed.errors, formatHost));
  }

  return ts.createProgram({
    rootNames: rootNames ?? parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
}

export function collectBrowserSpecImportDiagnostics(
  options: BrowserSpecTypeCheckOptions = {},
): ts.Diagnostic[] {
  const diagnosticRoot = path.resolve(options.diagnosticRoot ?? browserRoot);
  const diagnosticPrefix = diagnosticRoot.endsWith(path.sep)
    ? diagnosticRoot
    : diagnosticRoot + path.sep;

  return ts
    .getPreEmitDiagnostics(loadBrowserProgram(options.rootNames))
    .filter((diagnostic) => {
      if (!diagnostic.file || !importAndIdentifierDiagnosticCodes.has(diagnostic.code)) {
        return false;
      }
      const fileName = path.resolve(diagnostic.file.fileName);
      return fileName === diagnosticRoot || fileName.startsWith(diagnosticPrefix);
    });
}

export function runBrowserSpecTypeCheck(): void {
  const diagnostics = collectBrowserSpecImportDiagnostics();
  if (diagnostics.length > 0) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
    throw new Error("Browser spec import and identifier checks failed.");
  }
  console.info("Browser spec imports and identifiers are valid.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runBrowserSpecTypeCheck();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}