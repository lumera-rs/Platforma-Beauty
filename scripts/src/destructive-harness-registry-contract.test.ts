import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertRegisteredHarnessInvokesSharedGuard,
  removeOnlySharedDestructiveGuardCalls,
} from "./destructive-harness-registry-contract";
import { registeredDestructiveHarnesses } from "./destructive-harness-registry";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

test("every registered destructive harness invokes its imported or sourced shared guard", async () => {
  for (const registration of registeredDestructiveHarnesses) {
    const source = await readFile(path.join(workspaceRoot, registration.sourcePath), "utf8");
    assert.doesNotThrow(
      () => assertRegisteredHarnessInvokesSharedGuard(registration, source),
      registration.name,
    );
  }
});

test("imports, sourced helpers, unrelated same-name calls, strings, and comments are insufficient", async (t) => {
  const typescriptRegistration = registeredDestructiveHarnesses.find(
    ({ guardContract }) => guardContract === "typescript",
  );
  const shellRegistration = registeredDestructiveHarnesses.find(
    ({ guardContract }) => guardContract === "shell",
  );
  assert.ok(typescriptRegistration);
  assert.ok(shellRegistration);

  assert.throws(
    () => assertRegisteredHarnessInvokesSharedGuard(
      typescriptRegistration,
      'import { assertDestructiveTestRuntimeAllowed } from "./destructive-test-runtime";\n'
        + 'const name = "assertDestructiveTestRuntimeAllowed(process.env)";\n',
    ),
    new Error(`${typescriptRegistration.name} must invoke the shared destructive-runtime guard`),
  );
  assert.throws(
    () => assertRegisteredHarnessInvokesSharedGuard(
      typescriptRegistration,
      'import { assertDestructiveTestRuntimeAllowed } from "./unrelated-module";\n'
        + 'assertDestructiveTestRuntimeAllowed(process.env, "unrelated");\n'
        + '// assertDestructiveTestRuntimeAllowed(process.env, "comment");\n',
    ),
    new Error(`${typescriptRegistration.name} must invoke the shared destructive-runtime guard`),
  );
  assert.throws(
    () => assertRegisteredHarnessInvokesSharedGuard(
      shellRegistration,
      'source "./src/destructive-test-runtime.sh"\n'
        + '# assert_destructive_test_runtime_allowed "not a call"\n',
    ),
    new Error(`${shellRegistration.name} must invoke the shared destructive-runtime guard`),
  );

  const originalTypescriptPredicate = /assertDestructiveTestRuntimeAllowed/;
  for (const name of ["external database pool integration", "HTTP security hardening"]) {
    const registration = registeredDestructiveHarnesses.find((candidate) => candidate.name === name);
    assert.ok(registration);
    const source = await readFile(path.join(workspaceRoot, registration.sourcePath), "utf8");
    const importOnlyMutation = removeOnlySharedDestructiveGuardCalls(registration, source);
    assert.equal(originalTypescriptPredicate.test(importOnlyMutation), true);
    assert.throws(
      () => assertRegisteredHarnessInvokesSharedGuard(registration, importOnlyMutation),
      new Error(`${registration.name} must invoke the shared destructive-runtime guard`),
    );
    t.diagnostic(`current reproduction: original predicate accepted import-only ${registration.name} mutation`);
  }
});

for (const [index, registration] of registeredDestructiveHarnesses.entries()) {
  test(`scratch remove-only-call mutation is rejected: ${registration.name}`, async (t) => {
    const scratchRoot = await mkdtemp(path.join(os.tmpdir(), "destructive-registry-mutation-"));
    t.after(() => rm(scratchRoot, { force: true, recursive: true }));
    const source = await readFile(path.join(workspaceRoot, registration.sourcePath), "utf8");
    const mutatedSource = removeOnlySharedDestructiveGuardCalls(registration, source);
    const scratchPath = path.join(
      scratchRoot,
      `${String(index + 1).padStart(2, "0")}-${path.basename(registration.sourcePath)}`,
    );
    await writeFile(scratchPath, mutatedSource, "utf8");
    const scratchSource = await readFile(scratchPath, "utf8");

    let observed: unknown;
    try {
      assertRegisteredHarnessInvokesSharedGuard(registration, scratchSource);
    } catch (error) {
      observed = error;
    }
    const expected = `${registration.name} must invoke the shared destructive-runtime guard`;
    assert.ok(observed instanceof Error);
    assert.equal(observed.message, expected);
    t.diagnostic(`observed failure: ${observed.message}`);
  });
}