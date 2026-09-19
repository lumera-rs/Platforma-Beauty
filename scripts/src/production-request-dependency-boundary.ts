/**
 * Static dependency boundary for production HTTP request code.
 *
 * This is deliberately a source-only checker.  It parses TypeScript with the
 * TypeScript compiler API and never imports an API-server module, starts an
 * application, or opens a database connection.
 *
 * The request graph starts at app.ts, every non-test route module, and the
 * authentication helper module. A separate narrow check starts at src/index.ts
 * and prevents normal API boot from regaining production demo-seed modules.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type ModuleSources = ReadonlyMap<string, string> | Readonly<Record<string, string>>;
export type ModuleMatcher = string | RegExp;
export type DependencyKind =
  | "import"
  | "export"
  | "import-equals"
  | "import-type"
  | "require"
  | "dynamic-import";

export interface DependencyBoundaryOptions {
  /** Root files, relative to repositoryRoot unless absolute. */
  readonly rootFiles: readonly string[];
  readonly repositoryRoot?: string;
  /**
   * In-memory source map used by tests.  Supplying it makes resolution
   * filesystem-free: missing virtual modules are not looked up on disk.
   */
  readonly moduleSources?: ModuleSources;
  /**
   * TypeScript-style aliases.  Targets are repository-root-relative for real
   * files and virtual-map-relative for in-memory modules.
   */
  readonly moduleAliases?: Readonly<Record<string, string | readonly string[]>>;
  /**
   * Additional forbidden names.  The built-in fixture and maintenance names
   * are always retained so callers cannot accidentally weaken the boundary.
   */
  readonly forbiddenModulePatterns?: readonly ModuleMatcher[];
  /** Keep the broad request-time fixture and maintenance denylist. */
  readonly includeDefaultForbiddenPatterns?: boolean;
}

export interface DependencyPathStep {
  readonly from: string;
  readonly to?: string;
  readonly specifier: string;
  readonly kind: DependencyKind;
}

export type DependencyViolationReason =
  | "forbidden-module"
  | "non-literal-dynamic-import"
  | "non-literal-require"
  | "unresolved-local-dependency"
  | "missing-root"
  | "parse-error";

export interface DependencyBoundaryViolation {
  readonly root: string;
  readonly module: string;
  readonly forbiddenModule: string;
  readonly reason: DependencyViolationReason;
  readonly path: readonly string[];
  readonly edges: readonly DependencyPathStep[];
}

export interface DependencyBoundaryReport {
  readonly roots: readonly string[];
  readonly scannedModules: number;
  readonly scannedReferences: number;
  readonly unresolvedLocalDependencies: number;
  readonly violations: readonly DependencyBoundaryViolation[];
}

export const DEFAULT_PRODUCTION_REQUEST_ROOTS = Object.freeze([
  "artifacts/api-server/src/app.ts",
  "artifacts/api-server/src/lib/auth.ts",
]);

export const DEFAULT_PRODUCTION_STARTUP_ROOTS = Object.freeze([
  "artifacts/api-server/src/index.ts",
]);

/**
 * These are module boundaries, not a list of call sites.  In particular,
 * wrappers and barrels are caught by walking the complete import graph.
 */
export const DEFAULT_FORBIDDEN_MODULE_PATTERNS: readonly ModuleMatcher[] = Object.freeze([
  /(?:^|\/)(?:seed|seed-maintenance|demo-fixtures|development-test-fixtures|test-fixtures|production-maintenance|production-marketplace-demo-seed)(?:\.[a-z0-9]+)?$/iu,
  /(?:^|\/)(?:demo|fixture|fixtures|maintenance)(?:[-_/]|$)/iu,
  /(?:^|\/)(?:demo[-_](?:seed|data|fixture)|(?:seed|fixture)[-_]data)(?:[-_/]|\.|$)/iu,
]);

interface DependencyReference {
  readonly specifier?: string;
  readonly kind: DependencyKind;
  readonly literal: boolean;
}

interface ModuleGraphEntry {
  readonly canonical: string;
  readonly source: string;
}

interface PackageInfo {
  readonly root: string;
  readonly manifest: Record<string, unknown>;
}

