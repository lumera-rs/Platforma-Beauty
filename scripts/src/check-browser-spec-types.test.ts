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