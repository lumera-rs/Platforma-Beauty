import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

const requiredIsolatedBrowserGateScripts = [
  "test:beauty-jobs-browser",
  "test:education-group-online-consent-browser",
  "test:education-dispute-browser",
] as const;

const requiredIsolatedBrowserGatePhase = "validate:release:4-isolated";

function chainedPnpmScripts(command: string): string[] {
  return command.split(" && ").flatMap((step) => {
    const match = /^pnpm run ([\w:-]+)$/.exec(step);
    return match ? [match[1]] : [];
  });
}

test("publish validation checks the release chain first without database access", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const publishCommand = packageJson.scripts?.["validate:publish"];

  assert.ok(publishCommand, "validate:publish must be defined.");
  assert.match(
    publishCommand,
    /^export CI=true && env -u DATABASE_URL pnpm run test:release-chain && /,
    "validate:publish must fail on an invalid release chain before build, database, or browser work and without DATABASE_URL.",
  );
  assert.equal(
    publishCommand.match(/(?:^| )pnpm run test:release-chain(?: |$)/g)?.length,
    1,
    "validate:publish must run the early release-chain gate exactly once.",
  );
});

test("release validation phases preserve the full gate and print safe continuation commands", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  const releaseCommand = scripts["validate:release"];

  assert.ok(releaseCommand, "validate:release must be defined.");
  assert.match(
    releaseCommand,
    /^export CI=true && pnpm run validate:release:\d+-[\w-]+/,
  );
  const releasePhaseNames = chainedPnpmScripts(releaseCommand);
  assert.ok(
    releasePhaseNames.length > 0,
    "validate:release must invoke at least one release phase.",
  );
  assert.equal(
    releaseCommand,
    `export CI=true && ${releasePhaseNames.map((name) => `pnpm run ${name}`).join(" && ")}`,
    "validate:release must remain an ordered, fail-fast chain of release phases.",
  );

  releasePhaseNames.forEach((phaseName, phaseIndex) => {
    const phaseCommand = scripts[phaseName];
    assert.ok(phaseCommand, `${phaseName} must be defined.`);
    const phaseNumber = phaseIndex + 1;
    const phaseCount = releasePhaseNames.length;
    assert.match(
      phaseCommand,
      new RegExp(
        `^export CI=true && echo 'Release phase ${phaseNumber}\\/${phaseCount}:`,
      ),
    );
    if (phaseIndex < releasePhaseNames.length - 1) {
      assert.match(
        phaseCommand,
        new RegExp(
          `Release phase ${phaseNumber}\\/${phaseCount} complete\\. Continue with: pnpm run ${
            releasePhaseNames[phaseIndex + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          }`,
        ),
      );
    } else {
      assert.match(
        phaseCommand,
        new RegExp(
          `Release phase ${phaseNumber}\\/${phaseCount} complete\\. All release checks passed\\.`,
        ),
      );
    }

    const phaseSteps = phaseCommand.split(" && ");
    const phaseGateCommands = chainedPnpmScripts(phaseCommand);
    const expectedCompletionStep = phaseIndex < releasePhaseNames.length - 1
      ? `echo 'Release phase ${phaseNumber}/${phaseCount} complete. Continue with: pnpm run ${releasePhaseNames[phaseIndex + 1]}'`
      : `echo 'Release phase ${phaseNumber}/${phaseCount} complete. All release checks passed.'`;
    assert.equal(
      phaseSteps.length,
      phaseGateCommands.length + 3,
      `${phaseName} must contain only CI setup, its opening message, an ordered fail-fast gate, and its completion message.`,
    );
    assert.equal(
      phaseSteps.at(-1),
      expectedCompletionStep,
      `${phaseName} must print its completion message only after every gate passes.`,
    );
    assert.ok(
      phaseGateCommands.length > 0,
      `${phaseName} must invoke at least one release gate.`,
    );
  });
});

test("required isolated browser checks remain wired into the release gate", async () => {
  const [rootPackageJson, scriptsPackageJson] = await Promise.all([
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "package.json"), "utf8"),
  ]);
  const rootScripts = (JSON.parse(rootPackageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  const packageScripts = (JSON.parse(scriptsPackageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  const releaseCommand = rootScripts["validate:release"];
  const isolatedPhaseCommand = rootScripts[requiredIsolatedBrowserGatePhase];

  assert.ok(releaseCommand, "validate:release must be defined.");
  assert.match(
    releaseCommand,
    new RegExp(`(?:^| && )pnpm run ${requiredIsolatedBrowserGatePhase}(?: && |$)`),
    `validate:release must invoke ${requiredIsolatedBrowserGatePhase}.`,
  );
  assert.ok(isolatedPhaseCommand, `${requiredIsolatedBrowserGatePhase} must be defined.`);

  for (const scriptName of requiredIsolatedBrowserGateScripts) {
    assert.ok(rootScripts[scriptName], `Root script ${scriptName} must be defined.`);
    assert.match(
      rootScripts[scriptName],
      new RegExp(`(?:^| )run ${scriptName}(?: |$)`),
      `Root script ${scriptName} must delegate to the scripts package.`,
    );
    assert.ok(packageScripts[scriptName], `Scripts package command ${scriptName} must be defined.`);
    assert.match(
      isolatedPhaseCommand,
      new RegExp(`(?:^| && )pnpm run ${scriptName}(?: && |$)`),
      `${requiredIsolatedBrowserGatePhase} must invoke ${scriptName}.`,
    );
  }
});