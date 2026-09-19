import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import {
  checkProductionStartupDdlInventory,
  checkRealRepositoryProductionStartupDdlInventory,
  EXPECTED_STARTUP_DDL_ROOTS,
  type StartupDdlBaseline,
} from "./production-startup-ddl-inventory";

assertDestructiveTestRuntimeAllowed(process.env, "Production startup DDL inventory tests");
function fixture(extra: Record<string, string> = {}): Record<string, string> {
  const imports = EXPECTED_STARTUP_DDL_ROOTS.map((name, index) => `import { ${name} } from "./owner-${index}";`).join("\n");
  const calls = EXPECTED_STARTUP_DDL_ROOTS.map((name) => `await ${name}();`).join("\n");
  const modules: Record<string, string> = {
    "index.ts": `${imports}\n${calls}`,
    "owner-0.ts": `import { runDdl } from "./shared-ddl"; export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() { await client.query(runDdl()); }`,
    "owner-1.ts": `export async function ${EXPECTED_STARTUP_DDL_ROOTS[1]}() {}`,
    "owner-2.ts": `export async function ${EXPECTED_STARTUP_DDL_ROOTS[2]}() {}`,
    "owner-3.ts": `export async function ${EXPECTED_STARTUP_DDL_ROOTS[3]}() {}`,
    "owner-4.ts": `export async function ${EXPECTED_STARTUP_DDL_ROOTS[4]}() {}`,
    "owner-5.ts": `export async function ${EXPECTED_STARTUP_DDL_ROOTS[5]}() {}`,
    "owner-6.ts": `export async function ${EXPECTED_STARTUP_DDL_ROOTS[6]}() {}`,
    "owner-7.ts": `export async function ${EXPECTED_STARTUP_DDL_ROOTS[7]}() {}`,
    "shared-ddl.ts": "export function runDdl() { const prefix = `CREATE TABLE IF NOT EXISTS `; return prefix + `phase_two_inventory (id uuid);`; }",
  };
  return { ...modules, ...extra };
}

function baselineFor(modules: Record<string, string>): StartupDdlBaseline {
  const report = checkProductionStartupDdlInventory({ moduleSources: modules, rootFile: "index.ts" });
  assert.deepEqual(report.violations, []);
  return { version: 1, startupRoot: "index.ts", owners: report.owners };
}

function checkFixture(
  modules: Record<string, string>,
  baseline?: StartupDdlBaseline,
) {
  return checkProductionStartupDdlInventory({ moduleSources: modules, rootFile: "index.ts", baseline });
}

test("real repository startup DDL owners and fingerprints match the reviewed baseline", () => {
  const baseline = JSON.parse(
    readFileSync(new URL("./production-startup-ddl-baseline.json", import.meta.url), "utf8"),
  ) as StartupDdlBaseline;
  const report = checkRealRepositoryProductionStartupDdlInventory(undefined, baseline);
  assert.deepEqual(report.violations, []);
  assert.equal(report.matchesBaseline, true);
  assert.equal(report.owners.length, EXPECTED_STARTUP_DDL_ROOTS.length);
});

