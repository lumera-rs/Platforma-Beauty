import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  checkProductionStartupDdlInventory,
  checkRealRepositoryProductionStartupDdlInventory,
  EXPECTED_STARTUP_DDL_ROOTS,
  type StartupDdlBaseline,
} from "./production-startup-ddl-inventory";

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