interface ResolvedDependency {
  readonly canonical: string;
  readonly displayName: string;
}

interface QueueEntry {
  readonly root: string;
  readonly module: string;
  readonly path: readonly string[];
  readonly edges: readonly DependencyPathStep[];
}

interface Matcher {
  readonly raw: ModuleMatcher;
  matches(value: string): boolean;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;
const SCRIPT_MODULE_EXTENSIONS = new Set(SOURCE_EXTENSIONS);
const DEFAULT_REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

function normalizeVirtualPath(value: string): string {
  const normalized = path.posix.normalize(toPosix(value));
  return normalized.replace(/^\.\/+/u, "");
}

function sourceKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
}

function sourceCandidates(base: string): string[] {
  const normalized = toPosix(base);
  const candidates = [normalized];
  const hasKnownExtension = SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
  if (!hasKnownExtension) {
    candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${normalized}${extension}`));
  }
  candidates.push(...SOURCE_EXTENSIONS.map((extension) => `${normalized}/index${extension}`));
  return [...new Set(candidates)];
}

function sourceFileNameIsSupported(fileName: string): boolean {
  return SCRIPT_MODULE_EXTENSIONS.has(path.extname(fileName).toLowerCase() as typeof SOURCE_EXTENSIONS[number]);
}

function moduleSourceEntries(
  moduleSources: ModuleSources | undefined,
): Map<string, ModuleGraphEntry> {
  const entries = new Map<string, ModuleGraphEntry>();
  if (!moduleSources) return entries;
  const values = moduleSources instanceof Map
    ? moduleSources.entries()
    : Object.entries(moduleSources);
  for (const [name, source] of values) {
    const canonical = normalizeVirtualPath(name);
    entries.set(canonical, { canonical, source });
  }
  return entries;
}

function isStringLiteralLike(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function collectDependencyReferences(sourceFile: ts.SourceFile): DependencyReference[] {
  const references: DependencyReference[] = [];
  const seen = new Set<string>();
  const add = (reference: DependencyReference): void => {
    const key = `${reference.kind}:${reference.literal ? reference.specifier ?? "<unknown>" : "<non-literal>"}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push(reference);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isStringLiteralLike(node.moduleSpecifier)) {
      add({ kind: "import", literal: true, specifier: node.moduleSpecifier.text });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && isStringLiteralLike(node.moduleSpecifier)) {
      add({ kind: "export", literal: true, specifier: node.moduleSpecifier.text });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && isStringLiteralLike(expression)) {
        add({ kind: "import-equals", literal: true, specifier: expression.text });
      } else {
        add({ kind: "import-equals", literal: false });
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && isStringLiteralLike(argument.literal)) {
        add({ kind: "import-type", literal: true, specifier: argument.literal.text });
      } else {
        add({ kind: "import-type", literal: false });
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument && isStringLiteralLike(argument)) {
          add({ kind: "dynamic-import", literal: true, specifier: argument.text });
        } else {
          add({ kind: "dynamic-import", literal: false });
        }
      } else if (
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
        || (
          ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.name)
          && node.expression.name.text === "require"
        )
      ) {
        const argument = node.arguments[0];
        if (argument && isStringLiteralLike(argument)) {
          add({ kind: "require", literal: true, specifier: argument.text });
        } else {
          add({ kind: "require", literal: false });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return references;
}

function matcherFor(value: ModuleMatcher): Matcher {
  if (value instanceof RegExp) {
    return {
      raw: value,
      matches(candidate: string): boolean {
        value.lastIndex = 0;
        return value.test(candidate);
      },
    };
  }
  const normalizedPattern = normalizeVirtualPath(value).toLowerCase();
  return {
    raw: value,
    matches(candidate: string): boolean {
      const normalizedCandidate = normalizeVirtualPath(candidate).toLowerCase();
      return normalizedCandidate === normalizedPattern
        || normalizedCandidate.endsWith(`/${normalizedPattern}`)
        || (
          !normalizedPattern.includes("/")
          && path.posix.basename(normalizedCandidate) === normalizedPattern
        );
    },
  };
}

function matchesForbidden(
  value: string,
  matchers: readonly Matcher[],
): boolean {
  return matchers.some((matcher) => matcher.matches(value));
}

function packageExportsTarget(manifest: Record<string, unknown>, subpath: string): string | undefined {
  const exportsValue = manifest.exports;
  if (typeof exportsValue === "string") return subpath === "." ? exportsValue : undefined;
  if (!exportsValue || typeof exportsValue !== "object" || Array.isArray(exportsValue)) return undefined;
  const exportsRecord = exportsValue as Record<string, unknown>;
  const direct = exportsRecord[subpath];
  if (typeof direct === "string") return direct;
  if (!direct || typeof direct !== "object" || Array.isArray(direct)) return undefined;
  const conditions = direct as Record<string, unknown>;
  for (const condition of ["import", "default", "node"]) {
    if (typeof conditions[condition] === "string") return conditions[condition] as string;
  }
  return undefined;
}

function discoverWorkspacePackages(repositoryRoot: string): Map<string, PackageInfo> {
  const packages = new Map<string, PackageInfo>();
  for (const parent of ["artifacts", "lib", "scripts"]) {
    const parentPath = path.join(repositoryRoot, parent);
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
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        if (typeof manifest.name === "string") {
          packages.set(manifest.name, { root: packageRoot, manifest });
        }
      } catch {
        // The TypeScript graph still reports an unresolved local package below.
      }
    }
  }
  return packages;
}