test("mutation tests reject direct, transitive, barrel, literal dynamic, and nonliteral DDL edges", () => {
  const original = fixture();
  const baseline = baselineFor(original);

  const direct = checkFixture(
    fixture({
      "direct-ddl.ts": "await client.query(`CREATE TABLE direct_only (id uuid)`);",
      "index.ts": `${original["index.ts"]}\nimport "./direct-ddl";`,
    }),
    baseline,
  );
  assert.ok(direct.violations.some((violation) => violation.reason === "unexpected-startup-ddl-root"));

  const transitiveModules = fixture({ "transitive.ts": "export function runTransitive() { return `CREATE INDEX transitive_only ON phase_two_inventory (id)`; }" });
  transitiveModules["owner-0.ts"] = `import { runTransitive } from "./transitive"; import { runDdl } from "./shared-ddl"; export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() { await client.query(runDdl()); await client.query(runTransitive()); }`;
  const transitive = checkFixture(transitiveModules, baseline);
  assert.ok(transitive.violations.some((violation) => violation.reason === "inventory-mismatch"));

  const barrelModules = fixture({
    "barrel.ts": `export * from "./barrel-ddl";`,
    "barrel-ddl.ts": "export function runBarrel() { return `CREATE INDEX barrel_only ON phase_two_inventory (id)`; }",
  });
  barrelModules["owner-0.ts"] = `import { runBarrel } from "./barrel"; import { runDdl } from "./shared-ddl"; export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() { await client.query(runDdl()); await client.query(runBarrel()); }`;
  const barrel = checkFixture(barrelModules, baseline);
  assert.ok(barrel.violations.some((violation) => violation.reason === "inventory-mismatch"));

  const dynamicModules = fixture({ "dynamic-ddl.ts": "await client.query(`CREATE INDEX dynamic_only ON phase_two_inventory (id)`);" });
  dynamicModules["owner-0.ts"] = `await import("./dynamic-ddl"); import { runDdl } from "./shared-ddl"; export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() { await client.query(runDdl()); }`;
  const dynamic = checkFixture(dynamicModules, baseline);
  assert.ok(dynamic.violations.some((violation) => violation.reason === "inventory-mismatch"));

  const nonliteralModules = fixture();
  nonliteralModules["owner-0.ts"] = `const moduleName = "./shared-ddl"; void import(moduleName); export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() {}`;
  const nonliteral = checkFixture(nonliteralModules, baseline);
  assert.ok(nonliteral.violations.some((violation) => violation.reason === "non-literal-dynamic-import"));

  const requireModules = fixture({ "require-ddl.ts": "await client.query(`CREATE INDEX require_only ON phase_two_inventory (id)`);" });
  requireModules["owner-0.ts"] = `const name = "./require-ddl"; require(name); import { runDdl } from "./shared-ddl"; export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() { await client.query(runDdl()); }`;
  const nonliteralRequire = checkFixture(requireModules, baseline);
  assert.ok(nonliteralRequire.violations.some((violation) => violation.reason === "non-literal-require"));

  const literalRequireModules = fixture({ "require-ddl.ts": "await client.query(`CREATE INDEX require_only ON phase_two_inventory (id)`);" });
  literalRequireModules["owner-0.ts"] = `require("./require-ddl"); import { runDdl } from "./shared-ddl"; export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() { await client.query(runDdl()); }`;
  const literalRequire = checkFixture(literalRequireModules, baseline);
  assert.ok(literalRequire.violations.some((violation) => violation.reason === "inventory-mismatch"));
});

