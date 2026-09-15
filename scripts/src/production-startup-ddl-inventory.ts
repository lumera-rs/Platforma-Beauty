/**
 * Production boot DDL inventory (Phase 2).
 *
 * This checker is intentionally source-only.  It parses the real startup
 * entrypoint with the TypeScript compiler API and never imports API modules or
 * opens a database connection.  The graph walker is conservative: a local
 * unresolved edge, or a non-literal import()/require(), is a failure.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PRODUCTION_STARTUP_ROOT = "artifacts/api-server/src/index.ts";

export const EXPECTED_STARTUP_DDL_ROOTS = Object.freeze([
  "ensureBusinessGrowthSchema",
  "ensureMediaSchema",
  "ensureShippingConfigSchema",
  "ensureMarketplacePerformanceIndexes",
  "ensureReferralSchema",
  "ensureWebPushSchema",
  "ensureBookingCommandSchema",
  "ensureEducationBundlePurchaseSchema",
]);

type DependencyKind = "import" | "export" | "import-equals" | "import-type" | "require" | "dynamic-import";
type ViolationReason =
  | "missing-root"
  | "parse-error"
  | "non-literal-dynamic-import"
  | "non-literal-require"
  | "unresolved-local-dependency"
  | "unexpected-startup-ddl-root"
  | "missing-startup-ddl-root"
  | "owner-mismatch"
  | "inventory-mismatch"
  | "unknown-dynamic-sql";

export interface DdlOperation {
  readonly kind: string;
  readonly summary: string;
  readonly fingerprint: string;
  readonly module: string;
  readonly callSite?: string;
  readonly phase?: "pre-listen" | "post-listen";
  readonly path?: readonly string[];
}

export interface StartupDdlOwner {
  readonly ensureName: string;
  readonly ownerModule: string;
  readonly operations: readonly DdlOperation[];
  readonly callSite?: string;
  readonly phase?: "pre-listen" | "post-listen";
  readonly path?: readonly string[];
}

export interface StartupDdlBaseline {
  readonly version: 1;
  readonly startupRoot: string;
  readonly owners: readonly StartupDdlOwner[];
}

export interface StartupDdlViolation {
  readonly reason: ViolationReason;
  readonly module: string;
  readonly detail: string;
  readonly path: readonly string[];
}

export interface StartupDdlInventoryReport {
  readonly startupRoot: string;
  readonly owners: readonly StartupDdlOwner[];
  readonly scannedModules: number;
  readonly scannedReferences: number;
  readonly violations: readonly StartupDdlViolation[];
  readonly matchesBaseline: boolean;
  readonly version?: 1;
}

export interface StartupDdlInventoryOptions {
  readonly repositoryRoot?: string;
  readonly moduleSources?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  readonly baseline?: StartupDdlBaseline;
  readonly rootFile?: string;
}

interface ModuleEntry {
  readonly canonical: string;
  readonly source: string;
}

interface Reference {
  readonly kind: DependencyKind;
  readonly literal: boolean;
  readonly specifier?: string;
}

interface Edge {
  readonly from: string;
  readonly to?: string;
  readonly specifier: string;
  readonly kind: DependencyKind;
}

interface QueueItem {
  readonly module: string;
  readonly path: readonly string[];
  readonly edges: readonly Edge[];
}

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;

function posix(value: string): string {
  return value.replaceAll("\\", "/");
}

function virtualPath(value: string): string {
  return path.posix.normalize(posix(value)).replace(/^\.\/+/u, "");
}

function sourceKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function candidates(base: string): string[] {
  const normalized = posix(base);
  const known = EXTENSIONS.some((extension) => normalized.endsWith(extension));
  return [
    normalized,
    ...(known ? [] : EXTENSIONS.map((extension) => `${normalized}${extension}`)),
    ...EXTENSIONS.map((extension) => `${normalized}/index${extension}`),
  ];
}

function entriesFor(
  sources: StartupDdlInventoryOptions["moduleSources"],
): Map<string, ModuleEntry> {
  const entries = new Map<string, ModuleEntry>();
  if (!sources) return entries;
  const values = sources instanceof Map ? sources.entries() : Object.entries(sources);
  for (const [name, source] of values) {
    const canonical = virtualPath(name);
    entries.set(canonical, { canonical, source });
  }
  return entries;
}

function isLiteral(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function referencesIn(sourceFile: ts.SourceFile): Reference[] {
  const result: Reference[] = [];
  const seen = new Set<string>();
  const add = (reference: Reference): void => {
    const key = `${reference.kind}:${reference.literal ? reference.specifier : "<non-literal>"}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(reference);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isLiteral(node.moduleSpecifier)) {
      add({ kind: "import", literal: true, specifier: node.moduleSpecifier.text });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && isLiteral(node.moduleSpecifier)) {
      add({ kind: "export", literal: true, specifier: node.moduleSpecifier.text });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      add(expression && isLiteral(expression)
        ? { kind: "import-equals", literal: true, specifier: expression.text }
        : { kind: "import-equals", literal: false });
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      add(ts.isLiteralTypeNode(argument) && isLiteral(argument.literal)
        ? { kind: "import-type", literal: true, specifier: argument.literal.text }
        : { kind: "import-type", literal: false });
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        add(argument && isLiteral(argument)
          ? { kind: "dynamic-import", literal: true, specifier: argument.text }
          : { kind: "dynamic-import", literal: false });
      } else if (
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
        || (ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.name) && node.expression.name.text === "require")
      ) {
        const argument = node.arguments[0];
        add(argument && isLiteral(argument)
          ? { kind: "require", literal: true, specifier: argument.text }
          : { kind: "require", literal: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function readCandidate(candidate: string): string | undefined {
  for (const file of candidates(candidate)) {
    if (existsSync(file) && statSync(file).isFile()) return path.resolve(file);
  }
  return undefined;
}

function workspacePackageTarget(
  specifier: string,
  repositoryRoot: string,
): string | undefined {
  if (!specifier.startsWith("@workspace/")) return undefined;
  const packageName = specifier.split("/").slice(0, 2).join("/");
  const suffix = specifier.slice(packageName.length).replace(/^\/+/u, "");
  for (const parent of ["lib", "artifacts", "scripts"]) {
    const parentPath = path.resolve(repositoryRoot, parent);
    if (!existsSync(parentPath) || !statSync(parentPath).isDirectory()) continue;
    const children = parent === "scripts"
      ? [parentPath]
      : readdirSync(parentPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(parentPath, entry.name));
    for (const packageRoot of children) {
      const manifestPath = path.join(packageRoot, "package.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          name?: unknown;
          exports?: Record<string, unknown> | string;
        };
        if (manifest.name === packageName) {
          const subpath = suffix ? `./${suffix}` : ".";
          const configured = typeof manifest.exports === "object" && manifest.exports !== null
            ? manifest.exports[subpath]
            : (subpath === "." && typeof manifest.exports === "string" ? manifest.exports : undefined);
          if (typeof configured === "string") return path.resolve(packageRoot, configured);
          return path.resolve(packageRoot, suffix || "src/index.ts");
        }
      } catch {
        // An unreadable package is treated as an external dependency.
      }
    }
  }
  return undefined;
}

function resolve(
  from: string,
  specifier: string,
  repositoryRoot: string,
  virtualSources: ReadonlyMap<string, ModuleEntry>,
): string | undefined {
  const fromVirtual = virtualSources.has(from);
  for (const candidate of candidates(specifier)) {
    const direct = virtualSources.get(virtualPath(candidate));
    if (direct) return direct.canonical;
  }
  const bases: string[] = [];
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    bases.push(fromVirtual
      ? virtualPath(specifier.startsWith(".") ? path.posix.join(path.posix.dirname(from), specifier) : specifier)
      : path.resolve(specifier.startsWith(".") ? path.dirname(from) : repositoryRoot, specifier));
  } else {
    const packageTarget = workspacePackageTarget(specifier, repositoryRoot);
    if (packageTarget) bases.push(packageTarget);
  }
  for (const base of bases) {
    for (const candidate of candidates(base)) {
      const virtual = virtualSources.get(virtualPath(candidate));
      if (virtual) return virtual.canonical;
      if (!fromVirtual) {
        const real = readCandidate(candidate);
        if (real) return real;
      }
    }
  }
  return undefined;
}

function resolveRoot(
  root: string,
  repositoryRoot: string,
  virtualSources: ReadonlyMap<string, ModuleEntry>,
): string | undefined {
  for (const candidate of candidates(root)) {
    const virtual = virtualSources.get(virtualPath(candidate));
    if (virtual) return virtual.canonical;
  }
  if (virtualSources.size > 0) return undefined;
  return readCandidate(path.isAbsolute(root) ? root : path.resolve(repositoryRoot, root));
}

function sourceFor(module: string, virtualSources: ReadonlyMap<string, ModuleEntry>): string | undefined {
  if (virtualSources.size > 0) return virtualSources.get(module)?.source;
  try {
    return readFileSync(module, "utf8");
  } catch {
    return undefined;
  }
}

function relativeModule(module: string, repositoryRoot: string): string {
  return virtualPath(module.startsWith(repositoryRoot) ? path.relative(repositoryRoot, module) : module);
}

function normalizeSql(value: string): string {
  return value
    .replace(/\$\{([^}]*)\}/gu, (_match, expression: string) => `\${${expression.trim()}}`)
    .replace(/--[^\n]*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function fingerprint(kind: string, operation: string, sql: string): string {
  return createHash("sha256")
    .update(`${kind}\0${normalizeSql(operation)}\0${normalizeSql(sql)}`)
    .digest("hex");
}

interface OperationPattern {
  readonly kind: string;
  readonly expression: RegExp;
}

/*
 * These expressions deliberately describe SQL operations, not ensure-style
 * function names.  They also see DDL nested in DO blocks and SQL templates.
 */