function readRealFileCandidate(candidate: string): ResolvedDependency | undefined {
  for (const sourceCandidate of sourceCandidates(candidate)) {
    if (existsSync(sourceCandidate) && statSync(sourceCandidate).isFile()) {
      return { canonical: path.resolve(sourceCandidate), displayName: path.resolve(sourceCandidate) };
    }
  }
  return undefined;
}

function matchesAlias(
  specifier: string,
  aliases: Readonly<Record<string, string | readonly string[]>> | undefined,
): Array<{ target: string; wildcard: string }> {
  if (!aliases) return [];
  const matches: Array<{ target: string; wildcard: string }> = [];
  for (const [pattern, configuredTargets] of Object.entries(aliases)) {
    const targets = typeof configuredTargets === "string" ? [configuredTargets] : configuredTargets;
    if (pattern.includes("*")) {
      const [prefix, suffix] = pattern.split("*", 2);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix ?? "")) continue;
      const wildcard = specifier.slice(prefix.length, specifier.length - (suffix?.length ?? 0) || undefined);
      for (const target of targets) matches.push({ target: target.replace("*", wildcard), wildcard });
    } else if (specifier === pattern) {
      for (const target of targets) matches.push({ target, wildcard: "" });
    }
  }
  return matches;
}

function workspacePackageDependency(
  specifier: string,
  repositoryRoot: string,
  packages: ReadonlyMap<string, PackageInfo>,
): string | undefined {
  const packageName = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  const packageInfo = packages.get(packageName);
  if (!packageInfo) return undefined;
  const suffix = specifier.slice(packageName.length).replace(/^\/+/u, "");
  const subpath = suffix ? `./${suffix}` : ".";
  const target = packageExportsTarget(packageInfo.manifest, subpath)
    ?? (suffix ? `./${suffix}` : "./src/index.ts");
  return path.resolve(packageInfo.root, target);
}

function isLocalSpecifier(
  specifier: string,
  aliases: Readonly<Record<string, string | readonly string[]>> | undefined,
): boolean {
  return specifier.startsWith(".")
    || specifier.startsWith("/")
    || specifier.startsWith("@workspace/")
    || specifier.startsWith("#")
    || matchesAlias(specifier, aliases).length > 0;
}

function findVirtualDependency(
  candidate: string,
  virtualSources: ReadonlyMap<string, ModuleGraphEntry>,
): ResolvedDependency | undefined {
  for (const sourceCandidate of sourceCandidates(candidate)) {
    const canonical = normalizeVirtualPath(sourceCandidate);
    if (virtualSources.has(canonical)) {
      return { canonical, displayName: canonical };
    }
  }
  return undefined;
}