test("mutation tests reject a new ensure-style call and missing or changed known owners", () => {
  const original = fixture();
  const baseline = baselineFor(original);

  const newCall = {
    ...original,
    "new-owner.ts": "export async function ensureNewSchema() { await client.query(`CREATE TABLE new_owner (id uuid)`); }",
    "index.ts": `${original["index.ts"]}\nimport { ensureNewSchema } from "./new-owner"; await ensureNewSchema();`,
  };
  const newCallReport = checkFixture(newCall, baseline);
  assert.ok(newCallReport.violations.some((violation) => violation.reason === "unexpected-startup-ddl-root"));

  const renamedCall = {
    ...original,
    "new-owner.ts": "export async function ensureNewSchema() { await client.query(`CREATE TABLE renamed_owner (id uuid)`); }",
    "index.ts": `${original["index.ts"]}\nimport { ensureNewSchema as bootSchema } from "./new-owner"; await bootSchema();`,
  };
  const renamedCallReport = checkFixture(renamedCall, baseline);
  assert.ok(renamedCallReport.violations.some((violation) => violation.reason === "unexpected-startup-ddl-root"));

  const wrapperCall = {
    ...original,
    "wrapper.ts": `import { runDdl } from "./shared-ddl"; export async function bootSchema() { await client.query(runDdl()); }`,
    "index.ts": `${original["index.ts"]}\nimport { bootSchema } from "./wrapper"; await bootSchema();`,
  };
  const wrapperCallReport = checkFixture(wrapperCall, baseline);
  assert.ok(wrapperCallReport.violations.some((violation) => violation.reason === "unexpected-startup-ddl-root"));

  const localWrapper = {
    ...original,
    "index.ts": `${original["index.ts"]}\nconst bootSchema = async () => { await client.query(\`CREATE TABLE local_wrapper (id uuid)\`); }; await bootSchema();`,
  };
  const localWrapperReport = checkFixture(localWrapper, baseline);
  assert.ok(localWrapperReport.violations.some((violation) => violation.reason === "unexpected-startup-ddl-root"));

  const unknownSql = {
    ...original,
    "owner-0.ts": `export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() { const statement = getSqlFromOutsideThisGraph(); await client.query(statement); }`,
  };
  const unknownSqlReport = checkFixture(unknownSql, baseline);
  assert.ok(unknownSqlReport.violations.some((violation) => violation.reason === "unknown-dynamic-sql"));

  const deadFunction = {
    ...original,
    "dead.ts": "export function deadRequestOnlyPath() { return client.query(`CREATE TABLE dead_request_only (id uuid)`); }",
    "index.ts": `${original["index.ts"]}\nimport "./dead";`,
  };
  const deadFunctionReport = checkFixture(deadFunction, baseline);
  assert.deepEqual(deadFunctionReport.violations, []);

  const postListen = {
    ...original,
    "index.ts": `${original["index.ts"]}\napp.listen(3000);\nconst postListenBoot = async () => { await client.query(\`CREATE TABLE post_listen (id uuid)\`); }; await postListenBoot();`,
  };
  const postListenReport = checkFixture(postListen, baseline);
  assert.ok(postListenReport.violations.some((violation) => violation.reason === "unexpected-startup-ddl-root"));

  const missing = { ...original, "index.ts": original["index.ts"]!.replace(`await ${EXPECTED_STARTUP_DDL_ROOTS[7]}();`, "") };
  const missingReport = checkFixture(missing, baseline);
  assert.ok(missingReport.violations.some((violation) => violation.reason === "missing-startup-ddl-root"));

  const changed = {
    ...original,
    "moved-owner.ts": `export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() {}`,
    "index.ts": original["index.ts"]!.replace(
      `import { ${EXPECTED_STARTUP_DDL_ROOTS[0]} } from "./owner-0";`,
      `import { ${EXPECTED_STARTUP_DDL_ROOTS[0]} } from "./moved-owner";`,
    ),
  };
  const changedReport = checkFixture(changed, baseline);
  assert.ok(changedReport.violations.some((violation) => violation.reason === "owner-mismatch"));

  const movedTransitive = {
    ...original,
    "moved-ddl.ts": "export function runDdl() { return `CREATE TABLE IF NOT EXISTS ${otherSchema}.phase_two_inventory (id uuid);`; }",
    "owner-0.ts": `import { runDdl } from "./moved-ddl"; export async function ${EXPECTED_STARTUP_DDL_ROOTS[0]}() { await client.query(runDdl()); }`,
  };
  const movedTransitiveReport = checkFixture(movedTransitive, baseline);
  assert.ok(movedTransitiveReport.violations.some((violation) => violation.reason === "inventory-mismatch"));
});