const OPERATION_PATTERNS: readonly OperationPattern[] = [
  { kind: "create-table", expression: /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "drop-table", expression: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "create-index", expression: /\bCREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(;,]+(?:\s+ON\s+[^\s(;,]+)/giu },
  { kind: "drop-index", expression: /\bDROP\s+INDEX(?:\s+CONCURRENTLY)?\s+(?:IF\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "create-trigger", expression: /\bCREATE\s+TRIGGER\s+[^\s(;,]+/giu },
  { kind: "drop-trigger", expression: /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "create-type", expression: /\bCREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "drop-type", expression: /\bDROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?[^\s(;,]+/giu },
  { kind: "alter-type", expression: /\bALTER\s+TYPE\s+[^\s;,]+(?:\s+ADD\s+VALUE(?:\s+IF\s+NOT\s+EXISTS)?\s+[^;]+)?/giu },
  { kind: "create-extension", expression: /\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s;,]+/giu },
  { kind: "add-constraint", expression: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s;,]+\s+ADD\s+CONSTRAINT\s+[^\s;,]+/giu },
  { kind: "drop-constraint", expression: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s;,]+\s+DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?[^\s;,]+/giu },
  { kind: "validate-constraint", expression: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s;,]+\s+VALIDATE\s+CONSTRAINT\s+[^\s;,]+/giu },
  { kind: "alter-table", expression: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[^\s;,]+\s+(?!(?:ADD|DROP|VALIDATE)\s+CONSTRAINT\b)[^;]+/giu },
];

function operationsInLiteral(raw: string, module: string): DdlOperation[] {
  const operations: DdlOperation[] = [];
  for (const pattern of OPERATION_PATTERNS) {
    pattern.expression.lastIndex = 0;
    for (const match of raw.matchAll(pattern.expression)) {
      const summary = normalizeSql(match[0]!).slice(0, 240);
      operations.push({
        kind: pattern.kind,
        summary,
        fingerprint: fingerprint(pattern.kind, match[0]!, raw),
        module,
      });
    }
  }
  return operations;
}

function operationsInSource(sourceFile: ts.SourceFile, module: string): DdlOperation[] {
  const operations: DdlOperation[] = [];
  const visit = (node: ts.Node): void => {
    let raw: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) raw = node.text;
    else if (ts.isTemplateExpression(node)) {
      const text = node.getText(sourceFile);
      raw = text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : text;
    }
    if (raw !== undefined) operations.push(...operationsInLiteral(raw, module));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return operations;
}

function parse(source: string, module: string): ts.SourceFile {
  return ts.createSourceFile(module, source, ts.ScriptTarget.Latest, true, sourceKind(module));
}

interface ImportedOwner {
  readonly specifier: string;
  readonly importedName: string;
}

function importedOwners(sourceFile: ts.SourceFile): Map<string, ImportedOwner> {
  const owners = new Map<string, ImportedOwner>();
  for (const declaration of sourceFile.statements) {
    if (!ts.isImportDeclaration(declaration) || !isLiteral(declaration.moduleSpecifier)) continue;
    const clause = declaration.importClause;
    if (!clause) continue;
    if (clause.name) {
      owners.set(clause.name.text, {
        specifier: declaration.moduleSpecifier.text,
        importedName: "default",
      });
    }
    if (!clause.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      owners.set(clause.namedBindings.name.text, {
        specifier: declaration.moduleSpecifier.text,
        importedName: "*",
      });
      continue;
    }
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      owners.set(element.name.text, {
        specifier: declaration.moduleSpecifier.text,
        importedName: element.propertyName?.text ?? element.name.text,
      });
    }
  }
  return owners;
}

