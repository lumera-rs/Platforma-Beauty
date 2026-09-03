import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectBrowserTestDirectories,
  collectUncoveredBrowserFiles,
  collectBrowserSpecDiagnostics,
  collectUncoveredBrowserRunnerConfigs,
} from "./check-browser-spec-types";

test("browser preflight derives and checks a custom testDir from every runner config", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-custom-test-dir-"),
  );
  try {
    const browserRoot = path.join(fixtureRoot, "browser");
    const customRoot = path.join(fixtureRoot, "custom-browser");
    const omittedSpec = path.join(customRoot, "moved.spec.ts");
    const tsconfigPath = path.join(fixtureRoot, "tsconfig.browser.json");
    await mkdir(browserRoot);
    await mkdir(customRoot);
    await writeFile(
      path.join(fixtureRoot, "playwright.config.ts"),
      'export default { testDir: "./browser" };\n',
    );
    await writeFile(
      path.join(fixtureRoot, "playwright.custom.config.ts"),
      'export default defineConfig({ testDir: "./custom-browser" });\n',
    );
    await writeFile(path.join(browserRoot, "covered.spec.ts"), "export {};\n");
    await writeFile(omittedSpec, "export {};\n");
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: { noEmit: true },
        include: ["browser/**/*.ts", "playwright*.config.ts"],
      }),
    );

    assert.deepEqual(
      collectBrowserTestDirectories({ scriptsRoot: fixtureRoot }),
      [browserRoot, customRoot].sort(),
    );
    assert.deepEqual(
      collectUncoveredBrowserFiles({
        scriptsRoot: fixtureRoot,
        configPath: tsconfigPath,
      }),
      [omittedSpec],
    );

    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: { noEmit: true },
        include: [
          "browser/**/*.ts",
          "custom-browser/**/*.ts",
          "playwright*.config.ts",
        ],
      }),
    );
    assert.deepEqual(
      collectUncoveredBrowserFiles({
        scriptsRoot: fixtureRoot,
        configPath: tsconfigPath,
      }),
      [],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight resolves const configs, relative imports, and ordered object spreads", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-static-config-"),
  );
  try {
    const sharedRoot = path.join(fixtureRoot, "shared-browser");
    const overriddenRoot = path.join(fixtureRoot, "overridden-browser");
    await mkdir(sharedRoot);
    await mkdir(overriddenRoot);
    await writeFile(
      path.join(fixtureRoot, "playwright.shared.ts"),
      [
        'const testDir = "./shared-browser";',
        "export const shared = { testDir };",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "playwright.config.ts"),
      [
        'import { shared as imported } from "./playwright.shared";',
        "const config = { ...imported };",
        "export default defineConfig(config);",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "playwright.visual.config.ts"),
      [
        'import shared from "./visual.shared";',
        'const testDir = "./overridden-browser";',
        "export default { testDir: './ignored', ...shared, testDir };",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "visual.shared.ts"),
      'export default { testDir: "./shared-browser" };\n',
    );

    assert.deepEqual(
      collectBrowserTestDirectories({ scriptsRoot: fixtureRoot }),
      [overriddenRoot, sharedRoot].sort(),
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight fails closed for runtime-dependent and unresolvable config values", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-dynamic-config-"),
  );
  try {
    const configPath = path.join(fixtureRoot, "playwright.config.ts");
    await writeFile(
      configPath,
      'const testDir = process.env.TEST_DIR; export default { testDir };\n',
    );
    assert.throws(
      () => collectBrowserTestDirectories({ scriptsRoot: fixtureRoot }),
      /statically resolvable.*runtime-dependent expression.*playwright\.config\.ts/,
    );

    await writeFile(
      configPath,
      "export default { ...makeConfig() };\n",
    );
    assert.throws(
      () => collectBrowserTestDirectories({ scriptsRoot: fixtureRoot }),
      /statically resolvable.*runtime-dependent expression.*playwright\.config\.ts/,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight rejects every spec-local diagnostic but ignores imported source diagnostics", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-types-"),
  );
  try {
    const specRoot = path.join(fixtureRoot, "browser");
    await mkdir(specRoot);
    const modulePath = path.join(fixtureRoot, "helpers.ts");
    const specPath = path.join(specRoot, "broken.spec.ts");
    await writeFile(modulePath, "export const existingHelper: string = 123;\n");
    await writeFile(
      specPath,
      [
        'import { existingHelper, missingHelper } from "../helpers";',
        'import "./missing-module";',
        "const count: number = existingHelper;",
        "missingHelper();",
        "unknownIdentifier();",
      ].join("\n"),
    );

    const diagnostics = collectBrowserSpecDiagnostics({
      rootNames: [specPath],
      diagnosticRoot: specRoot,
    });

    const diagnosticCodes = new Set(diagnostics.map(({ code }) => code));
    assert.ok(
      diagnosticCodes.has(2322),
      "spec-local type mismatch should fail",
    );
    assert.ok(diagnosticCodes.has(2304), "unknown identifier should fail");
    assert.ok(diagnosticCodes.has(2307), "nonexistent module should fail");
    assert.ok(
      diagnosticCodes.has(2305) || diagnosticCodes.has(2724),
      "nonexistent named export should fail",
    );
    assert.equal(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === modulePath,
      ),
      false,
      "imported application source diagnostics should remain outside the gate",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight rejects recognized runner configs omitted from the browser TypeScript project", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-roots-"),
  );
  try {
    const browserRoot = path.join(fixtureRoot, "browser");
    const configPath = path.join(fixtureRoot, "playwright.config.ts");
    const omittedConfigPath = path.join(
      fixtureRoot,
      "playwright.visual.config.ts",
    );
    const omittedJavaScriptConfigPath = path.join(
      fixtureRoot,
      "playwright.mobile.config.mjs",
    );
    const tsconfigPath = path.join(fixtureRoot, "tsconfig.browser.json");
    await mkdir(browserRoot);
    await writeFile(path.join(browserRoot, "example.spec.ts"), "export {};\n");
    await writeFile(configPath, "export default {};\n");
    await writeFile(omittedConfigPath, "export default {};\n");
    await writeFile(omittedJavaScriptConfigPath, "export default {};\n");
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: { noEmit: true },
        include: ["browser/**/*.ts", "playwright.config.ts"],
      }),
    );

    assert.deepEqual(
      collectUncoveredBrowserRunnerConfigs({
        scriptsRoot: fixtureRoot,
        configPath: tsconfigPath,
      }),
      [omittedJavaScriptConfigPath, omittedConfigPath].sort(),
    );

    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: { allowJs: true, checkJs: true, noEmit: true },
        include: [
          "browser/**/*.ts",
          "playwright*.config.ts",
          "playwright*.config.mjs",
        ],
      }),
    );
    assert.deepEqual(
      collectUncoveredBrowserRunnerConfigs({
        scriptsRoot: fixtureRoot,
        configPath: tsconfigPath,
      }),
      [],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight checks JavaScript runner config roots but ignores imported application source diagnostics", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-js-config-types-"),
  );
  try {
    const modulePath = path.join(fixtureRoot, "application-source.js");
    const configPath = path.join(fixtureRoot, "playwright.config.js");
    const tsconfigPath = path.join(fixtureRoot, "tsconfig.browser.json");
    await writeFile(
      modulePath,
      "/** @type {string} */\nexport const applicationValue = 123;\n",
    );
    await writeFile(
      configPath,
      [
        'import { applicationValue } from "./application-source.js";',
        "/** @type {number} */",
        "const configValue = applicationValue;",
        "unknownConfigIdentifier();",
      ].join("\n"),
    );
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          noEmit: true,
        },
        include: ["playwright*.config.js"],
      }),
    );

    assert.deepEqual(
      collectUncoveredBrowserRunnerConfigs({
        scriptsRoot: fixtureRoot,
        configPath: tsconfigPath,
      }),
      [],
    );

    const diagnostics = collectBrowserSpecDiagnostics({
      rootNames: [configPath],
      diagnosticRoot: path.join(fixtureRoot, "browser"),
    });

    const diagnosticCodes = new Set(diagnostics.map(({ code }) => code));
    assert.ok(
      diagnosticCodes.has(2322),
      "JavaScript config-local type mismatch should fail",
    );
    assert.ok(
      diagnosticCodes.has(2304),
      "JavaScript config-local unknown identifier should fail",
    );
    assert.equal(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === modulePath,
      ),
      false,
      "imported JavaScript application source diagnostics should remain outside the gate",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight includes and checks every JavaScript-family browser test and fixture extension", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-js-files-"),
  );
  try {
    const browserRoot = path.join(fixtureRoot, "browser");
    const tsconfigPath = path.join(fixtureRoot, "tsconfig.browser.json");
    const extensions = ["js", "jsx", "mjs", "cjs"];
    await mkdir(browserRoot);
    const browserFiles = await Promise.all(
      extensions.flatMap((extension) =>
        ["spec", "fixture"].map(async (kind) => {
          const filePath = path.join(
            browserRoot,
            `broken-${extension}.${kind}.${extension}`,
          );
          await writeFile(filePath, "unknownBrowserIdentifier();\n");
          return filePath;
        }),
      ),
    );
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          jsx: "preserve",
          noEmit: true,
        },
        include: [
          "browser/**/*.js",
          "browser/**/*.jsx",
          "browser/**/*.mjs",
          "browser/**/*.cjs",
        ],
      }),
    );

    assert.deepEqual(
      collectUncoveredBrowserFiles({
        scriptsRoot: fixtureRoot,
        browserRoot,
        configPath: tsconfigPath,
      }),
      [],
    );

    const diagnostics = collectBrowserSpecDiagnostics({
      rootNames: browserFiles,
      diagnosticRoot: browserRoot,
    });
    assert.equal(
      diagnostics.filter(({ code }) => code === 2304).length,
      browserFiles.length,
      "every JavaScript-family browser spec and fixture should be checked",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight clearly reports supported browser files omitted from the project", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-file-roots-"),
  );
  try {
    const browserRoot = path.join(fixtureRoot, "browser");
    const omittedFixture = path.join(browserRoot, "helpers.fixture.cjs");
    const tsconfigPath = path.join(fixtureRoot, "tsconfig.browser.json");
    await mkdir(browserRoot);
    await writeFile(path.join(browserRoot, "example.spec.ts"), "export {};\n");
    await writeFile(omittedFixture, "module.exports = {};\n");
    await writeFile(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: { allowJs: true, checkJs: true, noEmit: true },
        include: ["browser/**/*.ts"],
      }),
    );

    assert.deepEqual(
      collectUncoveredBrowserFiles({
        scriptsRoot: fixtureRoot,
        browserRoot,
        configPath: tsconfigPath,
      }),
      [omittedFixture],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight rejects every runner config root but ignores imported source diagnostics", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-config-types-"),
  );
  try {
    const modulePath = path.join(fixtureRoot, "application-source.ts");
    const configPath = path.join(fixtureRoot, "playwright.config.ts");
    const additionalConfigPath = path.join(
      fixtureRoot,
      "playwright.visual.config.ts",
    );
    await writeFile(
      modulePath,
      "export const applicationValue: string = 123;\n",
    );
    await writeFile(
      configPath,
      [
        'import { applicationValue } from "./application-source";',
        "const configValue: number = applicationValue;",
        "unknownConfigIdentifier();",
      ].join("\n"),
    );
    await writeFile(
      additionalConfigPath,
      [
        'import { applicationValue } from "./application-source";',
        "const visualConfigValue: boolean = applicationValue;",
        "unknownVisualConfigIdentifier();",
      ].join("\n"),
    );

    const diagnostics = collectBrowserSpecDiagnostics({
      rootNames: [configPath, additionalConfigPath],
      diagnosticRoot: path.join(fixtureRoot, "browser"),
    });

    const diagnosticCodes = new Set(diagnostics.map(({ code }) => code));
    assert.ok(
      diagnosticCodes.has(2322),
      "config-local type mismatch should fail",
    );
    assert.ok(
      diagnosticCodes.has(2304),
      "config-local unknown identifier should fail",
    );
    assert.ok(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === additionalConfigPath,
      ),
      "a newly added runner config root should fail without a separate allowlist update",
    );
    assert.equal(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === modulePath,
      ),
      false,
      "application source imported by config should remain outside the gate",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight resolves and checks statically consumed package folder entry points but not application imports", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-shared-config-types-"),
  );
  try {
    const browserRoot = path.join(fixtureRoot, "browser");
    const sharedConfigRoot = path.join(fixtureRoot, "playwright.shared");
    const sharedConfigPath = path.join(sharedConfigRoot, "settings.ts");
    const indexFallbackPath = path.join(sharedConfigRoot, "index.ts");
    const applicationPath = path.join(fixtureRoot, "application-source.ts");
    const configPath = path.join(fixtureRoot, "playwright.config.ts");
    await mkdir(browserRoot);
    await mkdir(sharedConfigRoot);
    await writeFile(
      path.join(sharedConfigRoot, "package.json"),
      JSON.stringify({ main: "./settings.ts" }),
    );
    await writeFile(
      indexFallbackPath,
      [
        'export const testDir: string = "./browser";',
        "export const shared = { testDir };",
        "unknownIndexFallbackIdentifier();",
      ].join("\n"),
    );
    await writeFile(
      sharedConfigPath,
      [
        'export const testDir: string = "./browser";',
        "export const shared = { testDir };",
        "unknownSharedConfigIdentifier();",
      ].join("\n"),
    );
    await writeFile(
      applicationPath,
      [
        "export const applicationValue: string = 123;",
        "unknownApplicationIdentifier();",
      ].join("\n"),
    );
    await writeFile(
      configPath,
      [
        'import { shared } from "./playwright.shared";',
        'import { applicationValue } from "./application-source";',
        "void applicationValue;",
        "export default { ...shared };",
      ].join("\n"),
    );

    const diagnostics = collectBrowserSpecDiagnostics({
      rootNames: [configPath],
      diagnosticRoot: browserRoot,
    });

    assert.equal(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === sharedConfigPath,
      ),
      true,
      "a shared package folder entry point statically consumed by the config should fail the gate",
    );
    assert.equal(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === indexFallbackPath,
      ),
      false,
      "an index fallback bypassed by the package entry should stay excluded",
    );
    assert.equal(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === applicationPath,
      ),
      false,
      "an application module imported but not statically consumed should stay excluded",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight resolves a simple package exports root and checks only statically consumed settings", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-package-exports-"),
  );
  try {
    const browserRoot = path.join(fixtureRoot, "browser");
    const sharedConfigRoot = path.join(fixtureRoot, "playwright.shared");
    const sharedConfigPath = path.join(sharedConfigRoot, "settings.ts");
    const applicationPath = path.join(fixtureRoot, "application-source.ts");
    const configPath = path.join(fixtureRoot, "playwright.config.ts");
    await mkdir(browserRoot);
    await mkdir(sharedConfigRoot);
    await writeFile(
      path.join(sharedConfigRoot, "package.json"),
      JSON.stringify({ exports: { ".": "./settings.ts" } }),
    );
    await writeFile(
      sharedConfigPath,
      [
        'export const shared = { testDir: "./browser" };',
        "unknownSharedConfigIdentifier();",
      ].join("\n"),
    );
    await writeFile(
      applicationPath,
      "export const applicationValue: string = 123;\n",
    );
    await writeFile(
      configPath,
      [
        'import { shared } from "./playwright.shared";',
        'import { applicationValue } from "./application-source";',
        "void applicationValue;",
        "export default { ...shared };",
      ].join("\n"),
    );

    const diagnostics = collectBrowserSpecDiagnostics({
      rootNames: [configPath],
      diagnosticRoot: browserRoot,
    });

    assert.equal(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === sharedConfigPath,
      ),
      true,
      "the statically consumed exports root should fail the gate",
    );
    assert.equal(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === applicationPath,
      ),
      false,
      "an imported but statically unconsumed module should stay excluded",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("browser preflight fails closed for conditional package export maps", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumera-browser-conditional-exports-"),
  );
  try {
    const sharedConfigRoot = path.join(fixtureRoot, "playwright.shared");
    await mkdir(sharedConfigRoot);
    await writeFile(
      path.join(sharedConfigRoot, "package.json"),
      JSON.stringify({
        exports: {
          ".": {
            import: "./settings.ts",
            default: "./index.ts",
          },
        },
        main: "./settings.ts",
      }),
    );
    await writeFile(
      path.join(sharedConfigRoot, "settings.ts"),
      'export const shared = { testDir: "./browser" };\n',
    );
    await writeFile(
      path.join(sharedConfigRoot, "index.ts"),
      'export const shared = { testDir: "./browser" };\n',
    );
    await writeFile(
      path.join(fixtureRoot, "playwright.config.ts"),
      [
        'import { shared } from "./playwright.shared";',
        "export default { ...shared };",
      ].join("\n"),
    );

    assert.throws(
      () => collectBrowserTestDirectories({ scriptsRoot: fixtureRoot }),
      /statically resolvable.*unresolvable identifier shared.*playwright\.config\.ts/,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