test("mutation tests reject callback, constructor, and object-method DDL wrappers", () => {
  const original = fixture();
  const baseline = baselineFor(original);

  const iife = {
    ...original,
    "index.ts": `${original["index.ts"]}\n(() => client.query(\`CREATE TABLE top_level_iife (id uuid)\`))();`,
  };
  const iifeReport = checkFixture(iife, baseline);
  assert.ok(iifeReport.violations.some((violation) =>
    violation.reason === "unexpected-startup-ddl-root"
    && violation.detail.includes("create-table")
    && violation.detail.includes("top_level_iife")
    && violation.detail.includes("index.ts")));

  const promiseCallback = {
    ...original,
    "index.ts": `${original["index.ts"]}\nPromise.resolve().then(() => client.query(\`CREATE TABLE top_level_promise_callback (id uuid)\`));`,
  };
  const promiseCallbackReport = checkFixture(promiseCallback, baseline);
  assert.ok(promiseCallbackReport.violations.some((violation) =>
    violation.reason === "unexpected-startup-ddl-root"
    && violation.detail.includes("create-table")
    && violation.detail.includes("top_level_promise_callback")
    && violation.detail.includes("index.ts")));

  const localNamedCallback = {
    ...original,
    "index.ts": `${original["index.ts"]}\nfunction localNamedCallback() { client.query(\`CREATE TABLE top_level_local_named_callback (id uuid)\`); }\nPromise.resolve().then(localNamedCallback);`,
  };
  const localNamedCallbackReport = checkFixture(localNamedCallback, baseline);
  assert.ok(localNamedCallbackReport.violations.some((violation) =>
    violation.reason === "unexpected-startup-ddl-root"
    && violation.detail.includes("create-table")
    && violation.detail.includes("top_level_local_named_callback")
    && violation.detail.includes("index.ts")));

  const importedNamedCallback = {
    ...original,
    "named-callback.ts": "export function importedNamedCallback() { client.query(`CREATE TABLE top_level_imported_named_callback (id uuid)`); }",
    "index.ts": `${original["index.ts"]}\nimport { importedNamedCallback } from "./named-callback";\nPromise.resolve().then(importedNamedCallback);`,
  };
  const importedNamedCallbackReport = checkFixture(importedNamedCallback, baseline);
  assert.ok(importedNamedCallbackReport.violations.some((violation) =>
    violation.reason === "unexpected-startup-ddl-root"
    && violation.detail.includes("create-table")
    && violation.detail.includes("top_level_imported_named_callback")
    && violation.detail.includes("named-callback.ts")));

  const callback = {
    ...original,
    "callback.ts": "export function boot(fn: () => void) { fn(); }",
    "index.ts": `${original["index.ts"]}\nimport { boot } from "./callback"; await boot(() => client.query(\`CREATE TABLE callback_wrapper (id uuid)\`));`,
  };
  const callbackReport = checkFixture(callback, baseline);
  assert.ok(callbackReport.violations.some((violation) =>
    violation.reason === "unexpected-startup-ddl-root"
    && violation.detail.includes("create-table")
    && violation.detail.includes("callback_wrapper")
    && violation.detail.includes("index.ts")));

  const constructor = {
    ...original,
    "constructor.ts": "export class Boot { constructor() { client.query(`CREATE TABLE constructor_wrapper (id uuid)`); } }",
    "index.ts": `${original["index.ts"]}\nimport { Boot } from "./constructor"; new Boot();`,
  };
  const constructorReport = checkFixture(constructor, baseline);
  assert.ok(constructorReport.violations.some((violation) =>
    violation.reason === "unexpected-startup-ddl-root"
    && violation.detail.includes("create-table")
    && violation.detail.includes("constructor_wrapper")
    && violation.detail.includes("constructor.ts")));

  const objectMethod = {
    ...original,
    "object-boot.ts": "export const boot = { run() { client.query(`CREATE TABLE object_method_wrapper (id uuid)`); } };",
    "index.ts": `${original["index.ts"]}\nimport { boot } from "./object-boot"; boot.run();`,
  };
  const objectMethodReport = checkFixture(objectMethod, baseline);
  assert.ok(objectMethodReport.violations.some((violation) =>
    violation.reason === "unexpected-startup-ddl-root"
    && violation.detail.includes("create-table")
    && violation.detail.includes("object_method_wrapper")
    && violation.detail.includes("object-boot.ts")));
});

