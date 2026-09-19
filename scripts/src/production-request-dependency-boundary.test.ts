import assert from "node:assert/strict";
import test from "node:test";
import {
  checkProductionRequestDependencyBoundary,
  checkRealRepositoryProductionRequestBoundary,
  checkRealRepositoryProductionStartupDemoBoundary,
  discoverProductionRequestRoots,
} from "./production-request-dependency-boundary";

function check(
  modules: Record<string, string>,
  rootFiles: readonly string[] = ["root.ts"],
  options: { moduleAliases?: Record<string, string | readonly string[]> } = {},
) {
  return checkProductionRequestDependencyBoundary({
    moduleSources: modules,
    rootFiles,
    ...options,
  });
}

test("rejects a direct aliased import of the demo fixture boundary", () => {
  const report = check({
    "root.ts": `import { runDemoFixtureSequence as safeName } from "./demo-fixtures"; void safeName;`,
    "demo-fixtures.ts": "export function runDemoFixtureSequence(): void {}",
  });

  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0]?.reason, "forbidden-module");
  assert.match(report.violations[0]?.path.join(" -> ") ?? "", /demo-fixtures/u);
});

test("follows named imports through wrapper re-exports and literal dynamic imports", () => {
  const reexportReport = check({
    "root.ts": `import { fixture } from "./wrapper"; void fixture;`,
    "wrapper.ts": `export { runDemoFixtureSequence as fixture } from "./barrel";`,
    "barrel.ts": `export * from "./demo-fixtures";`,
    "demo-fixtures.ts": "export function runDemoFixtureSequence(): void {}",
  });
  assert.equal(reexportReport.violations.length, 1);
  assert.equal(reexportReport.violations[0]?.reason, "forbidden-module");

  const dynamicReport = check({
    "root.ts": `await import("./demo-fixtures");`,
    "demo-fixtures.ts": "export const fixture = true;",
  });
  assert.equal(dynamicReport.violations.length, 1);
  assert.equal(dynamicReport.violations[0]?.reason, "forbidden-module");
});

test("conservatively rejects a non-literal dynamic import", () => {
  const report = check({
    "root.ts": `const moduleName = "./demo-fixtures"; await import(moduleName);`,
    "demo-fixtures.ts": "export const fixture = true;",
  });

  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0]?.reason, "non-literal-dynamic-import");
});

test("checks CommonJS require edges, including conservative non-literal require", () => {
  const literalReport = check({
    "root.ts": `const fixture = require("./seed-maintenance"); void fixture;`,
    "seed-maintenance.ts": "export const maintenance = true;",
  });
  assert.equal(literalReport.violations.length, 1);
  assert.equal(literalReport.violations[0]?.reason, "forbidden-module");

  const nonLiteralReport = check({
    "root.ts": `const moduleName = "./seed-maintenance"; require(moduleName);`,
    "seed-maintenance.ts": "export const maintenance = true;",
  });
  assert.equal(nonLiteralReport.violations.length, 1);
  assert.equal(nonLiteralReport.violations[0]?.reason, "non-literal-require");
});

test("terminates on cycles without exponential traversal", () => {
  const report = check({
    "root.ts": `import "./a";`,
    "a.ts": `export * from "./b";`,
    "b.ts": `import "./a"; export * from "./demo-fixtures";`,
    "demo-fixtures.ts": "export const fixture = true;",
  });

  assert.equal(report.violations.length, 1);
  assert.equal(report.scannedModules, 3);
  assert.ok(report.scannedReferences <= 4);
});

test("does not let a package-local alias escape the boundary", () => {
  const report = check({
    "root.ts": `import { fixture } from "@workspace/demo-fixtures"; void fixture;`,
    "@workspace/demo-fixtures": "export const fixture = true;",
  });

  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0]?.reason, "forbidden-module");
});

test("resolves configured aliases before applying the boundary", () => {
  const report = check(
    {
      "root.ts": `import { fixture } from "@fixtures/demo"; void fixture;`,
      "fixtures/demo.ts": "export const fixture = true;",
    },
    ["root.ts"],
    { moduleAliases: { "@fixtures/*": ["fixtures/*"] } },
  );

  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0]?.reason, "forbidden-module");
});

test("real repository request roots include app, all production routes, and auth but not server startup", () => {
  const roots = discoverProductionRequestRoots();
  assert.ok(roots.some((root) => root.endsWith("/artifacts/api-server/src/app.ts")));
  assert.ok(roots.some((root) => root.endsWith("/artifacts/api-server/src/lib/auth.ts")));
  assert.ok(roots.some((root) => root.endsWith("/artifacts/api-server/src/routes/index.ts")));
  assert.ok(roots.some((root) => root.endsWith("/artifacts/api-server/src/routes/marketplace.ts")));
  assert.ok(!roots.some((root) => root.endsWith("/artifacts/api-server/src/index.ts")));
});

test("real repository request graph remains outside fixture and maintenance modules", () => {
  const report = checkRealRepositoryProductionRequestBoundary();

  assert.deepEqual(report.violations, []);
  assert.ok(report.scannedModules > 0);
  assert.ok(report.scannedReferences > 0);
});

test("real repository startup graph cannot reach production marketplace demo writers", () => {
  const report = checkRealRepositoryProductionStartupDemoBoundary();

  assert.deepEqual(report.violations, []);
  assert.ok(report.roots.some((root) => root.endsWith("/artifacts/api-server/src/index.ts")));
  assert.ok(report.scannedModules > 0);
  assert.ok(report.scannedReferences > 0);
});