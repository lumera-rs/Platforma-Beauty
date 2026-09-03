import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectBrowserSpecDiagnostics } from "./check-browser-spec-types";

test("browser preflight rejects every spec-local diagnostic but ignores imported source diagnostics", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-browser-types-"));
  try {
    const specRoot = path.join(fixtureRoot, "browser");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(specRoot));
    const modulePath = path.join(fixtureRoot, "helpers.ts");
    const specPath = path.join(specRoot, "broken.spec.ts");
    await writeFile(
      modulePath,
      'export const existingHelper: string = 123;\n',
    );
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
    assert.ok(diagnosticCodes.has(2322), "spec-local type mismatch should fail");
    assert.ok(diagnosticCodes.has(2304), "unknown identifier should fail");
    assert.ok(diagnosticCodes.has(2307), "nonexistent module should fail");
    assert.ok(
      diagnosticCodes.has(2305) || diagnosticCodes.has(2724),
      "nonexistent named export should fail",
    );
    assert.equal(
      diagnostics.some((diagnostic) => diagnostic.file?.fileName === modulePath),
      false,
      "imported application source diagnostics should remain outside the gate",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});


test("browser preflight rejects every runner config root but ignores imported source diagnostics", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-browser-config-types-"));
  try {
    const modulePath = path.join(fixtureRoot, "application-source.ts");
    const configPath = path.join(fixtureRoot, "playwright.config.ts");
    const additionalConfigPath = path.join(fixtureRoot, "playwright.visual.config.ts");
    await writeFile(modulePath, "export const applicationValue: string = 123;\n");
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
    assert.ok(diagnosticCodes.has(2322), "config-local type mismatch should fail");
    assert.ok(diagnosticCodes.has(2304), "config-local unknown identifier should fail");
    assert.ok(
      diagnostics.some(
        (diagnostic) => diagnostic.file?.fileName === additionalConfigPath,
      ),
      "a newly added runner config root should fail without a separate allowlist update",
    );
    assert.equal(
      diagnostics.some((diagnostic) => diagnostic.file?.fileName === modulePath),
      false,
      "application source imported by config should remain outside the gate",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});