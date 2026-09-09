import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

const requiredOtherIsolatedBrowserGateScripts = [
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
const rulesetAuditScriptPath = path.join(
  workspaceRoot,
  "scripts",
  "verify-github-ruleset.sh",
);

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function chainedPnpmScripts(command: string): string[] {
  return command.split(" && ").flatMap((step) => {
    const match = /^pnpm run ([\w:-]+)$/.exec(step);
    return match ? [match[1]] : [];
  });
}

type FocusedAdministratorBrowserGateInventory = {
  release?: string[];
  localOnly?: string[];
};

type FocusedOwnerBrowserGateInventory = {
  release?: string[];
  localOnly?: string[];
};

type FocusedEmployeeBrowserGateInventory = {
  scriptNamePattern?: string;
  specFilePattern?: string;
  release?: string[];
  localOnly?: string[];
};

function focusedAdministratorBrowserCommands(
  packageScripts: Record<string, string>,
): string[] {
  return Object.entries(packageScripts)
    .filter(([scriptName, command]) =>
      scriptName.startsWith("test:admin-") &&
      (
        command.includes("playwright:checked") ||
        /tsx \.\/src\/run-admin-[\w-]+\.ts(?: |$)/.test(command)
      )
    )
    .map(([scriptName]) => scriptName)
    .sort();
}

function validateFocusedAdministratorBrowserGateInventory(
  packageScripts: Record<string, string>,
  inventory: FocusedAdministratorBrowserGateInventory,
  isolatedPhaseCommand: string,
): void {
  const releaseScripts = inventory.release ?? [];
  const localOnlyScripts = inventory.localOnly ?? [];
  const classifiedScripts = [...releaseScripts, ...localOnlyScripts];
  const discoveredScripts = focusedAdministratorBrowserCommands(packageScripts);

  assert.equal(
    new Set(classifiedScripts).size,
    classifiedScripts.length,
    "Each focused administrator browser command must be classified exactly once in scripts/package.json focusedAdministratorBrowserGates.",
  );
  assert.deepEqual(
    [...classifiedScripts].sort(),
    discoveredScripts,
    "Every test:admin-* browser command must be classified in scripts/package.json focusedAdministratorBrowserGates.release or .localOnly. Add release checks to the release inventory, or explicitly mark diagnostics as localOnly.",
  );

  for (const scriptName of releaseScripts) {
    assert.match(
      isolatedPhaseCommand,
      new RegExp(`(?:^| && )pnpm run ${scriptName}(?: && |$)`),
      `${requiredIsolatedBrowserGatePhase} must invoke release-focused administrator browser command ${scriptName}. Move it to localOnly only if it is intentionally diagnostic.`,
    );
  }
}

function focusedOwnerBrowserCommands(
  packageScripts: Record<string, string>,
): string[] {
  return Object.entries(packageScripts)
    .filter(([scriptName, command]) =>
      scriptName.startsWith("test:owner-") &&
      command.includes("playwright:checked")
    )
    .map(([scriptName]) => scriptName)
    .sort();
}

function validateFocusedOwnerBrowserGateInventory(
  packageScripts: Record<string, string>,
  inventory: FocusedOwnerBrowserGateInventory,
  isolatedPhaseCommand: string,
): void {
  const releaseScripts = inventory.release ?? [];
  const localOnlyScripts = inventory.localOnly ?? [];
  const classifiedScripts = [...releaseScripts, ...localOnlyScripts];
  const discoveredScripts = focusedOwnerBrowserCommands(packageScripts);

  assert.equal(
    new Set(classifiedScripts).size,
    classifiedScripts.length,
    "Each focused salon-owner browser command must be classified exactly once in scripts/package.json focusedOwnerBrowserGates.",
  );
  assert.deepEqual(
    [...classifiedScripts].sort(),
    discoveredScripts,
    "Every test:owner-* Playwright command must be classified in scripts/package.json focusedOwnerBrowserGates.release or .localOnly. Add release checks to the release inventory, or explicitly mark diagnostics as localOnly.",
  );

  for (const scriptName of releaseScripts) {
    assert.match(
      isolatedPhaseCommand,
      new RegExp(`(?:^| && )pnpm run ${scriptName}(?: && |$)`),
      `${requiredIsolatedBrowserGatePhase} must invoke release-focused salon-owner browser command ${scriptName}. Move it to localOnly only if it is intentionally diagnostic.`,
    );
  }
}

function focusedEmployeeBrowserCommands(
  packageScripts: Record<string, string>,
): string[] {
  return Object.entries(packageScripts)
    .filter(([scriptName, command]) =>
      scriptName.startsWith("test:employee-") &&
      /playwright:checked -- browser\/employee-[\w-]+\.spec\.ts(?: |$)/.test(command)
    )
    .map(([scriptName]) => scriptName)
    .sort();
}

function validateFocusedEmployeeBrowserGateInventory(
  packageScripts: Record<string, string>,
  inventory: FocusedEmployeeBrowserGateInventory,
  isolatedPhaseCommand: string,
): void {
  assert.equal(
    inventory.scriptNamePattern,
    "test:employee-*",
    "Focused employee browser commands must follow the documented test:employee-* package-script naming convention.",
  );
  assert.equal(
    inventory.specFilePattern,
    "browser/employee-*.spec.ts",
    "Focused employee browser commands must target the documented browser/employee-*.spec.ts naming convention.",
  );

  const releaseScripts = inventory.release ?? [];
  const localOnlyScripts = inventory.localOnly ?? [];
  const classifiedScripts = [...releaseScripts, ...localOnlyScripts];
  const discoveredScripts = focusedEmployeeBrowserCommands(packageScripts);

  assert.equal(
    new Set(classifiedScripts).size,
    classifiedScripts.length,
    "Each focused employee browser command must be classified exactly once in scripts/package.json focusedEmployeeBrowserGates.",
  );
  assert.deepEqual(
    [...classifiedScripts].sort(),
    discoveredScripts,
    "Every test:employee-* command targeting browser/employee-*.spec.ts must be classified in scripts/package.json focusedEmployeeBrowserGates.release or .localOnly.",
  );

  for (const scriptName of releaseScripts) {
    assert.match(
      isolatedPhaseCommand,
      new RegExp(`(?:^| && )pnpm run ${scriptName}(?: && |$)`),
      `${requiredIsolatedBrowserGatePhase} must invoke release-focused employee browser command ${scriptName}. Move it to localOnly only if it is intentionally diagnostic.`,
    );
  }
}

test("publish validation checks the release chain first without database access", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const publishCommand = packageJson.scripts?.["validate:publish"];
  const normalTypecheckCommand = packageJson.scripts?.typecheck;
  const releaseBuildCommand = packageJson.scripts?.["build:release"];
  const releaseTypecheckCommand = packageJson.scripts?.["typecheck:release"];

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
  assert.match(
    publishCommand,
    /pnpm run build:release && pnpm --filter @workspace\/scripts run typecheck && pnpm run test:beauty-marketplace-typecheck/,
    "validate:publish must run the complete scripts typecheck once after the release build without disturbing the existing static-check order.",
  );
  assert.equal(
    publishCommand.match(/pnpm --filter @workspace\/scripts run typecheck/g)?.length,
    1,
    "validate:publish must run the explicit scripts typecheck exactly once.",
  );
  assert.match(
    normalTypecheckCommand ?? "",
    /--filter "\.\/scripts"/,
    "The normal root build must continue to include the scripts package typecheck.",
  );
  assert.equal(
    releaseBuildCommand,
    "pnpm run typecheck:release && pnpm -r --if-present run build",
    "The release build must preserve the normal recursive build after its release-specific static checks.",
  );
  assert.equal(
    releaseTypecheckCommand,
    'pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --if-present run typecheck',
    "Release typechecking must preserve library and artifact checks while leaving the scripts check to the explicit release gate.",
  );
  assert.doesNotMatch(
    releaseTypecheckCommand,
    /\.\/scripts|@workspace\/scripts/,
    "The release build must not duplicate the explicit scripts typecheck.",
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

test("timed CI build preserves failure details and reports before exiting", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-timings-"));
  const binDir = path.join(tempDir, "bin");
  const reportDir = path.join(tempDir, "reports");
  const invocationLog = path.join(tempDir, "pnpm-invocations.log");
  const fakePnpmPath = path.join(binDir, "pnpm");
  const failureCode = 37;

  await mkdir(binDir);
  await writeFile(
    fakePnpmPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_PNPM_INVOCATION_LOG"
if [[ "$*" == "--filter @workspace/scripts run typecheck" ]]; then
  exit "$FAKE_PNPM_FAILURE_CODE"
fi
exit 0
`,
  );
  await chmod(fakePnpmPath, 0o755);

  const result = await runCommand(
    "bash",
    [path.join(workspaceRoot, "scripts", "run-ci-build-with-timings.sh")],
    {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CI_TIMING_REPORT_DIR: reportDir,
      GITHUB_STEP_SUMMARY: path.join(reportDir, "build-summary.md"),
      FAKE_PNPM_INVOCATION_LOG: invocationLog,
      FAKE_PNPM_FAILURE_CODE: String(failureCode),
    },
  );

  assert.equal(
    result.code,
    failureCode,
    `The timed runner must preserve the failed phase's exit code. stderr: ${result.stderr}`,
  );

  const invocations = (await readFile(invocationLog, "utf8")).trim().split("\n");
  assert.deepEqual(invocations, [
    "run build:release",
    "--filter @workspace/scripts run typecheck",
  ]);

  const report = JSON.parse(
    await readFile(path.join(reportDir, "build-timings.json"), "utf8"),
  ) as {
    status?: string;
    phases?: Array<{ name?: string; durationSeconds?: number }>;
  };
  assert.equal(report.status, "failed");
  assert.deepEqual(
    report.phases?.map((phase) => phase.name),
    ["build:release", "scripts:typecheck", "validate:ci:build:total"],
  );
  assert.ok(
    report.phases?.every(
      (phase) =>
        typeof phase.durationSeconds === "number" &&
        phase.durationSeconds >= 0,
    ),
    "Every completed phase and the total must retain a non-negative duration.",
  );

  const summary = await readFile(
    path.join(reportDir, "build-summary.md"),
    "utf8",
  );
  assert.match(summary, /^### Build timing trend$/m);
  assert.match(summary, /\| scripts:typecheck \|/);
  assert.match(summary, /\| validate:ci:build:total \|/);

  assert.doesNotMatch(
    result.stdout,
    /::group::internal-request-control-outputs/,
    "No phase after the failure may start.",
  );
});

test("timed CI build preserves the build code when report writing also fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-timings-report-failure-"));
  const binDir = path.join(tempDir, "bin");
  const reportDir = path.join(tempDir, "reports");
  const blockedSummaryPath = path.join(tempDir, "blocked-summary");
  const invocationLog = path.join(tempDir, "pnpm-invocations.log");
  const fakePnpmPath = path.join(binDir, "pnpm");
  const failureCode = 43;

  await mkdir(binDir);
  await mkdir(blockedSummaryPath);
  await writeFile(
    fakePnpmPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_PNPM_INVOCATION_LOG"
if [[ "$*" == "--filter @workspace/scripts run typecheck" ]]; then
  printf '%s\\n' "controlled build failure" >&2
  exit "$FAKE_PNPM_FAILURE_CODE"
fi
exit 0
`,
  );
  await chmod(fakePnpmPath, 0o755);

  const result = await runCommand(
    "bash",
    [path.join(workspaceRoot, "scripts", "run-ci-build-with-timings.sh")],
    {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CI_TIMING_REPORT_DIR: reportDir,
      GITHUB_STEP_SUMMARY: blockedSummaryPath,
      FAKE_PNPM_INVOCATION_LOG: invocationLog,
      FAKE_PNPM_FAILURE_CODE: String(failureCode),
    },
  );

  assert.equal(
    result.code,
    failureCode,
    `A report failure must not replace the failed build's exit code. stderr: ${result.stderr}`,
  );
  assert.match(result.stderr, /controlled build failure/);
  assert.match(result.stderr, /Could not write Markdown timing summary/);
  assert.match(
    result.stderr,
    /Build failed with exit code 43; report writing also failed.*original build failure/,
  );

  const report = JSON.parse(
    await readFile(path.join(reportDir, "build-timings.json"), "utf8"),
  ) as { status?: string };
  assert.equal(report.status, "failed");
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
  assert.match(
    workflow,
    /^on:\n  pull_request:\n  merge_group:\n  push:/m,
    "Workflow lint must report its required status for pull requests and merge queue groups.",
  );
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

test("repository audit verifies branch cleanup, merge queue configuration, and a live merge-group run", async () => {
  const auditScript = await readFile(rulesetAuditScriptPath, "utf8");

  assert.match(
    auditScript,
    /expected_repository="lumera-rs\/Platforma-Beauty"/,
    "The audit must be pinned to the intended repository.",
  );
  assert.match(
    auditScript,
    /\.delete_branch_on_merge == true/,
    "The audit must fail unless automatic merged-branch deletion is enabled.",
  );
  assert.doesNotMatch(
    auditScript,
    /curl[\s\S]*?--request\s+(?:POST|PUT|PATCH|DELETE)|curl[\s\S]*?\s-X\s*(?:POST|PUT|PATCH|DELETE)/i,
    "The repository audit must remain read-only.",
  );
  assert.match(
    auditScript,
    /\.owner\.type == "Organization"/,
    "The audit must reject repositories that are not organization-owned.",
  );
  assert.match(
    auditScript,
    /\.visibility == "public"/,
    "The audit must verify the repository is eligible for merge queue on the current plan.",
  );
  assert.match(
    auditScript,
    /\.type == "merge_queue"/,
    "The audit must require an active merge queue rule.",
  );
  assert.match(
    auditScript,
    /actions\/workflows\/\$\{workflow_file\}\/runs\?event=merge_group&status=success/,
    "The audit must query successful merge-group workflow runs.",
  );
  assert.match(
    auditScript,
    /\.head_branch \| startswith\("gh-readonly-queue\/"\)/,
    "The audit must prove the workflow ran on a GitHub merge queue ref.",
  );
});

test("branch CI isolates database checks and orders browser journeys after every prerequisite", async () => {
  const [workflow, packageJsonSource, buildTimingScript, timingBaselinesSource] = await Promise.all([
    readFile(branchCiPath, "utf8"),
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "run-ci-build-with-timings.sh"), "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "ci-build-timings.json"), "utf8"),
  ]);
  const scripts =
    (JSON.parse(packageJsonSource) as { scripts?: Record<string, string> })
      .scripts ?? {};

  assert.equal(
    scripts["validate:ci:build"],
    "export CI=true && bash scripts/run-ci-build-with-timings.sh",
    "The build CI command must delegate to the timing-aware, fail-fast build runner.",
  );
  const expectedBuildSteps = [
    'run_phase "build:release" pnpm run build:release',
    'run_phase "scripts:typecheck" pnpm --filter @workspace/scripts run typecheck',
    'run_phase "internal-request-control-outputs" pnpm run test:internal-request-control-outputs',
    'run_phase "beauty-marketplace-typecheck" pnpm run test:beauty-marketplace-typecheck',
    'run_phase "frontend-generated-typecheck" pnpm run test:frontend-generated-typecheck',
    'run_phase "api-server-typecheck" pnpm run test:api-server-typecheck',
    'run_phase "browser-specs-typecheck" pnpm run test:browser-specs-typecheck',
    'run_phase "browser-fixtures" pnpm run test:browser-fixtures',
    'run_phase "bundle-budget" pnpm run test:bundle-budget',
    'run_phase "frontend-standards" pnpm run test:frontend-standards',
    'run_phase "seo-standards" pnpm run test:seo-standards',
    'run_phase "frontend-interactions" pnpm run test:frontend-interactions',
  ];
  let previousBuildStepIndex = -1;
  for (const expectedStep of expectedBuildSteps) {
    const stepIndex = buildTimingScript.indexOf(expectedStep);
    assert.ok(stepIndex > previousBuildStepIndex, `${expectedStep} must remain present and ordered.`);
    previousBuildStepIndex = stepIndex;
  }
  assert.equal(
    buildTimingScript.match(/pnpm --filter @workspace\/scripts run typecheck/g)?.length,
    1,
    "The timed build runner must run the explicit scripts typecheck exactly once.",
  );
  assert.match(buildTimingScript, /^set -euo pipefail$/m);
  assert.match(buildTimingScript, /trap 'handle_build_failure' ERR/);
  assert.match(
    buildTimingScript,
    /Preserving the original build failure/,
    "A report-writing failure must not replace the original build failure.",
  );
  assert.match(buildTimingScript, /significantSlowdown/);
  assert.match(buildTimingScript, /Timing warnings are informational and never change the validation result/);

  const timingBaselines = JSON.parse(timingBaselinesSource) as {
    baselinesSeconds?: Record<string, number>;
    warningMultiplier?: number;
    warningMinimumIncreaseSeconds?: number;
  };
  assert.ok((timingBaselines.baselinesSeconds?.["build:release"] ?? 0) > 0);
  assert.ok((timingBaselines.baselinesSeconds?.["scripts:typecheck"] ?? 0) > 0);
  assert.ok((timingBaselines.baselinesSeconds?.["validate:ci:build:total"] ?? 0) > 0);
  assert.ok((timingBaselines.warningMultiplier ?? 0) > 1);
  assert.ok((timingBaselines.warningMinimumIncreaseSeconds ?? 0) > 0);
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
  assert.match(buildJob, /name: Upload build timing history/);
  assert.match(buildJob, /if: \$\{\{ always\(\) \}\}/);
  assert.match(buildJob, /name: build-timings-\$\{\{ github\.run_attempt \}\}/);
  assert.match(buildJob, /path: ci-timings\/build-timings\.json/);
  assert.match(buildJob, /retention-days: 90/);
  assert.doesNotMatch(buildJob, /\$\{\{\s*secrets\./);
  assert.match(
    workflow,
    /run_build_timing_history_probe:[\s\S]*?type: boolean/,
    "Branch CI must expose an on-demand build timing history probe.",
  );
  assert.match(
    workflow,
    /expected_build_timing_history_reports:[\s\S]*?type: number/,
    "The timing history probe must make its expected report count explicit.",
  );
  assert.match(
    buildJob,
    /actions\/workflows\/ci\.yml\/runs[\s\S]*?-f branch="\$default_branch"[\s\S]*?-f status=success/,
    "History must come only from successful runs of the repository default branch.",
  );
  assert.match(
    buildJob,
    /artifact_name="build-timings-\$\{run_attempt\}"[\s\S]*?\.name == \$artifact_name/,
    "A rerun must select the artifact named for that run attempt, not whichever artifact happens to be newest.",
  );
  assert.match(
    buildJob,
    /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/actions\/artifacts\/\$\{artifact_id\}\/zip"[\s\S]*?unzip -q/,
    "The workflow must exercise the GitHub artifact ZIP endpoint and extract its response.",
  );
  assert.match(
    buildJob,
    /Missing, expired, or unreadable artifacts are skipped and never block the build\./,
    "Missing or expired history artifacts must remain non-blocking.",
  );
  assert.match(
    buildJob,
    /Confirm expected build timing history[\s\S]*?steps\.build-timing-history\.outputs\.history_count/,
    "The controlled probe must compare the downloaded count with its expected count.",
  );
  assert.match(
    buildJob,
    /Verify current build timing artifact and redirect download[\s\S]*?GITHUB_RUN_ATTEMPT[\s\S]*?report\.runAttempt/,
    "The controlled probe must verify that a rerun downloaded the current attempt's artifact.",
  );

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
  assert.match(
    probeJob,
    /run: pnpm --filter @workspace\/scripts run playwright:checked/,
    "The diagnostics probe must not bypass browser spec import checks.",
  );
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
  assert.match(
    playwrightConfig,
    /LUMERA_BROWSER_SPEC_TYPES_CHECKED !== "1"[\s\S]*runBrowserSpecTypeCheck\(\)/,
    "Direct Playwright launches must run the browser spec import check from the config.",
  );
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

test("focused administrator browser inventory remains wired into the release gate", async () => {
  const [rootPackageJson, scriptsPackageJson] = await Promise.all([
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "package.json"), "utf8"),
  ]);
  const rootScripts = (JSON.parse(rootPackageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  const parsedScriptsPackageJson = JSON.parse(scriptsPackageJson) as {
    scripts?: Record<string, string>;
    focusedAdministratorBrowserGates?: FocusedAdministratorBrowserGateInventory;
  };
  const packageScripts = parsedScriptsPackageJson.scripts ?? {};
  const inventory = parsedScriptsPackageJson.focusedAdministratorBrowserGates;
  const releaseCommand = rootScripts["validate:release"];
  const isolatedPhaseCommand = rootScripts[requiredIsolatedBrowserGatePhase];

  assert.ok(releaseCommand, "validate:release must be defined.");
  assert.match(
    releaseCommand,
    new RegExp(`(?:^| && )pnpm run ${requiredIsolatedBrowserGatePhase}(?: && |$)`),
    `validate:release must invoke ${requiredIsolatedBrowserGatePhase}.`,
  );
  assert.ok(isolatedPhaseCommand, `${requiredIsolatedBrowserGatePhase} must be defined.`);
  assert.ok(
    inventory,
    "scripts/package.json must define focusedAdministratorBrowserGates as the authoritative release/local-only inventory.",
  );

  validateFocusedAdministratorBrowserGateInventory(
    packageScripts,
    inventory,
    isolatedPhaseCommand,
  );

  for (const scriptName of inventory.release ?? []) {
    assert.ok(rootScripts[scriptName], `Root script ${scriptName} must be defined.`);
    assert.match(
      rootScripts[scriptName],
      new RegExp(`(?:^| )run ${scriptName}(?: |$)`),
      `Root script ${scriptName} must delegate to the scripts package.`,
    );
    assert.ok(packageScripts[scriptName], `Scripts package command ${scriptName} must be defined.`);
  }

  for (const scriptName of requiredOtherIsolatedBrowserGateScripts) {
    assert.ok(rootScripts[scriptName], `Root script ${scriptName} must be defined.`);
    assert.ok(packageScripts[scriptName], `Scripts package command ${scriptName} must be defined.`);
    assert.match(
      isolatedPhaseCommand,
      new RegExp(`(?:^| && )pnpm run ${scriptName}(?: && |$)`),
      `${requiredIsolatedBrowserGatePhase} must invoke ${scriptName}.`,
    );
  }
});

test("a new focused administrator browser command must be released or explicitly local-only", () => {
  const packageScripts = {
    "test:admin-existing": "pnpm run playwright:checked -- browser/admin-existing.spec.ts",
    "test:admin-new-regression": "pnpm run playwright:checked -- browser/admin-new-regression.spec.ts",
  };

  assert.throws(
    () =>
      validateFocusedAdministratorBrowserGateInventory(
        packageScripts,
        { release: ["test:admin-existing"], localOnly: [] },
        "pnpm run test:admin-existing",
      ),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.startsWith(
        "Every test:admin-* browser command must be classified in scripts/package.json focusedAdministratorBrowserGates.release or .localOnly. Add release checks to the release inventory, or explicitly mark diagnostics as localOnly.",
      ),
  );

  assert.doesNotThrow(() =>
    validateFocusedAdministratorBrowserGateInventory(
      packageScripts,
      {
        release: ["test:admin-existing"],
        localOnly: ["test:admin-new-regression"],
      },
      "pnpm run test:admin-existing",
    )
  );
});

test("focused salon-owner browser inventory remains wired into the release gate", async () => {
  const [rootPackageJson, scriptsPackageJson] = await Promise.all([
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "package.json"), "utf8"),
  ]);
  const rootScripts = (JSON.parse(rootPackageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  const parsedScriptsPackageJson = JSON.parse(scriptsPackageJson) as {
    scripts?: Record<string, string>;
    focusedOwnerBrowserGates?: FocusedOwnerBrowserGateInventory;
  };
  const packageScripts = parsedScriptsPackageJson.scripts ?? {};
  const inventory = parsedScriptsPackageJson.focusedOwnerBrowserGates;
  const isolatedPhaseCommand = rootScripts[requiredIsolatedBrowserGatePhase];

  assert.ok(isolatedPhaseCommand, `${requiredIsolatedBrowserGatePhase} must be defined.`);
  assert.ok(
    inventory,
    "scripts/package.json must define focusedOwnerBrowserGates as the authoritative release/local-only inventory for test:owner-* Playwright commands.",
  );

  validateFocusedOwnerBrowserGateInventory(
    packageScripts,
    inventory,
    isolatedPhaseCommand,
  );

  for (const scriptName of inventory.release ?? []) {
    assert.ok(rootScripts[scriptName], `Root script ${scriptName} must be defined.`);
    assert.match(
      rootScripts[scriptName],
      new RegExp(`(?:^| )run ${scriptName}(?: |$)`),
      `Root script ${scriptName} must delegate to the scripts package.`,
    );
    assert.ok(packageScripts[scriptName], `Scripts package command ${scriptName} must be defined.`);
  }
});

test("a new focused salon-owner browser command must be released or explicitly local-only", () => {
  const packageScripts = {
    "test:owner-existing": "pnpm run playwright:checked -- browser/owner-existing.spec.ts",
    "test:owner-new-regression": "pnpm run playwright:checked -- browser/owner-new-regression.spec.ts",
  };

  assert.throws(
    () =>
      validateFocusedOwnerBrowserGateInventory(
        packageScripts,
        { release: ["test:owner-existing"], localOnly: [] },
        "pnpm run test:owner-existing",
      ),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.startsWith(
        "Every test:owner-* Playwright command must be classified in scripts/package.json focusedOwnerBrowserGates.release or .localOnly.",
      ),
  );

  assert.throws(
    () =>
      validateFocusedOwnerBrowserGateInventory(
        packageScripts,
        {
          release: ["test:owner-existing", "test:owner-new-regression"],
          localOnly: [],
        },
        "pnpm run test:owner-existing",
      ),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.startsWith(
        `${requiredIsolatedBrowserGatePhase} must invoke release-focused salon-owner browser command test:owner-new-regression.`,
      ),
  );

  assert.doesNotThrow(() =>
    validateFocusedOwnerBrowserGateInventory(
      packageScripts,
      {
        release: ["test:owner-existing"],
        localOnly: ["test:owner-new-regression"],
      },
      "pnpm run test:owner-existing",
    )
  );
});

test("focused employee browser inventory remains wired into the release gate", async () => {
  const [rootPackageJson, scriptsPackageJson] = await Promise.all([
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "package.json"), "utf8"),
  ]);
  const rootScripts = (JSON.parse(rootPackageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  const parsedScriptsPackageJson = JSON.parse(scriptsPackageJson) as {
    scripts?: Record<string, string>;
    focusedEmployeeBrowserGates?: FocusedEmployeeBrowserGateInventory;
  };
  const packageScripts = parsedScriptsPackageJson.scripts ?? {};
  const inventory = parsedScriptsPackageJson.focusedEmployeeBrowserGates;
  const isolatedPhaseCommand = rootScripts[requiredIsolatedBrowserGatePhase];

  assert.ok(isolatedPhaseCommand, `${requiredIsolatedBrowserGatePhase} must be defined.`);
  assert.ok(
    inventory,
    "scripts/package.json must define focusedEmployeeBrowserGates as the authoritative release/local-only inventory for focused employee browser commands.",
  );

  validateFocusedEmployeeBrowserGateInventory(
    packageScripts,
    inventory,
    isolatedPhaseCommand,
  );

  for (const scriptName of inventory.release ?? []) {
    assert.ok(rootScripts[scriptName], `Root script ${scriptName} must be defined.`);
    assert.match(
      rootScripts[scriptName],
      new RegExp(`(?:^| )run ${scriptName}(?: |$)`),
      `Root script ${scriptName} must delegate to the scripts package.`,
    );
    assert.ok(packageScripts[scriptName], `Scripts package command ${scriptName} must be defined.`);
  }
});

test("a new focused employee browser command must be released or explicitly local-only", () => {
  const packageScripts = {
    "test:employee-existing": "pnpm run playwright:checked -- browser/employee-existing.spec.ts",
    "test:employee-new-regression": "pnpm run playwright:checked -- browser/employee-new-regression.spec.ts",
  };
  const namingConvention = {
    scriptNamePattern: "test:employee-*",
    specFilePattern: "browser/employee-*.spec.ts",
  };

  assert.throws(
    () =>
      validateFocusedEmployeeBrowserGateInventory(
        packageScripts,
        {
          ...namingConvention,
          release: ["test:employee-existing"],
          localOnly: [],
        },
        "pnpm run test:employee-existing",
      ),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.startsWith(
        "Every test:employee-* command targeting browser/employee-*.spec.ts must be classified",
      ),
  );

  assert.throws(
    () =>
      validateFocusedEmployeeBrowserGateInventory(
        packageScripts,
        {
          ...namingConvention,
          release: ["test:employee-existing", "test:employee-new-regression"],
          localOnly: [],
        },
        "pnpm run test:employee-existing",
      ),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.startsWith(
        `${requiredIsolatedBrowserGatePhase} must invoke release-focused employee browser command test:employee-new-regression.`,
      ),
  );

  assert.doesNotThrow(() =>
    validateFocusedEmployeeBrowserGateInventory(
      packageScripts,
      {
        ...namingConvention,
        release: ["test:employee-existing"],
        localOnly: ["test:employee-new-regression"],
      },
      "pnpm run test:employee-existing",
    )
  );
});
