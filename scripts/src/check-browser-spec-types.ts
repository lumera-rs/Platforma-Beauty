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

interface BrowserProgram {
  program: ts.Program;
  rootNames: string[];
}

function loadBrowserProgram(rootNames?: string[]): BrowserProgram {
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

  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => {
      if (!diagnostic.file) {
        return false;
      }
      const fileName = path.resolve(diagnostic.file.fileName);
      return (
        fileName === diagnosticRoot
        || fileName.startsWith(diagnosticPrefix)
        || diagnosticFiles.has(fileName)
      );
    });
}

export function runBrowserSpecTypeCheck(): void {
  const diagnostics = collectBrowserSpecDiagnostics();
  if (diagnostics.length > 0) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost));
    throw new Error("Browser spec type checks failed.");
  }
  console.info("Browser spec types are valid.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runBrowserSpecTypeCheck();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}