function startupCalls(sourceFile: ts.SourceFile, owners: ReadonlyMap<string, ImportedOwner>): Map<string, string> {
  const calls = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && owners.has(node.expression.text)) {
      calls.set(node.expression.text, node.expression.text);
    } else if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && owners.has(node.expression.expression.text)
    ) {
      calls.set(node.expression.name.text, node.expression.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function expectedImportName(
  local: string,
  calledName: string,
  owners: ReadonlyMap<string, ImportedOwner>,
): string | undefined {
  const importedName = owners.get(local)?.importedName;
  for (const expected of EXPECTED_STARTUP_DDL_ROOTS) {
    if (importedName === expected || (importedName === "*" && calledName === expected)) return expected;
  }
  return undefined;
}

function scanGraph(
  root: string,
  repositoryRoot: string,
  virtualSources: ReadonlyMap<string, ModuleEntry>,
  violations: StartupDdlViolation[],
  collectOperations: boolean,
): { modules: Set<string>; references: number; operations: DdlOperation[] } {
  const modules = new Set<string>();
  const scheduled = new Set<string>([root]);
  const queue: QueueItem[] = [{ module: root, path: [root], edges: [] }];
  const operations: DdlOperation[] = [];
  let queueIndex = 0;
  let references = 0;
  while (queueIndex < queue.length) {
    const item = queue[queueIndex++]!;
    if (modules.has(item.module)) continue;
    modules.add(item.module);
    const source = sourceFor(item.module, virtualSources);
    if (source === undefined) {
      violations.push({ reason: "unresolved-local-dependency", module: item.module, detail: item.module, path: item.path });
      continue;
    }
    const sourceFile = parse(source, item.module);
    const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (diagnostics.length > 0) {
      violations.push({ reason: "parse-error", module: item.module, detail: diagnostics.map((d) => String(d.messageText)).join("; "), path: item.path });
      continue;
    }
    if (collectOperations) operations.push(...operationsInSource(sourceFile, item.module));
    for (const reference of referencesIn(sourceFile)) {
      references += 1;
      const specifier = reference.specifier ?? "<non-literal>";
      const edge: Edge = { from: item.module, specifier, kind: reference.kind };
      if (!reference.literal) {
        violations.push({
          reason: reference.kind === "require" ? "non-literal-require" : "non-literal-dynamic-import",
          module: item.module,
          detail: specifier,
          path: [...item.path, specifier],
        });
        continue;
      }
      const resolved = resolve(item.module, specifier, repositoryRoot, virtualSources);
      const isLocal = specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@workspace/");
      if (!resolved && isLocal) {
        violations.push({ reason: "unresolved-local-dependency", module: item.module, detail: specifier, path: [...item.path, specifier] });
        continue;
      }
      if (resolved && !modules.has(resolved) && !scheduled.has(resolved)) {
        scheduled.add(resolved);
        queue.push({ module: resolved, path: [...item.path, resolved], edges: [...item.edges, { ...edge, to: resolved }] });
      }
    }
  }
  return { modules, references, operations };
}

function sameOwners(actual: readonly StartupDdlOwner[], expected: readonly StartupDdlOwner[]): string | undefined {
  const actualMap = new Map(actual.map((owner) => [owner.ensureName, owner]));
  const expectedMap = new Map(expected.map((owner) => [owner.ensureName, owner]));
  const actualNames = [...actualMap.keys()].sort();
  const expectedNames = [...expectedMap.keys()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    return `startup DDL roots changed (actual=${actualNames.join(",")}; expected=${expectedNames.join(",")})`;
  }
  for (const name of expectedNames) {
    const a = actualMap.get(name)!;
    const e = expectedMap.get(name)!;
    if (a.ownerModule !== e.ownerModule) return `${name} owner changed: ${e.ownerModule} -> ${a.ownerModule}`;
    const actualOperations = a.operations.map(({ kind, summary, fingerprint }) => ({ kind, summary, fingerprint }));
    const expectedOperations = e.operations.map(({ kind, summary, fingerprint }) => ({ kind, summary, fingerprint }));
    if (JSON.stringify(actualOperations) !== JSON.stringify(expectedOperations)) {
      return `${name} DDL inventory changed`;
    }
  }
  return undefined;
}

function checkLegacyProductionStartupDdlInventory(options: StartupDdlInventoryOptions = {}): StartupDdlInventoryReport {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const virtualSources = entriesFor(options.moduleSources);
  const rootInput = options.rootFile ?? PRODUCTION_STARTUP_ROOT;
  const root = resolveRoot(rootInput, repositoryRoot, virtualSources);
  const violations: StartupDdlViolation[] = [];
  if (!root) {
    violations.push({ reason: "missing-root", module: rootInput, detail: rootInput, path: [rootInput] });
    return { startupRoot: rootInput, owners: [], scannedModules: 0, scannedReferences: 0, violations, matchesBaseline: false };
  }

  const rootSource = sourceFor(root, virtualSources);
  if (rootSource === undefined) {
    violations.push({ reason: "missing-root", module: root, detail: root, path: [root] });
    return { startupRoot: rootInput, owners: [], scannedModules: 0, scannedReferences: 0, violations, matchesBaseline: false };
  }
  const rootFile = parse(rootSource, root);
  const imported = importedOwners(rootFile);
  const calls = startupCalls(rootFile, imported);
  const knownCalls = new Set<string>();
  const ownerSpecs = new Map<string, string>();
  for (const [calledName, local] of calls) {
    const expected = expectedImportName(local, calledName, imported);
    if (expected) {
      knownCalls.add(expected);
      ownerSpecs.set(expected, imported.get(local)!.specifier);
    } else if (/^ensure[A-Z]/u.test(local)) {
      violations.push({ reason: "unexpected-startup-ddl-root", module: relativeModule(root, repositoryRoot), detail: local, path: [root, local] });
    }
  }
  for (const expected of EXPECTED_STARTUP_DDL_ROOTS) {
    if (!knownCalls.has(expected)) {
      violations.push({ reason: "missing-startup-ddl-root", module: relativeModule(root, repositoryRoot), detail: expected, path: [root, expected] });
    }
  }

  const rootGraph = scanGraph(root, repositoryRoot, virtualSources, violations, true);
  const owners: StartupDdlOwner[] = [];
  let scannedModules = rootGraph.modules.size;
  let scannedReferences = rootGraph.references;
  for (const ensureName of EXPECTED_STARTUP_DDL_ROOTS) {
    const specifier = ownerSpecs.get(ensureName);
    if (!specifier) continue;
    const owner = resolve(root, specifier, repositoryRoot, virtualSources);
    if (!owner) {
      violations.push({ reason: "unresolved-local-dependency", module: root, detail: specifier, path: [root, specifier] });
      continue;
    }
    const graph = scanGraph(owner, repositoryRoot, virtualSources, violations, true);
    scannedModules += graph.modules.size;
    scannedReferences += graph.references;
    const operations = graph.operations
      .sort((a, b) => a.module.localeCompare(b.module) || a.kind.localeCompare(b.kind) || a.summary.localeCompare(b.summary) || a.fingerprint.localeCompare(b.fingerprint))
      .map((operation) => ({ ...operation, module: relativeModule(operation.module, repositoryRoot) }));
    owners.push({ ensureName, ownerModule: relativeModule(owner, repositoryRoot), operations });
  }
  const ownedOperationKeys = new Set(
    owners.flatMap((owner) => owner.operations.map((operation) => `${operation.module}\0${operation.kind}\0${operation.summary}\0${operation.fingerprint}`)),
  );
  for (const operation of rootGraph.operations) {
    const normalized = {
      ...operation,
      module: relativeModule(operation.module, repositoryRoot),
    };
    const key = `${normalized.module}\0${normalized.kind}\0${normalized.summary}\0${normalized.fingerprint}`;
    if (!ownedOperationKeys.has(key)) {
      violations.push({
        reason: "unexpected-startup-ddl-root",
        module: normalized.module,
        detail: `${normalized.kind}: ${normalized.summary}`,
        path: [root, normalized.module],
      });
    }
  }

  let matchesBaseline = true;
  if (options.baseline) {
    const mismatch = sameOwners(owners, options.baseline.owners);
    if (mismatch) {
      matchesBaseline = false;
      violations.push({ reason: mismatch.includes("owner") ? "owner-mismatch" : "inventory-mismatch", module: rootInput, detail: mismatch, path: [rootInput] });
    }
  }
  return { startupRoot: rootInput, owners, scannedModules, scannedReferences, violations, matchesBaseline };
}

/*
 * Executable reachability engine
 * -----------------------------
 *
 * The earlier graph walker is retained above as a small compatibility aid for
 * callers that used its report shape while Phase 2 was being developed.  The
 * exported checker below deliberately does not use it.  It follows calls from
 * top-level statements in index.ts, and only records DDL when a reachable
 * function passes a constructed value to a query/execute sink.
 */
type Phase = "pre-listen" | "post-listen";
type FunctionNode =
  | ts.FunctionDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration;

interface ExecutableBinding {
  readonly specifier: string;
  readonly importedName: string;
}

interface ExecutableModule {
  readonly canonical: string;
  readonly sourceFile: ts.SourceFile;
  readonly imports: ReadonlyMap<string, ExecutableBinding>;
}

interface ResolvedFunction {
  readonly module: ExecutableModule;
  readonly name: string;
  readonly node: FunctionNode;
}

interface SqlValue {
  readonly raw?: string;
  readonly values?: readonly SqlValue[];
  readonly callable?: ResolvedFunction;
  readonly unknown: boolean;
  readonly module: string;
}

interface CallContext {
  readonly module: ExecutableModule;
  readonly repositoryRoot: string;
  readonly virtualSources: ReadonlyMap<string, ModuleEntry>;
  readonly moduleCache: Map<string, ExecutableModule>;
  readonly environment: ReadonlyMap<string, SqlValue>;
  readonly phase: Phase;
  readonly rootName: string;
  readonly rootCallSite: string;
  readonly callPath: readonly string[];
  readonly operations: DdlOperation[];
  readonly violations: StartupDdlViolation[];
  readonly activeFunctions: Set<string>;
}

type ExecutableInvocation = ts.CallExpression | ts.NewExpression;

interface CallRecord {
  readonly expression: ExecutableInvocation;
  readonly localName?: string;
  readonly importedName?: string;
  readonly phase: Phase;
}

function lineAndColumn(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${relativeModule(sourceFile.fileName, REPOSITORY_ROOT)}:${position.line + 1}:${position.character + 1}`;
}

function isFunctionNode(node: ts.Node | undefined): node is FunctionNode {
  return !!node && (
    ts.isFunctionDeclaration(node)
    || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function executableModule(
  module: string,
  repositoryRoot: string,
  virtualSources: ReadonlyMap<string, ModuleEntry>,
  cache: Map<string, ExecutableModule>,
): ExecutableModule | undefined {
  const cached = cache.get(module);
  if (cached) return cached;
  const source = sourceFor(module, virtualSources);
  if (source === undefined) return undefined;
  const sourceFile = parse(source, module);
  const imports = new Map<string, ExecutableBinding>();
  for (const declaration of sourceFile.statements) {
    if (!ts.isImportDeclaration(declaration) || !isLiteral(declaration.moduleSpecifier)) continue;
    const clause = declaration.importClause;
    if (!clause) continue;
    if (clause.name) {
      imports.set(clause.name.text, {
        specifier: declaration.moduleSpecifier.text,
        importedName: "default",
      });
    }
    if (!clause.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      imports.set(clause.namedBindings.name.text, {
        specifier: declaration.moduleSpecifier.text,
        importedName: "*",
      });
    } else if (ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        imports.set(element.name.text, {
          specifier: declaration.moduleSpecifier.text,
          importedName: element.propertyName?.text ?? element.name.text,
        });
      }
    }
  }
  const model: ExecutableModule = { canonical: module, sourceFile, imports };
  cache.set(module, model);
  return model;
}

function declarationFor(module: ExecutableModule, name: string): ts.Node | undefined {
  for (const statement of module.sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (ts.isClassDeclaration(statement) && statement.name?.text === name) return statement;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer;
      }
    }
  }
  return undefined;
}

function memberNode(objectOrClass: ts.Node, name: string): ts.Node | undefined {
  if (ts.isObjectLiteralExpression(objectOrClass)) {
    for (const property of objectOrClass.properties) {
      const propertyName = property.name && (
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : undefined
      );
      if (propertyName !== name) continue;
      if (ts.isMethodDeclaration(property)) return property;
      if (ts.isPropertyAssignment(property)) return property.initializer;
    }
  } else if (ts.isClassDeclaration(objectOrClass)) {
    for (const member of objectOrClass.members) {
      if (!("name" in member) || !member.name) continue;
      const propertyName = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
        ? member.name.text
        : undefined;
      if (propertyName === name && ts.isMethodDeclaration(member)) return member;
    }
  }
  return undefined;
}

function resolveConstructor(
  module: ExecutableModule,
  expression: ts.Expression,
  repositoryRoot: string,
  virtualSources: ReadonlyMap<string, ModuleEntry>,
  cache: Map<string, ExecutableModule>,
): ResolvedFunction | undefined {
  const current = unwrap(expression);
  if (!ts.isIdentifier(current)) return undefined;
  const resolved = resolveExport(module, current.text, repositoryRoot, virtualSources, cache);
  if (!resolved || !ts.isClassDeclaration(resolved.node)) return undefined;
  const constructor = resolved.node.members.find(ts.isConstructorDeclaration);
  if (!constructor) return undefined;
  return { module: resolved.module, name: `${resolved.name}#constructor`, node: constructor };
}

function resolveModule(
  from: ExecutableModule,
  specifier: string,
  repositoryRoot: string,
  virtualSources: ReadonlyMap<string, ModuleEntry>,
  cache: Map<string, ExecutableModule>,
): ExecutableModule | undefined {
  const resolved = resolve(from.canonical, specifier, repositoryRoot, virtualSources);
  return resolved ? executableModule(resolved, repositoryRoot, virtualSources, cache) : undefined;
}

function isLocalDependency(
  specifier: string,
  repositoryRoot: string,
): boolean {
  return specifier.startsWith(".")
    || specifier.startsWith("/")
    || !!workspacePackageTarget(specifier, repositoryRoot);
}

function resolveExport(
  module: ExecutableModule,
  name: string,
  repositoryRoot: string,
  virtualSources: ReadonlyMap<string, ModuleEntry>,
  cache: Map<string, ExecutableModule>,
  seen = new Set<string>(),
): { module: ExecutableModule; name: string; node: ts.Node } | undefined {
  const key = `${module.canonical}\0${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const local = declarationFor(module, name);
  if (local) return { module, name, node: local };
  const imported = module.imports.get(name);
  if (imported && imported.importedName !== "*") {
    const target = resolveModule(module, imported.specifier, repositoryRoot, virtualSources, cache);
    if (target) return resolveExport(target, imported.importedName, repositoryRoot, virtualSources, cache, seen);
  }
  for (const statement of module.sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && isLiteral(statement.moduleSpecifier)) {
      const target = resolveModule(module, statement.moduleSpecifier.text, repositoryRoot, virtualSources, cache);
      if (!target) continue;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.name.text === name) {
            return resolveExport(target, element.propertyName?.text ?? element.name.text, repositoryRoot, virtualSources, cache, seen);
          }
        }
      } else if (!statement.exportClause) {
        const exported = resolveExport(target, name, repositoryRoot, virtualSources, cache, seen);
        if (exported) return exported;
      }
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text === name) {
          const localNode = declarationFor(module, element.propertyName?.text ?? element.name.text);
          if (localNode) return { module, name: element.propertyName?.text ?? element.name.text, node: localNode };
        }
      }
    }
  }
  return undefined;
}

function resolveFunction(
  module: ExecutableModule,
  expression: ts.Expression,
  repositoryRoot: string,
  virtualSources: ReadonlyMap<string, ModuleEntry>,
  cache: Map<string, ExecutableModule>,
  preferredFunction?: FunctionNode,
): ResolvedFunction | undefined {
  const current = unwrap(expression);
  if (isFunctionNode(current) && !ts.isConstructorDeclaration(current) && !ts.isMethodDeclaration(current)) {
    return { module, name: "<inline-function>", node: current };
  }
  if (ts.isIdentifier(current)) {
    const resolved = resolveExport(module, current.text, repositoryRoot, virtualSources, cache);
    if (resolved && isFunctionNode(resolved.node)) {
      return { module: resolved.module, name: resolved.name, node: resolved.node };
    }
    if (resolved && ts.isExpression(resolved.node) && resolved.node !== current) {
      const aliased = resolveFunction(resolved.module, resolved.node, repositoryRoot, virtualSources, cache, preferredFunction);
      if (aliased) return aliased;
    }
    if (preferredFunction) {
      let nested: FunctionNode | undefined;
      const findNested = (child: ts.Node): void => {
        if (nested || (ts.isFunctionLike(child) && child !== preferredFunction)) return;
        if (ts.isFunctionDeclaration(child) && child.name?.text === current.text) nested = child;
        ts.forEachChild(child, findNested);
      };
      findNested(preferredFunction);
      const initializer = findVariable(module, current.text, preferredFunction);
      const candidate = nested ?? initializer;
      if (isFunctionNode(candidate)) return { module, name: current.text, node: candidate };
    }
  } else if (ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression)) {
    const binding = module.imports.get(current.expression.text);
    if (binding && binding.importedName === "*") {
      const target = resolveModule(module, binding.specifier, repositoryRoot, virtualSources, cache);
      const resolved = target && resolveExport(target, current.name.text, repositoryRoot, virtualSources, cache);
      if (resolved && isFunctionNode(resolved.node)) {
        return { module: resolved.module, name: resolved.name, node: resolved.node };
      }
      if (resolved) {
        const member = memberNode(resolved.node, current.name.text);
        if (isFunctionNode(member)) return { module: resolved.module, name: current.name.text, node: member };
      }
    } else {
      const object = resolveExport(module, current.expression.text, repositoryRoot, virtualSources, cache);
      if (object) {
        const member = memberNode(object.node, current.name.text);
        if (isFunctionNode(member)) return { module: object.module, name: current.name.text, node: member };
      }
    }
  }
  return undefined;
}

function resolveCallable(
  module: ExecutableModule,
  expression: ts.Expression,
  context: CallContext,
  preferredFunction?: FunctionNode,
): ResolvedFunction | undefined {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) {
    const value = context.environment.get(current.text);
    if (value?.callable) return value.callable;
  }
  return resolveFunction(
    module,
    current,
    context.repositoryRoot,
    context.virtualSources,
    context.moduleCache,
    preferredFunction,
  );
}

function literalValue(node: ts.Expression, module: string): SqlValue | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { raw: node.text, unknown: false, module };
  }
  if (ts.isTemplateExpression(node)) {
    const text = node.getText();
    return { raw: text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : text, unknown: false, module };
  }
  return undefined;
}

function findVariable(
  module: ExecutableModule,
  name: string,
  preferredFunction?: FunctionNode,
): ts.Expression | undefined {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== preferredFunction) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  if (preferredFunction) visit(preferredFunction);
  if (found.length > 0) return found[found.length - 1];
  for (const statement of module.sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return declaration.initializer;
      }
    }
  }
  return undefined;
}

function evaluateExpression(
  expression: ts.Expression,
  context: CallContext,
  preferredFunction?: FunctionNode,
): SqlValue {
  const node = unwrap(expression);
  const direct = literalValue(node, context.module.canonical);
  if (direct) return direct;
  if (isFunctionNode(node) && !ts.isConstructorDeclaration(node)) {
    return {
      callable: {
        module: context.module,
        name: "<callback>",
        node,
      },
      unknown: false,
      module: context.module.canonical,
    };
  }
  if (ts.isIdentifier(node)) {
    const bound = context.environment.get(node.text);
    if (bound) return bound;
    const imported = context.module.imports.get(node.text);
    if (imported && imported.importedName !== "*") {
      const target = resolveModule(context.module, imported.specifier, context.repositoryRoot, context.virtualSources, context.moduleCache);
      if (target) {
        const initializer = findVariable(target, imported.importedName);
        if (initializer) {
          return evaluateExpression(initializer, { ...context, module: target }, undefined);
        }
      }
    }
    const initializer = findVariable(context.module, node.text, preferredFunction);
    if (initializer) {
      const initial = evaluateExpression(initializer, context, preferredFunction);
      if (initial.values && preferredFunction) {
        const appended = [...initial.values];
        const collectPushes = (child: ts.Node): void => {
          if (ts.isFunctionLike(child) && child !== preferredFunction) return;
          if (
            ts.isCallExpression(child)
            && ts.isPropertyAccessExpression(child.expression)
            && child.expression.name.text === "push"
            && ts.isIdentifier(child.expression.expression)
            && child.expression.expression.text === node.text
          ) {
            for (const argument of child.arguments) {
              const evaluated = evaluateExpression(
                ts.isSpreadElement(argument) ? argument.expression : argument,
                context,
                preferredFunction,
              );
              if (evaluated.values) appended.push(...evaluated.values);
              else appended.push(evaluated);
            }
          }
          ts.forEachChild(child, collectPushes);
        };
        collectPushes(preferredFunction);
        return { ...initial, values: appended };
      }
      return initial;
    }
    return { unknown: true, module: context.module.canonical };
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values: SqlValue[] = [];
    for (const element of node.elements) {
      if (!ts.isExpression(element)) continue;
      const evaluated = evaluateExpression(
        ts.isSpreadElement(element) ? element.expression : element,
        context,
        preferredFunction,
      );
      if (evaluated.values && ts.isSpreadElement(element)) values.push(...evaluated.values);
      else values.push(evaluated);
    }
    return {
      values,
      unknown: values.some((value) => value.unknown),
      module: context.module.canonical,
    };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluateExpression(node.left, context, preferredFunction);
    const right = evaluateExpression(node.right, context, preferredFunction);
    if (left.unknown || right.unknown || left.raw === undefined || right.raw === undefined) {
      return { unknown: true, module: context.module.canonical };
    }
    return { raw: left.raw + right.raw, unknown: false, module: left.module };
  }
  if (ts.isTaggedTemplateExpression(node)) {
    const text = node.template.getText();
    return {
      raw: text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : text,
      unknown: false,
      module: context.module.canonical,
    };
  }
  if (ts.isCallExpression(node)) {
    const property = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
    if (property === "raw" && node.arguments[0]) return evaluateExpression(node.arguments[0]!, context, preferredFunction);
    const resolved = resolveCallable(context.module, node.expression, context, preferredFunction);
    if (resolved) {
      const values = new Map<string, SqlValue>();
      resolved.node.parameters.forEach((parameter, index) => {
        if (ts.isIdentifier(parameter.name) && node.arguments[index]) {
          values.set(parameter.name.text, evaluateExpression(node.arguments[index]!, context, preferredFunction));
        }
      });
      const returns: ts.Expression[] = [];
      const collect = (child: ts.Node): void => {
        if (ts.isFunctionLike(child) && child !== resolved.node) return;
        if (ts.isReturnStatement(child) && child.expression) returns.push(child.expression);
        ts.forEachChild(child, collect);
      };
      collect(resolved.node.body ?? resolved.node);
      if (returns[0]) {
        const returned = evaluateExpression(
          returns[0],
          { ...context, module: resolved.module, environment: values },
          resolved.node,
        );
        if (!returned.unknown) return returned;
        const fallback: SqlValue[] = [];
        const collectDdlLiterals = (child: ts.Node): void => {
          let raw: string | undefined;
          if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) raw = child.text;
          else if (ts.isTemplateExpression(child)) {
            const text = child.getText();
            raw = text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : text;
          }
          if (raw !== undefined && operationsInLiteral(raw, resolved.module.canonical).length > 0) {
            fallback.push({ raw, unknown: false, module: resolved.module.canonical });
          }
          ts.forEachChild(child, collectDdlLiterals);
        };
        collectDdlLiterals(resolved.node.body ?? resolved.node);
        if (fallback.length > 0) return { values: fallback, unknown: false, module: resolved.module.canonical };
        return returned;
      }
    }
    return { unknown: true, module: context.module.canonical };
  }
  return { unknown: true, module: context.module.canonical };
}

function isSqlSink(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) {
    return expression.text === "query" || expression.text === "execute" || expression.text === "raw";
  }
  if (!ts.isPropertyAccessExpression(expression)) return false;
  return expression.name.text === "query" || expression.name.text === "execute" || expression.name.text === "raw";
}

function addValueOperations(
  value: SqlValue,
  context: CallContext,
  sink: ts.CallExpression,
): void {
  if (value.unknown || value.raw === undefined) {
    context.violations.push({
      reason: "unknown-dynamic-sql",
      module: context.module.canonical,
      detail: `unknown SQL reaching sink at ${lineAndColumn(context.module.sourceFile, sink)}`,
      path: context.callPath,
    });
    return;
  }
  const operations = operationsInLiteral(value.raw, value.module);
  for (const operation of operations) {
    context.operations.push({
      ...operation,
      module: relativeModule(operation.module, context.repositoryRoot),
      callSite: context.rootCallSite,
      phase: context.phase,
      path: [...context.callPath, lineAndColumn(context.module.sourceFile, sink)],
    });
  }
}

function scanTopLevelModule(
  target: ExecutableModule,
  caller: CallContext,
): void {
  const context: CallContext = {
    ...caller,
    module: target,
    callPath: [...caller.callPath, relativeModule(target.canonical, caller.repositoryRoot)],
    operations: [],
    violations: [],
  };
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require")
    )) {
      const argument = node.arguments[0];
      if (!argument || !isLiteral(argument)) {
        caller.violations.push({
          reason: node.expression.kind === ts.SyntaxKind.ImportKeyword ? "non-literal-dynamic-import" : "non-literal-require",
          module: target.canonical,
          detail: "<non-literal>",
          path: context.callPath,
        });
      } else {
        const imported = resolveModule(target, argument.text, caller.repositoryRoot, caller.virtualSources, caller.moduleCache);
        if (imported) {
          scanTopLevelModule(imported, context);
        } else if (isLocalDependency(argument.text, caller.repositoryRoot)) {
          caller.violations.push({
            reason: "unresolved-local-dependency",
            module: target.canonical,
            detail: argument.text,
            path: context.callPath,
          });
        }
      }
      return;
    }
    if (ts.isCallExpression(node) && isSqlSink(node.expression) && node.arguments[0]) {
      addValueOperations(evaluateExpression(node.arguments[0]!, context), context, node);
      return;
    }
    if (ts.isCallExpression(node)) {
      const resolved = resolveCallable(target, node.expression, context);
      if (resolved) {
        scanFunction(resolved, context, node.arguments);
      } else {
        const expression = unwrap(node.expression);
        const immediatelyInvokesCallback = (
          ts.isPropertyAccessExpression(expression)
          && ["then", "catch", "finally"].includes(expression.name.text)
        ) || (ts.isIdentifier(expression) && expression.text === "queueMicrotask");
        if (immediatelyInvokesCallback) scanFunctionValuedArguments(node, context);
      }
      ts.forEachChild(node, visit);
      return;
    }
    if (ts.isNewExpression(node)) {
      const constructor = resolveConstructor(
        target,
        node.expression,
        context.repositoryRoot,
        context.virtualSources,
        context.moduleCache,
      );
      if (constructor) scanFunction(constructor, context, node.arguments ?? []);
      ts.forEachChild(node, visit);
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of target.sourceFile.statements) visit(statement);
  caller.operations.push(...context.operations);
  caller.violations.push(...context.violations);
}

function scanFunctionValuedArguments(
  call: ts.CallExpression,
  caller: CallContext,
): void {
  for (const argument of call.arguments) {
    const callback = unwrap(argument);
    if (isFunctionNode(callback) && !ts.isConstructorDeclaration(callback) && !ts.isMethodDeclaration(callback)) {
      scanFunction({ module: caller.module, name: "<inline-callback>", node: callback }, caller, []);
      continue;
    }
    if (ts.isIdentifier(callback)) {
      const resolved = resolveCallable(caller.module, callback, caller);
      if (resolved) scanFunction(resolved, caller, []);
    }
  }
}

function scanFunction(
  target: ResolvedFunction,
  caller: CallContext,
  argumentsList: readonly ts.Expression[],
): void {
  const key = `${target.module.canonical}\0${target.name}`;
  if (caller.activeFunctions.has(key)) return;
  const environment = new Map<string, SqlValue>();
  target.node.parameters.forEach((parameter, index) => {
    if (ts.isIdentifier(parameter.name) && argumentsList[index]) {
      environment.set(parameter.name.text, evaluateExpression(argumentsList[index]!, caller, undefined));
    }
  });
  const context: CallContext = {
    ...caller,
    module: target.module,
    repositoryRoot: caller.repositoryRoot,
    virtualSources: caller.virtualSources,
    moduleCache: caller.moduleCache,
    environment,
    callPath: [...caller.callPath, `${relativeModule(target.module.canonical, REPOSITORY_ROOT)}::${target.name}`],
    activeFunctions: new Set([...caller.activeFunctions, key]),
  };
  const body = target.node.body;
  if (!body) return;
  const scan = (node: ts.Node, localEnvironment: ReadonlyMap<string, SqlValue>): void => {
    if (ts.isFunctionLike(node) && node !== body) return;
    if (ts.isForOfStatement(node)) {
      const values = evaluateExpression(node.expression, { ...context, environment: localEnvironment }, target.node);
      const variable = node.initializer;
      const name = ts.isVariableDeclarationList(variable) && variable.declarations[0] && ts.isIdentifier(variable.declarations[0].name)
        ? variable.declarations[0].name.text
        : ts.isIdentifier(variable) ? variable.text : undefined;
      if (name && values.values) {
        for (const value of values.values) {
          const next = new Map(localEnvironment);
          next.set(name, value);
          scan(node.statement, next);
        }
      } else scan(node.statement, localEnvironment);
      return;
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (
        ts.isIdentifier(node.expression) && node.expression.text === "require"
      )) {
        const argument = node.arguments[0];
        if (!argument || !isLiteral(argument)) {
          caller.violations.push({
            reason: node.expression.kind === ts.SyntaxKind.ImportKeyword ? "non-literal-dynamic-import" : "non-literal-require",
            module: context.module.canonical,
            detail: "<non-literal>",
            path: context.callPath,
          });
        } else {
          const targetModule = resolveModule(context.module, argument.text, context.repositoryRoot, context.virtualSources, context.moduleCache);
          if (targetModule) {
            scanTopLevelModule(targetModule, context);
          } else if (isLocalDependency(argument.text, context.repositoryRoot)) {
            context.violations.push({
              reason: "unresolved-local-dependency",
              module: context.module.canonical,
              detail: argument.text,
              path: context.callPath,
            });
          }
        }
      } else if (isSqlSink(node.expression) && node.arguments[0]) {
        addValueOperations(evaluateExpression(node.arguments[0]!, { ...context, environment: localEnvironment }, target.node), context, node);
        return;
      } else {
        const resolved = resolveCallable(context.module, node.expression, context, target.node);
        if (resolved) {
          scanFunction(resolved, context, node.arguments);
        } else {
          scanFunctionValuedArguments(node, { ...context, environment: localEnvironment });
        }
      }
    } else if (ts.isNewExpression(node)) {
      const resolved = resolveConstructor(
        context.module,
        node.expression,
        context.repositoryRoot,
        context.virtualSources,
        context.moduleCache,
      );
      if (resolved) scanFunction(resolved, context, node.arguments ?? []);
    }
    ts.forEachChild(node, (child) => scan(child, localEnvironment));
  };
  scan(body, environment);
}

function topLevelCalls(
  module: ExecutableModule,
): CallRecord[] {
  const calls: CallRecord[] = [];
  let phase: Phase = "pre-listen";
  for (const statement of module.sourceFile.statements) {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const isListen = ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "listen";
        if (isListen) {
          phase = "post-listen";
          return;
        }
        let localName: string | undefined;
        let importedName: string | undefined;
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          localName = node.expression.text;
          importedName = module.imports.get(localName)?.importedName;
        } else if (
          ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
        ) {
          localName = node.expression.expression.text;
          importedName = module.imports.get(localName)?.importedName === "*"
            ? node.expression.name.text
            : undefined;
        }
        calls.push({ expression: node, localName, importedName, phase });
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }
  return calls;
}

function baselineMatches(
  report: StartupDdlInventoryReport,
  baseline: StartupDdlBaseline,
): string | undefined {
  if (baseline.version !== 1 || baseline.startupRoot !== report.startupRoot) return "startupRoot/version changed";
  for (const expected of baseline.owners) {
    const actual = report.owners.find((owner) => owner.ensureName === expected.ensureName);
    if (actual && actual.ownerModule !== expected.ownerModule) {
      return `owner-mismatch: ${expected.ensureName} ${expected.ownerModule} -> ${actual.ownerModule}`;
    }
  }
  if (JSON.stringify(report.owners) !== JSON.stringify(baseline.owners)) return "full startup DDL records changed";
  return undefined;
}

export function checkProductionStartupDdlInventory(options: StartupDdlInventoryOptions = {}): StartupDdlInventoryReport {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const virtualSources = entriesFor(options.moduleSources);
  const rootInput = options.rootFile ?? PRODUCTION_STARTUP_ROOT;
  const root = resolveRoot(rootInput, repositoryRoot, virtualSources);
  const violations: StartupDdlViolation[] = [];
  if (!root) {
    violations.push({ reason: "missing-root", module: rootInput, detail: rootInput, path: [rootInput] });
    return { version: 1, startupRoot: rootInput, owners: [], scannedModules: 0, scannedReferences: 0, violations, matchesBaseline: false };
  }
  const modules = new Map<string, ExecutableModule>();
  const rootModule = executableModule(root, repositoryRoot, virtualSources, modules);
  if (!rootModule) {
    violations.push({ reason: "missing-root", module: root, detail: root, path: [root] });
    return { version: 1, startupRoot: rootInput, owners: [], scannedModules: 0, scannedReferences: 0, violations, matchesBaseline: false };
  }

  // Static imports are module-evaluation edges and are therefore loaded even
  // when their exported functions are never called. Their DDL is not scanned
  // until a reachable function passes it to a SQL sink.
  const staticQueue = [rootModule];
  const staticSeen = new Set<string>();
  while (staticQueue.length > 0) {
    const current = staticQueue.shift()!;
    if (staticSeen.has(current.canonical)) continue;
    staticSeen.add(current.canonical);
    const staticSpecifiers = new Set<string>();
    for (const statement of current.sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && isLiteral(statement.moduleSpecifier)) {
        staticSpecifiers.add(statement.moduleSpecifier.text);
      }
    }
    for (const specifier of staticSpecifiers) {
      const target = resolveModule(current, specifier, repositoryRoot, virtualSources, modules);
      if (!target && isLocalDependency(specifier, repositoryRoot)) {
        violations.push({ reason: "unresolved-local-dependency", module: current.canonical, detail: specifier, path: [current.canonical, specifier] });
      } else if (target) staticQueue.push(target);
    }
    for (const statement of current.sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && isLiteral(statement.moduleSpecifier)) {
        const target = resolveModule(current, statement.moduleSpecifier.text, repositoryRoot, virtualSources, modules);
        if (target) staticQueue.push(target);
      }
    }
  }

  const owners = new Map<string, StartupDdlOwner>();
  const allCalls = topLevelCalls(rootModule);
  for (const moduleName of staticSeen) {
    if (moduleName === root) continue;
    const module = modules.get(moduleName);
    if (!module) continue;
    const evaluationContext: CallContext = {
      module: rootModule,
      repositoryRoot,
      virtualSources,
      moduleCache: modules,
      environment: new Map(),
      phase: "pre-listen",
      rootName: "<module-evaluation>",
      rootCallSite: relativeModule(root, repositoryRoot),
      callPath: [relativeModule(root, repositoryRoot), relativeModule(moduleName, repositoryRoot)],
      operations: [],
      violations,
      activeFunctions: new Set(),
    };
    scanTopLevelModule(module, evaluationContext);
    if (evaluationContext.operations.length > 0) {
      violations.push({
        reason: "unexpected-startup-ddl-root",
        module: relativeModule(moduleName, repositoryRoot),
        detail: `DDL executed during module evaluation: ${evaluationContext.operations
          .map((operation) => `${operation.kind} ${operation.summary} [${operation.module}]`)
          .join("; ")}`,
        path: evaluationContext.callPath,
      });
    }
  }
  for (const record of allCalls) {
    if (record.expression.expression.kind === ts.SyntaxKind.ImportKeyword || (
      ts.isIdentifier(record.expression.expression) && record.expression.expression.text === "require"
    )) {
      const argument = record.expression.arguments?.[0];
      const dynamicReason = record.expression.expression.kind === ts.SyntaxKind.ImportKeyword
        ? "non-literal-dynamic-import"
        : "non-literal-require";
      if (!argument || !isLiteral(argument)) {
        violations.push({
          reason: dynamicReason,
          module: root,
          detail: "<non-literal>",
          path: [relativeModule(root, repositoryRoot)],
        });
      } else {
        const targetModule = resolveModule(rootModule, argument.text, repositoryRoot, virtualSources, modules);
        if (targetModule) {
          const dynamicContext: CallContext = {
            module: rootModule,
            repositoryRoot,
            virtualSources,
            moduleCache: modules,
            environment: new Map(),
            phase: record.phase,
            rootName: "<dynamic-module>",
            rootCallSite: lineAndColumn(rootModule.sourceFile, record.expression),
            callPath: [relativeModule(root, repositoryRoot)],
            operations: [],
            violations,
            activeFunctions: new Set(),
          };
          scanTopLevelModule(targetModule, dynamicContext);
          if (dynamicContext.operations.length > 0) {
            violations.push({
              reason: "unexpected-startup-ddl-root",
              module: root,
              detail: `DDL-capable dynamic module evaluation: ${dynamicContext.operations
                .map((operation) => `${operation.kind} ${operation.summary} [${operation.module}]`)
                .join("; ")}`,
              path: dynamicContext.callPath,
            });
          }
        } else if (isLocalDependency(argument.text, repositoryRoot)) {
          violations.push({
            reason: "unresolved-local-dependency",
            module: root,
            detail: argument.text,
            path: [relativeModule(root, repositoryRoot), argument.text],
          });
        }
      }
      continue;
    }
    if (ts.isNewExpression(record.expression)) {
      const constructor = resolveConstructor(
        rootModule,
        record.expression.expression,
        repositoryRoot,
        virtualSources,
        modules,
      );
      if (constructor) {
        const constructorContext: CallContext = {
          module: rootModule,
          repositoryRoot,
          virtualSources,
          moduleCache: modules,
          environment: new Map(),
          phase: record.phase,
          rootName: "<top-level-constructor>",
          rootCallSite: lineAndColumn(rootModule.sourceFile, record.expression),
          callPath: [relativeModule(root, repositoryRoot)],
          operations: [],
          violations,
          activeFunctions: new Set(),
        };
        scanFunction(constructor, constructorContext, record.expression.arguments ?? []);
        if (constructorContext.operations.length > 0) {
          violations.push({
            reason: "unexpected-startup-ddl-root",
            module: root,
            detail: `DDL-capable top-level constructor ${constructor.name}: ${constructorContext.operations
              .map((operation) => `${operation.kind} ${operation.summary} [${operation.module}]`)
              .join("; ")}`,
            path: constructorContext.callPath,
          });
        }
      }
      continue;
    }
    if (isSqlSink(record.expression.expression) && record.expression.arguments[0]) {
      const directContext: CallContext = {
        module: rootModule,
        repositoryRoot,
        virtualSources,
        moduleCache: modules,
        environment: new Map(),
        phase: record.phase,
        rootName: "<top-level-sink>",
        rootCallSite: lineAndColumn(rootModule.sourceFile, record.expression),
        callPath: [relativeModule(root, repositoryRoot)],
        operations: [],
        violations,
        activeFunctions: new Set(),
      };
      addValueOperations(evaluateExpression(record.expression.arguments[0]!, directContext), directContext, record.expression);
      if (directContext.operations.length > 0) {
        violations.push({
          reason: "unexpected-startup-ddl-root",
          module: root,
          detail: "DDL executed directly from startup entrypoint",
          path: directContext.callPath,
        });
      }
      continue;
    }
    const target = resolveFunction(rootModule, record.expression.expression, repositoryRoot, virtualSources, modules);
    if (!target) {
      if (ts.isCallExpression(record.expression)) {
        const callbackContext: CallContext = {
          module: rootModule,
          repositoryRoot,
          virtualSources,
          moduleCache: modules,
          environment: new Map(),
          phase: record.phase,
          rootName: "<top-level-callback>",
          rootCallSite: lineAndColumn(rootModule.sourceFile, record.expression),
          callPath: [relativeModule(root, repositoryRoot)],
          operations: [],
          violations,
          activeFunctions: new Set(),
        };
        scanFunctionValuedArguments(record.expression, callbackContext);
        if (callbackContext.operations.length > 0) {
          violations.push({
            reason: "unexpected-startup-ddl-root",
            module: root,
            detail: `DDL-capable callback passed to top-level call (${record.phase}): ${callbackContext.operations
              .map((operation) => `${operation.kind} ${operation.summary} [${operation.module}]`)
              .join("; ")}`,
            path: callbackContext.callPath,
          });
        }
      }
      continue;
    }
    const callSite = lineAndColumn(rootModule.sourceFile, record.expression);
    const context: CallContext = {
      module: rootModule,
      repositoryRoot,
      virtualSources,
      moduleCache: modules,
      environment: new Map(),
      phase: record.phase,
      rootName: record.importedName ?? record.localName ?? "<anonymous>",
      rootCallSite: callSite,
      callPath: [relativeModule(root, repositoryRoot)],
      operations: [],
      violations,
      activeFunctions: new Set(),
    };
    scanFunction(target, context, record.expression.arguments ?? []);
    const known = EXPECTED_STARTUP_DDL_ROOTS.includes(record.importedName ?? "");
      if (known && record.phase === "pre-listen") {
      const ownerModule = relativeModule(target.module.canonical, repositoryRoot);
      owners.set(record.importedName!, {
        ensureName: record.importedName!,
        ownerModule,
        callSite,
        phase: record.phase,
        path: [
          relativeModule(root, repositoryRoot),
          `${relativeModule(target.module.canonical, repositoryRoot)}::${target.name}`,
        ],
        operations: context.operations
          .sort((a, b) => a.module.localeCompare(b.module) || a.kind.localeCompare(b.kind) || a.summary.localeCompare(b.summary) || a.fingerprint.localeCompare(b.fingerprint)),
      });
      } else if (context.operations.length > 0) {
      violations.push({
        reason: "unexpected-startup-ddl-root",
        module: root,
        detail: `DDL-capable top-level call ${record.localName ?? "<anonymous>"} (${record.phase}): ${context.operations
          .map((operation) => `${operation.kind} ${operation.summary} [${operation.module}]`)
          .join("; ")}`,
        path: context.callPath,
      });
    }
  }
  for (const expected of EXPECTED_STARTUP_DDL_ROOTS) {
    if (!owners.has(expected)) {
      violations.push({ reason: "missing-startup-ddl-root", module: rootInput, detail: expected, path: [rootInput, expected] });
    }
  }
  const actualOwners = EXPECTED_STARTUP_DDL_ROOTS
    .map((name) => owners.get(name))
    .filter((owner): owner is StartupDdlOwner => !!owner);
  let matchesBaseline = true;
  if (options.baseline) {
    const mismatch = baselineMatches(
      { version: 1, startupRoot: rootInput, owners: actualOwners, scannedModules: staticSeen.size, scannedReferences: 0, violations: [], matchesBaseline: true },
      options.baseline,
    );
    if (mismatch) {
      matchesBaseline = false;
      violations.push({
        reason: mismatch.startsWith("owner-mismatch:") ? "owner-mismatch" : "inventory-mismatch",
        module: rootInput,
        detail: mismatch,
        path: [rootInput],
      });
    }
  }
  return {
    version: 1,
    startupRoot: rootInput,
    owners: actualOwners,
    scannedModules: staticSeen.size,
    scannedReferences: allCalls.length,
    violations,
    matchesBaseline,
  };
}

export function checkRealRepositoryProductionStartupDdlInventory(
  repositoryRoot = REPOSITORY_ROOT,
  baseline?: StartupDdlBaseline,
): StartupDdlInventoryReport {
  return checkProductionStartupDdlInventory({ repositoryRoot, baseline });
}

export function assertProductionStartupDdlInventory(
  options: StartupDdlInventoryOptions = {},
): StartupDdlInventoryReport {
  const report = checkProductionStartupDdlInventory(options);
  if (report.violations.length > 0) {
    throw new Error(
      `Production startup DDL inventory violated:\n${report.violations
        .map((violation) => `- ${violation.reason}: ${violation.detail}`)
        .join("\n")}`,
    );
  }
  return report;
}

function baselinePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "production-startup-ddl-baseline.json");
}

function invokedDirectly(): boolean {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (invokedDirectly()) {
  const reviewedBaseline = process.argv.includes("--write-baseline")
    ? undefined
    : (() => {
      try {
        return JSON.parse(readFileSync(baselinePath(), "utf8")) as StartupDdlBaseline;
      } catch {
        return undefined;
      }
    })();
  const report = checkRealRepositoryProductionStartupDdlInventory(undefined, reviewedBaseline);
  if (process.argv.includes("--write-baseline")) {
    if (report.violations.length > 0) {
      console.error(report.violations.map((violation) => `${violation.reason}: ${violation.detail}`).join("\n"));
      process.exitCode = 1;
    } else {
      const baseline: StartupDdlBaseline = {
        version: 1,
        startupRoot: PRODUCTION_STARTUP_ROOT,
        owners: report.owners,
      };
      writeFileSync(baselinePath(), `${JSON.stringify(baseline, null, 2)}\n`);
      console.log(`Wrote ${baselinePath()}`);
    }
  } else {
    console.log(
      report.violations.length === 0
        ? `PASS production startup DDL inventory (${report.owners.length} owners, ${report.owners.reduce((count, owner) => count + owner.operations.length, 0)} operations)`
        : report.violations.map((violation) => `${violation.reason}: ${violation.detail}`).join("\n"),
    );
    if (report.violations.length > 0) process.exitCode = 1;
  }
}