function resolveDependency(
  fromModule: string,
  specifier: string,
  options: Required<Pick<DependencyBoundaryOptions, "repositoryRoot">> & {
    readonly virtualSources: ReadonlyMap<string, ModuleGraphEntry>;
    readonly packages: ReadonlyMap<string, PackageInfo>;
    readonly aliases?: Readonly<Record<string, string | readonly string[]>>;
  },
): ResolvedDependency | undefined {
  const fromIsVirtual = options.virtualSources.size > 0 && options.virtualSources.has(fromModule);
  const directVirtual = findVirtualDependency(specifier, options.virtualSources);
  if (directVirtual) return directVirtual;

  const pathCandidates: string[] = [];
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    pathCandidates.push(
      fromIsVirtual
        ? normalizeVirtualPath(specifier.startsWith(".")
          ? path.posix.join(path.posix.dirname(fromModule), specifier)
          : specifier)
        : path.resolve(specifier.startsWith(".") ? path.dirname(fromModule) : options.repositoryRoot, specifier),
    );
  }

  for (const alias of matchesAlias(specifier, options.aliases)) {
    pathCandidates.push(
      fromIsVirtual
        ? normalizeVirtualPath(alias.target)
        : path.resolve(options.repositoryRoot, alias.target),
    );
  }

  const packageTarget = workspacePackageDependency(specifier, options.repositoryRoot, options.packages);
  if (packageTarget) pathCandidates.push(packageTarget);

  for (const candidate of pathCandidates) {
    const virtual = findVirtualDependency(candidate, options.virtualSources);
    if (virtual) return virtual;
    if (!fromIsVirtual) {
      const real = readRealFileCandidate(candidate);
      if (real) return real;
    }
  }
  return undefined;
}

function resolveRoot(
  root: string,
  repositoryRoot: string,
  virtualSources: ReadonlyMap<string, ModuleGraphEntry>,
): ResolvedDependency | undefined {
  const virtual = findVirtualDependency(root, virtualSources);
  if (virtual) return virtual;
  if (virtualSources.size > 0) return undefined;
  return readRealFileCandidate(path.isAbsolute(root) ? root : path.resolve(repositoryRoot, root));
}

function isNonProductionTestModule(fileName: string): boolean {
  return /(?:\.test|\.spec)\.[cm]?[jt]sx?$/iu.test(fileName);
}

