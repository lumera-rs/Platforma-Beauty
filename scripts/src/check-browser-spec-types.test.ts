import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectBrowserSpecImportDiagnostics } from "./check-browser-spec-types";

test("browser preflight rejects unknown identifiers and broken imports", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-browser-types-"));
  try {
    const modulePath = path.join(fixtureRoot, "helpers.ts");
    const specPath = path.join(fixtureRoot, "broken.spec.ts");
    await writeFile(modulePath, "export const existingHelper = () => undefined;\n");
    await writeFile(
      specPath,
      [
        'import { missingHelper } from "./helpers";',
        'import "./missing-module";',
        "missingHelper();",
        "unknownIdentifier();",
      ].join("\n"),
    );

    const diagnostics = collectBrowserSpecImportDiagnostics({
      rootNames: [specPath],
      diagnosticRoot: fixtureRoot,
    });

    const diagnosticCodes = new Set(diagnostics.map(({ code }) => code));
    assert.ok(diagnosticCodes.has(2304), "unknown identifier should fail");
    assert.ok(diagnosticCodes.has(2307), "nonexistent module should fail");
    assert.ok(
      diagnosticCodes.has(2305) || diagnosticCodes.has(2724),
      "nonexistent named export should fail",
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});