test("module evaluation follows indirect executable DDL without classifying dead functions", () => {
  const original = fixture();
  const baseline = baselineFor(original);
  const expectModuleEvaluationDdl = (
    modules: Record<string, string>,
    operationName: string,
    moduleName: string,
  ): void => {
    const report = checkFixture(modules, baseline);
    assert.ok(report.violations.some((violation) =>
      violation.reason === "unexpected-startup-ddl-root"
      && violation.detail.includes("create-table")
      && violation.detail.includes(operationName)
      && violation.detail.includes(moduleName)));
  };

  expectModuleEvaluationDdl({
    ...original,
    "module-boot.ts": "function boot() { client.query(`CREATE TABLE module_boot_call (id uuid)`); } boot();",
    "index.ts": `${original["index.ts"]}\nimport "./module-boot";`,
  }, "module_boot_call", "module-boot.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-iife.ts": "(() => client.query(`CREATE TABLE module_iife_call (id uuid)`))();",
    "index.ts": `${original["index.ts"]}\nimport "./module-iife";`,
  }, "module_iife_call", "module-iife.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-constructor.ts": "class Bootstrapper { constructor() { client.query(`CREATE TABLE module_constructor_call (id uuid)`); } } new Bootstrapper();",
    "index.ts": `${original["index.ts"]}\nimport "./module-constructor";`,
  }, "module_constructor_call", "module-constructor.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-imported-boot.ts": "export function importedBoot() { client.query(`CREATE TABLE module_imported_call (id uuid)`); }",
    "module-imported-entry.ts": "import { importedBoot } from './module-imported-boot'; importedBoot();",
    "index.ts": `${original["index.ts"]}\nimport "./module-imported-entry";`,
  }, "module_imported_call", "module-imported-boot.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-promise.ts": "function callback() { client.query(`CREATE TABLE module_promise_call (id uuid)`); } Promise.resolve().then(callback);",
    "index.ts": `${original["index.ts"]}\nimport "./module-promise";`,
  }, "module_promise_call", "module-promise.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-catch.ts": "Promise.reject().catch(() => client.query(`CREATE TABLE module_catch_call (id uuid)`));",
    "index.ts": `${original["index.ts"]}\nimport "./module-catch";`,
  }, "module_catch_call", "module-catch.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-finally.ts": "Promise.resolve().finally(() => client.query(`CREATE TABLE module_finally_call (id uuid)`));",
    "index.ts": `${original["index.ts"]}\nimport "./module-finally";`,
  }, "module_finally_call", "module-finally.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-microtask.ts": "queueMicrotask(() => client.query(`CREATE TABLE module_microtask_call (id uuid)`));",
    "index.ts": `${original["index.ts"]}\nimport "./module-microtask";`,
  }, "module_microtask_call", "module-microtask.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-namespace-leaf.ts": "export function boot() { client.query(`CREATE TABLE module_namespace_call (id uuid)`); }",
    "module-namespace-entry.ts": "import * as startup from './module-namespace-leaf'; startup.boot();",
    "index.ts": `${original["index.ts"]}\nimport "./module-namespace-entry";`,
  }, "module_namespace_call", "module-namespace-leaf.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-object-entry.ts": "const startup = { boot() { client.query(`CREATE TABLE module_object_call (id uuid)`); } }; startup.boot();",
    "index.ts": `${original["index.ts"]}\nimport "./module-object-entry";`,
  }, "module_object_call", "module-object-entry.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-hop-leaf.ts": "export function leafBoot() { client.query(`CREATE TABLE module_two_hop_call (id uuid)`); }",
    "module-hop-middle.ts": "export { leafBoot as middleBoot } from './module-hop-leaf';",
    "module-hop-entry.ts": "import { middleBoot } from './module-hop-middle'; middleBoot();",
    "index.ts": `${original["index.ts"]}\nimport "./module-hop-entry";`,
  }, "module_two_hop_call", "module-hop-leaf.ts");

  expectModuleEvaluationDdl({
    ...original,
    "module-alias-leaf.ts": "export function leafBoot() { client.query(`CREATE TABLE module_alias_call (id uuid)`); }",
    "module-alias-barrel.ts": "export { leafBoot as barrelBoot } from './module-alias-leaf';",
    "module-alias-entry.ts": "import { barrelBoot as aliasedBoot } from './module-alias-barrel'; aliasedBoot();",
    "index.ts": `${original["index.ts"]}\nimport "./module-alias-entry";`,
  }, "module_alias_call", "module-alias-leaf.ts");

  const safeCall = checkFixture({
    ...original,
    "module-safe.ts": "function boot() { return 42; } boot();",
    "index.ts": `${original["index.ts"]}\nimport "./module-safe";`,
  }, baseline);
  assert.deepEqual(safeCall.violations, []);

  const deadDdl = checkFixture({
    ...original,
    "module-dead.ts": "function neverCalled() { client.query(`CREATE TABLE module_dead_ddl (id uuid)`); }",
    "index.ts": `${original["index.ts"]}\nimport "./module-dead";`,
  }, baseline);
  assert.deepEqual(deadDdl.violations, []);

  const deferredCallbacks = checkFixture({
    ...original,
    "module-deferred.ts": `
      export function exportedNeverCalled() { client.query(\`CREATE TABLE exported_dead_ddl (id uuid)\`); }
      registerRoute("/later", () => client.query(\`CREATE TABLE route_deferred_ddl (id uuid)\`));
      setInterval(() => client.query(\`CREATE TABLE interval_deferred_ddl (id uuid)\`), 1000);
      process.on("later", () => client.query(\`CREATE TABLE process_deferred_ddl (id uuid)\`));
      class NeverInstantiated { run() { client.query(\`CREATE TABLE class_dead_ddl (id uuid)\`); } }
    `,
    "index.ts": `${original["index.ts"]}\nimport "./module-deferred";`,
  }, baseline);
  assert.deepEqual(deferredCallbacks.violations, []);
});

