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
const branchCiPath = path.join(workspaceRoot, ".github", "workflows", "ci.yml");
const workflowLintPath = path.join(
  workspaceRoot,
  ".github",
  "workflows",
  "workflow-lint.yml",
);

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

test("branch CI runs the database-free release-chain gate before slower work", async () => {
  const workflow = await readFile(branchCiPath, "utf8");

  assert.match(workflow, /^on:\n  pull_request:\n  push:/m);
  assert.match(
    workflow,
    /release-chain:\n(?: {4}.*\n)*? {4}env:\n(?: {6}.*\n)*? {6}DATABASE_URL: ""/,
    "The early CI job must explicitly clear DATABASE_URL.",
  );
  assert.match(
    workflow,
    /run: env -u DATABASE_URL pnpm run test:release-chain/,
    "Branch CI must run the release-chain test with DATABASE_URL removed.",
  );

  const releaseJob = workflow.slice(
    workflow.indexOf("  release-chain:"),
    workflow.indexOf("\n  build:"),
  );
  assert.doesNotMatch(
    releaseJob,
    /playwright|validate:release|validate:publish|test:browser|drizzle|DATABASE_URL: [^"'\s]/i,
    "The early gate must not prepare a database, run browser tests, or invoke the slower release lifecycle.",
  );
  assert.match(
    workflow,
    /\n  build:\n {4}name: .*\n {4}needs: release-chain\n/,
    "Slower CI work must depend on the release-chain job.",
  );
});

test("workflow syntax lint runs locally and in an independent database-free CI job", async () => {
  const [workflow, packageJsonSource] = await Promise.all([
    readFile(workflowLintPath, "utf8"),
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
  ]);
  const scripts =
    (JSON.parse(packageJsonSource) as { scripts?: Record<string, string> })
      .scripts ?? {};

  assert.equal(
    scripts["test:github-workflows"],
    "bash scripts/lint-github-workflows.sh",
    "Workflow lint must be directly runnable without database access.",
  );
  assert.match(workflow, /^on:\n  pull_request:\n  push:/m);
  assert.match(workflow, /DATABASE_URL: ""/);
  assert.match(
    workflow,
    /run: env -u DATABASE_URL pnpm run test:github-workflows/,
    "The independent CI job must lint workflows with DATABASE_URL removed.",
  );
  assert.doesNotMatch(
    workflow,
    /playwright|postgres|validate:release|validate:publish|test:browser|drizzle|\$\{\{\s*secrets\./i,
    "Workflow lint must remain independent of databases, browsers, release checks, and repository secrets.",
  );
});

test("branch CI isolates database checks and orders browser journeys after every prerequisite", async () => {
  const [workflow, packageJsonSource] = await Promise.all([
    readFile(branchCiPath, "utf8"),
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
  ]);
  const scripts =
    (JSON.parse(packageJsonSource) as { scripts?: Record<string, string> })
      .scripts ?? {};

  assert.equal(
    scripts["validate:ci:build"],
    "export CI=true && pnpm run build && pnpm run test:beauty-marketplace-typecheck && pnpm run test:frontend-generated-typecheck && pnpm run test:api-server-typecheck && pnpm run test:browser-fixtures && pnpm run test:bundle-budget && pnpm run test:frontend-standards && pnpm run test:frontend-interactions",
    "The build CI command must preserve every genuinely database-free phase-one publish check.",
  );
  assert.equal(
    scripts["validate:ci:database"],
    "export CI=true && pnpm run test:monitoring && pnpm run test:backend-standards:static && pnpm run validate:release:2-backend && pnpm run validate:release:3-api",
    "The database CI command must preserve every phase-one database check plus ordered backend and API release phases.",
  );
  assert.equal(
    scripts["validate:ci:browser"],
    "export CI=true && pnpm run validate:release:4-isolated && pnpm run validate:release:5-final",
    "The browser CI command must preserve the remaining user-journey and final release phases.",
  );

  const buildJob = workflow.slice(
    workflow.indexOf("  build:"),
    workflow.indexOf("\n  database:"),
  );
  assert.match(buildJob, /needs: release-chain/);
  assert.match(
    buildJob,
    /run: env -u DATABASE_URL pnpm run validate:ci:build/,
    "Build and static checks must run without database access.",
  );
  assert.doesNotMatch(buildJob, /\$\{\{\s*secrets\./);

  const databaseJob = workflow.slice(
    workflow.indexOf("  database:"),
    workflow.indexOf("\n  browser:"),
  );
  assert.match(databaseJob, /needs: release-chain/);
  assert.match(databaseJob, /image: postgres:16/);
  assert.match(databaseJob, /POSTGRES_DB: lumera_ci_database/);
  assert.match(
    databaseJob,
    /DATABASE_URL: postgres:\/\/lumera_ci:lumera_ci@localhost:5432\/lumera_ci_database/,
  );
  assert.match(databaseJob, /run: pnpm --filter @workspace\/db run push-force/);
  assert.match(databaseJob, /run: pnpm run validate:ci:database/);
  assert.doesNotMatch(
    databaseJob,
    /\$\{\{\s*secrets\./,
    "Database checks must not consume repository secrets.",
  );

  const browserJob = workflow.slice(workflow.indexOf("  browser:"));
  assert.match(
    browserJob,
    /needs:\n {6}- release-chain\n {6}- build\n {6}- database/,
    "Browser journeys must wait for the early gate, build, and database checks.",
  );
  assert.match(browserJob, /image: postgres:16/);
  assert.match(browserJob, /POSTGRES_DB: lumera_ci_browser/);
  assert.match(browserJob, /playwright install --with-deps chromium/);
  assert.match(browserJob, /run: pnpm run validate:ci:browser/);
  assert.match(
    browserJob,
    /if: \$\{\{ failure\(\) && \(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository\) \}\}/,
    "Browser diagnostics must upload after failures without exposing fork pull requests.",
  );
  assert.match(browserJob, /continue-on-error: true/);
  assert.match(browserJob, /uses: actions\/upload-artifact@v4/);
  assert.match(browserJob, /scripts\/playwright-report\//);
  assert.match(browserJob, /scripts\/test-results\//);
  assert.match(browserJob, /retention-days: 7/);
  assert.doesNotMatch(
    browserJob,
    /\$\{\{\s*secrets\./,
    "Browser checks must use CI-only local values instead of repository secrets.",
  );
});

test("manual CI probe verifies complete Playwright diagnostics without exposing fork pull requests", async () => {
  const [workflow, playwrightConfig] = await Promise.all([
    readFile(branchCiPath, "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "playwright.config.ts"), "utf8"),
  ]);

  assert.match(
    workflow,
    /workflow_dispatch:\n {4}inputs:\n {6}run_failure_diagnostics_probe:/,
    "The controlled failure must be opt-in and manually dispatched.",
  );
  const probeJob = workflow.slice(workflow.indexOf("  failure-diagnostics-probe:"));
  assert.match(
    workflow,
    /Actions → Branch CI → Run workflow → enable run_failure_diagnostics_probe/,
    "The workflow must document how to repeat the controlled probe safely.",
  );
  assert.match(
    workflow,
    /expected to finish red after it verifies and uploads/,
    "The workflow must document the expected controlled-failure result.",
  );
  assert.match(
    probeJob,
    /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.run_failure_diagnostics_probe && github\.repository == github\.event\.repository\.full_name \}\}/,
    "The diagnostics probe must not run for pull requests, including fork pull requests.",
  );
  assert.match(probeJob, /LUMERA_CI_DIAGNOSTICS_PROBE: "1"/);
  assert.match(probeJob, /id: probe\n {8}continue-on-error: true/);
  assert.match(probeJob, /test -f scripts\/playwright-report\/index\.html/);
  assert.match(probeJob, /find scripts\/test-results -type f -name '\*\.png'/);
  assert.match(probeJob, /find scripts\/test-results -type f -name 'trace\.zip'/);
  assert.match(probeJob, /uses: actions\/upload-artifact@v4/);
  assert.match(probeJob, /if-no-files-found: error/);
  assert.match(
    playwrightConfig,
    /testMatch: ciDiagnosticsProbe \? "ci-failure-diagnostics-probe\.spec\.ts" : undefined/,
  );
  assert.match(playwrightConfig, /globalSetup: ciDiagnosticsProbe \? undefined :/);
  assert.match(playwrightConfig, /trace: "retain-on-failure"/);
  assert.match(playwrightConfig, /screenshot: "only-on-failure"/);
});

test("booking-settings browser checks use a disposable database harness", async () => {
  const scriptsPackageJson = JSON.parse(
    await readFile(path.join(workspaceRoot, "scripts", "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const command = scriptsPackageJson.scripts?.["test:booking-settings"];

  assert.equal(
    command,
    "tsx ./src/run-booking-settings-browser.ts",
    "Booking-settings must use the isolated browser harness instead of requiring a shared CI web server.",
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