function walkSourceFiles(directory: string): string[] {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkSourceFiles(entryPath));
    else if (entry.isFile() && sourceFileNameIsSupported(entryPath) && !isNonProductionTestModule(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

export function discoverProductionRequestRoots(repositoryRoot = DEFAULT_REPOSITORY_ROOT): string[] {
  const routeDirectory = path.join(repositoryRoot, "artifacts/api-server/src/routes");
  const routeRoots = walkSourceFiles(routeDirectory).sort();
  const roots = [
    path.join(repositoryRoot, DEFAULT_PRODUCTION_REQUEST_ROOTS[0]!),
    ...routeRoots,
    path.join(repositoryRoot, DEFAULT_PRODUCTION_REQUEST_ROOTS[1]!),
  ];
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

function flattenDiagnosticMessage(message: string | ts.DiagnosticMessageChain): string {
  return typeof message === "string"
    ? message
    : message.messageText + (message.next ?? [])
      .map((child) => `: ${flattenDiagnosticMessage(child)}`)
      .join("");
}

function reportViolation(
  violations: DependencyBoundaryViolation[],
  seen: Set<string>,
  violation: DependencyBoundaryViolation,
): void {
  const key = [
    violation.root,
    violation.reason,
    violation.module,
    violation.forbiddenModule,
  ].join("\u0000");
  if (seen.has(key)) return;
  seen.add(key);
  violations.push(violation);
}

export function checkProductionRequestDependencyBoundary(
  options: DependencyBoundaryOptions,
): DependencyBoundaryReport {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const virtualSources = moduleSourceEntries(options.moduleSources);
  const packages = virtualSources.size > 0
    ? new Map<string, PackageInfo>()
    : discoverWorkspacePackages(repositoryRoot);
  const aliases = options.moduleAliases;
  const matchers = [
    ...(options.includeDefaultForbiddenPatterns === false
      ? []
      : DEFAULT_FORBIDDEN_MODULE_PATTERNS),
    ...(options.forbiddenModulePatterns ?? []),
  ].map(matcherFor);
  const roots = options.rootFiles.map((root) => {
    const resolved = resolveRoot(root, repositoryRoot, virtualSources);
    return resolved?.canonical ?? (virtualSources.size > 0 ? normalizeVirtualPath(root) : path.resolve(repositoryRoot, root));
  });

  const violations: DependencyBoundaryViolation[] = [];
  const violationKeys = new Set<string>();
  const visited = new Set<string>();
  const scheduled = new Set<string>();
  const queue: QueueEntry[] = [];
  let queueIndex = 0;
  const queuedRoots = new Set<string>();

  for (const [index, rootInput] of options.rootFiles.entries()) {
    const root = roots[index]!;
    const resolved = resolveRoot(rootInput, repositoryRoot, virtualSources);
    if (!resolved) {
      reportViolation(violations, violationKeys, {
        root,
        module: root,
        forbiddenModule: root,
        reason: "missing-root",
        path: [root],
        edges: [],
      });
      continue;
    }
    if (matchesForbidden(root, matchers)) {
      reportViolation(violations, violationKeys, {
        root,
        module: root,
        forbiddenModule: root,
        reason: "forbidden-module",
        path: [root],
        edges: [],
      });
      continue;
    }
    if (!queuedRoots.has(resolved.canonical)) {
      queuedRoots.add(resolved.canonical);
      scheduled.add(resolved.canonical);
      queue.push({ root, module: resolved.canonical, path: [resolved.canonical], edges: [] });
    }
  }

  let scannedReferences = 0;
  let unresolvedLocalDependencies = 0;

  while (queueIndex < queue.length) {
    const entry = queue[queueIndex++]!;
    if (visited.has(entry.module)) continue;
    visited.add(entry.module);

    let source: string;
    if (virtualSources.size > 0) {
      const virtualEntry = virtualSources.get(entry.module);
      if (!virtualEntry) {
        reportViolation(violations, violationKeys, {
          root: entry.root,
          module: entry.module,
          forbiddenModule: entry.module,
          reason: "unresolved-local-dependency",
          path: entry.path,
          edges: entry.edges,
        });
        unresolvedLocalDependencies += 1;
        continue;
      }
      source = virtualEntry.source;
    } else {
      try {
        source = readFileSync(entry.module, "utf8");
      } catch {
        reportViolation(violations, violationKeys, {
          root: entry.root,
          module: entry.module,
          forbiddenModule: entry.module,
          reason: "unresolved-local-dependency",
          path: entry.path,
          edges: entry.edges,
        });
        unresolvedLocalDependencies += 1;
        continue;
      }
    }

    const sourceFile = ts.createSourceFile(
      entry.module,
      source,
      ts.ScriptTarget.Latest,
      true,
      sourceKind(entry.module),
    );
    const parseDiagnostics = (sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.Diagnostic[];
    }).parseDiagnostics ?? [];
    if (parseDiagnostics.length > 0) {
      const diagnosticMessage = parseDiagnostics.map((diagnostic) => flattenDiagnosticMessage(diagnostic.messageText)).join("; ");
      reportViolation(violations, violationKeys, {
        root: entry.root,
        module: entry.module,
        forbiddenModule: `${entry.module}: ${diagnosticMessage}`,
        reason: "parse-error",
        path: entry.path,
        edges: entry.edges,
      });
      continue;
    }

    for (const reference of collectDependencyReferences(sourceFile)) {
      scannedReferences += 1;
      const edgeBase = {
        from: entry.module,
        specifier: reference.specifier ?? "<non-literal>",
        kind: reference.kind,
      } satisfies Omit<DependencyPathStep, "to">;
      if (!reference.literal) {
        const reason: DependencyViolationReason = reference.kind === "require"
          ? "non-literal-require"
          : "non-literal-dynamic-import";
        reportViolation(violations, violationKeys, {
          root: entry.root,
          module: entry.module,
          forbiddenModule: edgeBase.specifier,
          reason,
          path: [...entry.path, edgeBase.specifier],
          edges: [...entry.edges, edgeBase],
        });
        continue;
      }

      const specifier = reference.specifier!;
      if (matchesForbidden(specifier, matchers)) {
        reportViolation(violations, violationKeys, {
          root: entry.root,
          module: entry.module,
          forbiddenModule: specifier,
          reason: "forbidden-module",
          path: [...entry.path, specifier],
          edges: [...entry.edges, { ...edgeBase, to: specifier }],
        });
        continue;
      }

      const resolved = resolveDependency(entry.module, specifier, {
        repositoryRoot,
        virtualSources,
        packages,
        aliases,
      });
      if (!resolved) {
        if (isLocalSpecifier(specifier, aliases)) {
          unresolvedLocalDependencies += 1;
          reportViolation(violations, violationKeys, {
            root: entry.root,
            module: entry.module,
            forbiddenModule: specifier,
            reason: "unresolved-local-dependency",
            path: [...entry.path, specifier],
            edges: [...entry.edges, { ...edgeBase, to: specifier }],
          });
        }
        continue;
      }
      if (matchesForbidden(resolved.canonical, matchers) || matchesForbidden(resolved.displayName, matchers)) {
        reportViolation(violations, violationKeys, {
          root: entry.root,
          module: entry.module,
          forbiddenModule: resolved.displayName,
          reason: "forbidden-module",
          path: [...entry.path, resolved.displayName],
          edges: [...entry.edges, { ...edgeBase, to: resolved.displayName }],
        });
        continue;
      }
      if (!visited.has(resolved.canonical) && !scheduled.has(resolved.canonical)) {
        scheduled.add(resolved.canonical);
        queue.push({
          root: entry.root,
          module: resolved.canonical,
          path: [...entry.path, resolved.displayName],
          edges: [...entry.edges, { ...edgeBase, to: resolved.displayName }],
        });
      }
    }
  }

  return {
    roots,
    scannedModules: visited.size,
    scannedReferences,
    unresolvedLocalDependencies,
    violations,
  };
}

export function assertProductionRequestDependencyBoundary(
  options: DependencyBoundaryOptions,
): DependencyBoundaryReport {
  const report = checkProductionRequestDependencyBoundary(options);
  if (report.violations.length > 0) {
    const details = report.violations
      .map((violation) => `${violation.reason}: ${violation.root} -> ${violation.path.join(" -> ")}`)
      .join("\n");
    const error = new Error(
      `Production request dependency boundary violated (${report.violations.length} violation(s)):\n${details}`,
    ) as Error & { report?: DependencyBoundaryReport };
    error.report = report;
    throw error;
  }
  return report;
}

export function checkRealRepositoryProductionRequestBoundary(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): DependencyBoundaryReport {
  const roots = discoverProductionRequestRoots(repositoryRoot);
  return checkProductionRequestDependencyBoundary({ repositoryRoot, rootFiles: roots });
}

export function checkRealRepositoryProductionStartupDemoBoundary(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): DependencyBoundaryReport {
  return checkProductionRequestDependencyBoundary({
    repositoryRoot,
    rootFiles: DEFAULT_PRODUCTION_STARTUP_ROOTS,
    forbiddenModulePatterns: [
      /(?:^|\/)production-marketplace-demo-seed(?:\.[a-z0-9]+)?$/iu,
      /(?:^|\/)(?:production[-_]demo|demo[-_]bootstrap)(?:[-_/]|\.|$)/iu,
    ],
  });
}

function formatReport(report: DependencyBoundaryReport): string {
  if (report.violations.length === 0) {
    return [
      `PASS production request dependency boundary`,
      `roots=${report.roots.length}`,
      `modules=${report.scannedModules}`,
      `references=${report.scannedReferences}`,
    ].join(" ");
  }
  return [
    `FAIL production request dependency boundary (${report.violations.length} violation(s))`,
    ...report.violations.map((violation) =>
      `- ${violation.reason}: ${violation.root} -> ${violation.path.join(" -> ")}`),
  ].join("\n");
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedDirectly) {
  const report = checkRealRepositoryProductionRequestBoundary();
  console.log(formatReport(report));
  if (report.violations.length > 0) process.exitCode = 1;
}