test("module evaluation keeps nested SQL sink traversal without double counting", () => {
  const original = fixture();
  const baseline = baselineFor(original);
  const expectSingleNestedOperation = (
    moduleName: string,
    moduleSource: string,
    operationName: string,
  ): void => {
    const report = checkFixture({
      ...original,
      [moduleName]: moduleSource,
      "index.ts": `${original["index.ts"]}\nimport "./${moduleName.replace(/\.ts$/u, "")}";`,
    }, baseline);
    const matching = report.violations.filter((violation) =>
      violation.reason === "unexpected-startup-ddl-root"
      && violation.detail.includes("create-table")
      && violation.detail.includes(operationName)
      && violation.detail.includes(moduleName));
    assert.equal(matching.length, 1);
    assert.equal(matching[0]!.detail.split(operationName).length - 1, 1);
  };

  expectSingleNestedOperation(
    "module-nested-promise.ts",
    "Promise.all([client.query(`CREATE TABLE module_nested_promise (id uuid)`)]);",
    "module_nested_promise",
  );
  expectSingleNestedOperation(
    "module-nested-wrapper.ts",
    "unresolvedWrapper(client.query(`CREATE TABLE module_nested_wrapper (id uuid)`));",
    "module_nested_wrapper",
  );
  expectSingleNestedOperation(
    "module-nested-constructor.ts",
    "new UnknownThing(client.query(`CREATE TABLE module_nested_constructor (id uuid)`));",
    "module_nested_constructor",
  );
  expectSingleNestedOperation(
    "module-nested-object.ts",
    "register({ init: client.query(`CREATE TABLE module_nested_object (id uuid)`) });",
    "module_nested_object",
  );
});