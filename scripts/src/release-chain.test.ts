import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");

test("public SEO SPA regression stays in the timed browser release phase without database setup", async () => {
  const root = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
  const scripts = JSON.parse(await readFile(path.join(workspaceRoot, "scripts/package.json"), "utf8"));
  const config = await readFile(path.join(workspaceRoot, "scripts/playwright.seo.config.ts"), "utf8");
  const budgets = JSON.parse(await readFile(path.join(workspaceRoot, "scripts/ci-build-timings.json"), "utf8"));
  assert.match(root.scripts["validate:release:5-final"], /pnpm run test:client-seo-browser/);
  assert.match(root.scripts["test:client-seo-browser"], /--filter @workspace\/scripts run test:client-seo-browser/);
  assert.match(scripts.scripts["test:client-seo-browser"], /playwright test --config playwright\.seo\.config\.ts/);
  assert.match(config, /client-seo-navigation\.spec\.ts/);
  assert.match(config, /SITE_INDEXABLE: "false"/);
  assert.doesNotMatch(config, /DATABASE_URL|run-isolated-browser-suite|SITE_INDEXABLE: "true"/);
  assert.ok(budgets.baselinesSeconds["browser:release:5-final"] >= 105);
});

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

type WorkflowJob = {
  name?: string;
  if?: string;
  needs?: string | string[];
  services?: unknown;
  env?: Record<string, unknown>;
  steps?: Array<{
    uses?: string;
    name?: string;
    run?: string;
    if?: string;
    env?: Record<string, unknown>;
    "continue-on-error"?: boolean;
    with?: Record<string, unknown>;
  }>;
};

type GitHubWorkflow = {
  on?: Record<string, unknown>;
  env?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
};

function parseWorkflow(source: string): GitHubWorkflow {
  return parseYaml(source) as GitHubWorkflow;
}

async function writeRulesetAuditFixture(
  fixtureDir: string,
  requiredContexts: string[],
  graphqlRepository: unknown = {
    data: {
      repository: {
        nameWithOwner: "lumera-rs/Platforma-Beauty",
        viewerPermission: "ADMIN",
        deleteBranchOnMerge: true,
      },
    },
  },
): Promise<void> {
  await Promise.all([
    writeFile(
      path.join(fixtureDir, "repository.json"),
      JSON.stringify({
        owner: { type: "Organization" },
        visibility: "public",
      }),
    ),
    writeFile(
      path.join(fixtureDir, "graphql-repository.json"),
      JSON.stringify(graphqlRepository),
    ),
    writeFile(
      path.join(fixtureDir, "rulesets.json"),
      JSON.stringify([{ id: 22142708, name: "Protect default branch CI", target: "branch" }]),
    ),
    writeFile(
      path.join(fixtureDir, "ruleset.json"),
      JSON.stringify({
        name: "Protect default branch CI",
        target: "branch",
        enforcement: "active",
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
        bypass_actors: [],
        rules: [
          { type: "pull_request" },
          {
            type: "merge_queue",
            parameters: { merge_method: "SQUASH", min_entries_to_merge: 1 },
          },
          {
            type: "required_status_checks",
            parameters: {
              strict_required_status_checks_policy: true,
              do_not_enforce_on_create: true,
              required_status_checks: requiredContexts.map((context) => ({ context })),
            },
          },
        ],
      }),
    ),
    writeFile(
      path.join(fixtureDir, "merge-group-runs.json"),
      JSON.stringify({
        workflow_runs: [{
          event: "merge_group",
          status: "completed",
          conclusion: "success",
          head_branch: "gh-readonly-queue/main/pr-1",
          created_at: "2026-09-03T00:00:00Z",
          html_url: "https://example.invalid/actions/runs/1",
        }],
      }),
    ),
  ]);
}

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = workspaceRoot,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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

type TimedCiJob = "database" | "browser";

test("database CI forwards an explicit disposable admin URL to the boot regression", async () => {
  const workflow = parseWorkflow(await readFile(branchCiPath, "utf8"));
  const database = workflow.jobs!.database!;
  const checks = database.steps!.find((step) => step.run === "pnpm run validate:ci:database")!;
  const adminUrl = "postgres://lumera_ci@127.0.0.1:55432/lumera_ci_database";
  assert.equal(checks.env?.LUMERA_DISPOSABLE_ADMIN_URL, adminUrl);
  assert.equal(checks.if, undefined);
  assert.equal(checks["continue-on-error"], undefined);
  assert.equal(database.env?.LUMERA_DISPOSABLE_ADMIN_URL, undefined);
  assert.equal(workflow.env?.LUMERA_DISPOSABLE_ADMIN_URL, undefined);
  const postgres = (database.services as Record<string, {
    ports: string[]; env: Record<string, string>;
  }>).postgres!;
  assert.deepEqual(postgres.ports, ["127.0.0.1:55432:5432"]);
  assert.equal(postgres.env.POSTGRES_HOST_AUTH_METHOD, "trust");
  assert.equal(postgres.env.POSTGRES_USER, "lumera_ci");
  assert.equal(postgres.env.POSTGRES_DB, "lumera_ci_database");

  const { scripts } = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.ok(chainedPnpmScripts(scripts["validate:release:2-backend"]!)
    .includes("test:business-growth-schema-boot-regression"), "The existing release check must not be removed.");
  const command = scripts["test:business-growth-schema-boot-regression"]!;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lumera-boot-ci-args-"));
  try {
    const fakePnpm = path.join(tempDir, "pnpm");
    await writeFile(fakePnpm, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    await chmod(fakePnpm, 0o755);
    const env = {
      PATH: `${tempDir}:${process.env.PATH ?? ""}`,
      // A supplied ambient URL must never satisfy the explicit target contract.
      DATABASE_URL: "postgres://unusable.example.invalid/ambient_must_not_be_used",
    };
    for (const extra of [{}, { LUMERA_DISPOSABLE_ADMIN_URL: "" }]) {
      const refused = await runCommand("sh", ["-c", command], { ...env, ...extra });
      assert.notEqual(refused.code, 0);
      assert.match(refused.stderr, /LUMERA_DISPOSABLE_ADMIN_URL/);
      assert.equal(refused.stdout, "", "Missing target must refuse before invoking pnpm.");
    }
    const forwarded = await runCommand("sh", ["-c", command], {
      ...env, LUMERA_DISPOSABLE_ADMIN_URL: adminUrl,
    });
    assert.equal(forwarded.code, 0, forwarded.stderr);
    assert.deepEqual(forwarded.stdout.trim().split("\n"), [
      "--filter", "@workspace/scripts", "exec", "tsx",
      "../artifacts/api-server/src/lib/business-growth-schema-boot-regression.test.ts",
      `--admin-url=${adminUrl}`,
    ], "Direct tsx must pass the explicit argument to node:test, not treat it as another test filename.");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

const successfulTimedCiJobInvocations: Record<TimedCiJob, string[]> = {
  database: [
    "run test:monitoring",
    "run test:backend-standards:static",
    "run validate:release:2-backend",
    "run validate:release:3-api",
  ],
  browser: [
    "run validate:release:4-isolated",
    "run validate:release:5-final",
  ],
};

async function assertSuccessfulTimedCiJobFailsWhenJsonReportCannotBeWritten(
  job: TimedCiJob,
): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `lumera-ci-timings-${job}-json-report-failure-`));
  const binDir = path.join(tempDir, "bin");
  const reportDir = path.join(tempDir, "reports");
  const reportName = `${job}-timings.json`;
  const invocationLog = path.join(tempDir, "pnpm-invocations.log");
  const fakePnpmPath = path.join(binDir, "pnpm");

  await mkdir(binDir);
  await mkdir(reportDir);
  await mkdir(path.join(reportDir, reportName));
  await writeFile(
    fakePnpmPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_PNPM_INVOCATION_LOG"
exit 0
`,
  );
  await chmod(fakePnpmPath, 0o755);

  const result = await runCommand(
    "bash",
    [path.join(workspaceRoot, "scripts", "run-ci-build-with-timings.sh"), job],
    {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      CI_TIMING_REPORT_DIR: reportDir,
      FAKE_PNPM_INVOCATION_LOG: invocationLog,
    },
  );

  assert.equal(
    result.code,
    1,
    `A successful ${job} job must fail when its JSON report cannot be written. stderr: ${result.stderr}`,
  );
  assert.match(result.stderr, /Could not write JSON timing report/);
  assert.match(
    result.stderr,
    /Build passed, but report writing failed \(exit code 1\)/,
    "The final error must identify the successful job/report-writing policy.",
  );

  const invocations = (await readFile(invocationLog, "utf8")).trim().split("\n");
  assert.deepEqual(
    invocations,
    successfulTimedCiJobInvocations[job],
    `The ${job} job must finish every phase before the JSON report failure is reported.`,
  );
}

function extractWorkflowRunStep(workflow: string, stepName: string): string {
  const stepStart = workflow.indexOf(`      - name: ${stepName}\n`);
  assert.notEqual(stepStart, -1, `Workflow step ${stepName} must exist.`);

  const runStart = workflow.indexOf("        run: |\n", stepStart);
  assert.notEqual(runStart, -1, `Workflow step ${stepName} must have a shell run block.`);

  const scriptStart = runStart + "        run: |\n".length;
  const nextStep = workflow.indexOf("\n      - name:", scriptStart);
  assert.notEqual(nextStep, -1, `Workflow step ${stepName} must be followed by another step.`);

  return workflow
    .slice(scriptStart, nextStep)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");
}
function chainedPnpmScripts(command: string): string[] {
  return command.split(" && ").flatMap((step) => {
    const match = /^pnpm run ([\w:-]+)$/.exec(step);
    return match ? [match[1]] : [];
  });
}

type FocusedAdministratorBrowserGateInventory = {
  scriptNamePattern?: string;
  specFilePattern?: string;
  release?: string[];
  localOnly?: string[];
};

type FocusedOwnerBrowserGateInventory = {
  scriptNamePattern?: string;
  specFilePattern?: string;
  release?: string[];
  localOnly?: string[];
};

type FocusedEmployeeBrowserGateInventory = {
  scriptNamePattern?: string;
  specFilePattern?: string;
  release?: string[];
  localOnly?: string[];
};

type FocusedBrowserCommand = {
  scriptName: string;
  specFile: string;
};

function focusedAdministratorBrowserCommandEntries(
  packageScripts: Record<string, string>,
): FocusedBrowserCommand[] {
  return Object.entries(packageScripts)
    .flatMap(([scriptName, command]) => {
      if (!scriptName.startsWith("test:admin-")) {
        return [];
      }
      const directMatch =
        /^pnpm run playwright:checked -- (browser\/admin-[\w-]+\.spec\.ts)(?: --[\s\S]*)?$/
          .exec(command);
      if (directMatch) {
        return [{ scriptName, specFile: directMatch[1] }];
      }
      const runnerMatch = /^tsx \.\/src\/run-(admin-[\w-]+)\.ts(?: --[\s\S]*)?$/
        .exec(command);
      return runnerMatch
        ? [{ scriptName, specFile: `browser/${runnerMatch[1]}.spec.ts` }]
        : [];
    })
    .sort((left, right) => left.scriptName.localeCompare(right.scriptName));
}

function validateFocusedAdministratorBrowserGateInventory(
  packageScripts: Record<string, string>,
  inventory: FocusedAdministratorBrowserGateInventory,
  isolatedPhaseCommand: string,
  administratorSpecFiles: string[],
): void {
  assert.equal(
    inventory.scriptNamePattern,
    "test:admin-*",
    "Focused administrator browser commands must follow the documented test:admin-* package-script naming convention.",
  );
  assert.equal(
    inventory.specFilePattern,
    "browser/admin-*.spec.ts",
    "Focused administrator browser commands must target the documented browser/admin-*.spec.ts naming convention.",
  );

  const releaseScripts = inventory.release ?? [];
  const localOnlyScripts = inventory.localOnly ?? [];
  const classifiedScripts = [...releaseScripts, ...localOnlyScripts];
  const discoveredCommands =
    focusedAdministratorBrowserCommandEntries(packageScripts);
  const discoveredScripts = discoveredCommands.map(({ scriptName }) => scriptName);

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
  assert.deepEqual(
    discoveredCommands.map(({ specFile }) => specFile).sort(),
    [...administratorSpecFiles].sort(),
    "Every browser/admin-*.spec.ts file must be referenced by exactly one convention-compliant test:admin-* command.",
  );

  for (const scriptName of releaseScripts) {
    assert.match(
      isolatedPhaseCommand,
      new RegExp(`(?:^| && )pnpm run ${scriptName}(?: && |$)`),
      `${requiredIsolatedBrowserGatePhase} must invoke release-focused administrator browser command ${scriptName}. Move it to localOnly only if it is intentionally diagnostic.`,
    );
  }
}

function focusedOwnerBrowserCommandEntries(
  packageScripts: Record<string, string>,
): FocusedBrowserCommand[] {
  return Object.entries(packageScripts)
    .flatMap(([scriptName, command]) => {
      if (!scriptName.startsWith("test:owner-")) {
        return [];
      }
      const match =
        /^pnpm run playwright:checked -- (browser\/owner-[\w-]+\.spec\.ts)(?: --[\s\S]*)?$/
          .exec(command);
      return match ? [{ scriptName, specFile: match[1] }] : [];
    })
    .sort((left, right) => left.scriptName.localeCompare(right.scriptName));
}

function validateFocusedOwnerBrowserGateInventory(
  packageScripts: Record<string, string>,
  inventory: FocusedOwnerBrowserGateInventory,
  isolatedPhaseCommand: string,
  ownerSpecFiles: string[],
): void {
  assert.equal(
    inventory.scriptNamePattern,
    "test:owner-*",
    "Focused salon-owner browser commands must follow the documented test:owner-* package-script naming convention.",
  );
  assert.equal(
    inventory.specFilePattern,
    "browser/owner-*.spec.ts",
    "Focused salon-owner browser commands must target the documented browser/owner-*.spec.ts naming convention.",
  );

  const releaseScripts = inventory.release ?? [];
  const localOnlyScripts = inventory.localOnly ?? [];
  const classifiedScripts = [...releaseScripts, ...localOnlyScripts];
  const discoveredCommands = focusedOwnerBrowserCommandEntries(packageScripts);
  const discoveredScripts = discoveredCommands.map(({ scriptName }) => scriptName);

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
  assert.deepEqual(
    discoveredCommands.map(({ specFile }) => specFile).sort(),
    [...ownerSpecFiles].sort(),
    "Every browser/owner-*.spec.ts file must be referenced by exactly one convention-compliant test:owner-* command.",
  );

  for (const scriptName of releaseScripts) {
    assert.match(
      isolatedPhaseCommand,
      new RegExp(`(?:^| && )pnpm run ${scriptName}(?: && |$)`),
      `${requiredIsolatedBrowserGatePhase} must invoke release-focused salon-owner browser command ${scriptName}. Move it to localOnly only if it is intentionally diagnostic.`,
    );
  }
}

function focusedEmployeeBrowserCommandEntries(
  packageScripts: Record<string, string>,
): FocusedBrowserCommand[] {
  return Object.entries(packageScripts)
    .flatMap(([scriptName, command]) => {
      if (!scriptName.startsWith("test:employee-")) {
        return [];
      }
      const match =
        /^pnpm run playwright:checked -- (browser\/employee-[\w-]+\.spec\.ts)(?: --[\s\S]*)?$/
          .exec(command);
      return match ? [{ scriptName, specFile: match[1] }] : [];
    })
    .sort((left, right) => left.scriptName.localeCompare(right.scriptName));
}

function validateFocusedEmployeeBrowserGateInventory(
  packageScripts: Record<string, string>,
  inventory: FocusedEmployeeBrowserGateInventory,
  isolatedPhaseCommand: string,
  employeeSpecFiles: string[],
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
  const discoveredCommands =
    focusedEmployeeBrowserCommandEntries(packageScripts);
  const discoveredScripts = discoveredCommands.map(({ scriptName }) => scriptName);

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
  assert.deepEqual(
    discoveredCommands.map(({ specFile }) => specFile).sort(),
    [...employeeSpecFiles].sort(),
    "Every browser/employee-*.spec.ts file must be referenced by exactly one convention-compliant test:employee-* command.",
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

test("Batch 1 F1 and A-2 regressions stay in the API release phase", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  const apiPhase = scripts["validate:release:3-api"] ?? "";

  assert.equal(
    scripts["test:owner-reset-password-session-revocation"],
    "NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/src/lib/owner-reset-password-session-revocation.test.ts",
    "F1 owner-reset session revocation must keep a focused root test command.",
  );
  assert.equal(
    scripts["test:phone-contact-sql-bounds"],
    "NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/src/lib/phone-contact-sql-bounds.test.ts",
    "A-2 contact SQL bounds must keep a focused root test command.",
  );
  assert.match(
    apiPhase,
    /pnpm run test:query-budgets && pnpm run test:phone-contact-sql-bounds/,
    "A-2 must run beside the query-budget gate in release phase 3.",
  );
  assert.match(
    apiPhase,
    /pnpm run test:change-password-session-revocation && pnpm run test:owner-reset-password-session-revocation/,
    "F1 must run beside the related password-session gate in release phase 3.",
  );
});

test("branch CI runs the database-free release-chain gate before slower work", async () => {
  const workflow = await readFile(branchCiPath, "utf8");
  const parsedWorkflow = parseWorkflow(workflow);

  const downloadScript = extractWorkflowRunStep(
    workflow,
    "Download recent successful build timing history",
  );

  assert.ok(parsedWorkflow.on?.pull_request !== undefined);
  assert.deepEqual(parsedWorkflow.on?.merge_group, {
    types: ["checks_requested"],
  });
  assert.deepEqual(parsedWorkflow.on?.push, {
    "branches-ignore": ["gh-readonly-queue/**"],
    tags: ["**"],
  });
  assert.ok(parsedWorkflow.on?.workflow_dispatch !== undefined);
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-timings-success-report-failure-"));
  const binDir = path.join(tempDir, "bin");

  const scriptsDir = path.join(tempDir, "scripts");
  const reportDir = path.join(tempDir, "reports");
  const summaryPath = path.join(reportDir, "build-summary.md");
  const invocationLog = path.join(tempDir, "pnpm-invocations.log");
  const fakePnpmPath = path.join(binDir, "pnpm");
  const failureCode = 43;

  await mkdir(binDir);
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
      GITHUB_STEP_SUMMARY: summaryPath,
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
  assert.match(summary, /^### CI timing trend$/m);
  assert.match(summary, /\| scripts:typecheck \|/);
  assert.match(summary, /\| validate:ci:build:total \|/);

  assert.doesNotMatch(
    result.stdout,
    /::group::internal-request-control-outputs/,
    "No phase after the failure may start.",
  );
});

test("timed CI build preserves the build code when report writing also fails", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-timings-success-report-failure-"));
  const binDir = path.join(tempDir, "bin");

  const scriptsDir = path.join(tempDir, "scripts");
  const reportDir = path.join(tempDir, "reports");
  const blockedSummaryPath = path.join(tempDir, "blocked-summary");

  const fallbackReportDir = path.join(tempDir, "fallback-reports");
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
      CI_TIMING_REPORT_FALLBACK_DIR: fallbackReportDir,
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

  const fallbackReport = JSON.parse(
    await readFile(path.join(fallbackReportDir, "build-timings.json"), "utf8"),
  ) as {
    status?: string;
    phases?: Array<{ name?: string; durationSeconds?: number }>;
  };
  assert.equal(report.status, "failed");
  assert.equal(fallbackReport.status, "failed");
  assert.deepEqual(
    fallbackReport.phases?.map((phase) => phase.name),
    ["build:release", "scripts:typecheck", "validate:ci:build:total"],
    "The fallback JSON report must retain every phase from the failed build.",
  );

  const fallbackSummary = await readFile(
    path.join(fallbackReportDir, "build-summary.md"),
    "utf8",
  );
  assert.match(fallbackSummary, /^### CI timing trend$/m);
  assert.match(fallbackSummary, /\| scripts:typecheck \|/);
  assert.match(fallbackSummary, /\| validate:ci:build:total \|/);
});

test("timed CI build preserves the original failure when primary and fallback reports are unwritable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-timings-double-report-failure-"));
  const binDir = path.join(tempDir, "bin");
  const blockedPrimaryReportDir = path.join(tempDir, "blocked-primary-reports");
  const blockedFallbackReportDir = path.join(tempDir, "blocked-fallback-reports");
  const blockedSummaryPath = path.join(tempDir, "blocked-summary");
  const invocationLog = path.join(tempDir, "pnpm-invocations.log");
  const fakePnpmPath = path.join(binDir, "pnpm");
  const failureCode = 47;

  await mkdir(binDir);
  await writeFile(blockedPrimaryReportDir, "primary report location is unavailable\n");
  await writeFile(blockedFallbackReportDir, "fallback report location is unavailable\n");
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
      CI_TIMING_REPORT_DIR: blockedPrimaryReportDir,
      CI_TIMING_REPORT_FALLBACK_DIR: blockedFallbackReportDir,
      GITHUB_STEP_SUMMARY: blockedSummaryPath,
      FAKE_PNPM_INVOCATION_LOG: invocationLog,
      FAKE_PNPM_FAILURE_CODE: String(failureCode),
    },
  );

  assert.equal(
    result.code,
    failureCode,
    `When both report locations fail, the runner must preserve the build failure code. stderr: ${result.stderr}`,
  );
  assert.match(result.stderr, /Could not prepare primary timing report directory/);
  assert.match(result.stderr, /Could not write JSON timing report/);
  assert.match(result.stderr, /Could not write fallback JSON timing report/);
  assert.match(result.stderr, /Could not write Markdown timing summary/);
  assert.match(result.stderr, /Could not prepare a fallback timing report directory/);
  assert.match(
    result.stderr,
    new RegExp(`Build failed with exit code ${failureCode}; report writing also failed.*original build failure`),
  );
  assert.doesNotMatch(
    result.stderr,
    /Saved (?:JSON timing report|Markdown timing summary) to .*fallback/,
    "A failed fallback must never be reported as successfully saved.",
  );
  assert.doesNotMatch(
    result.stderr,
    /Build passed, but report writing failed/,
    "A failed build must not be reported as a successful build.",
  );
});

test("timed CI build fails when a successful JSON timing report cannot be written", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-timings-json-report-failure-"));
  const binDir = path.join(tempDir, "bin");
  const reportDir = path.join(tempDir, "reports");
  const blockedReportPath = path.join(reportDir, "build-timings.json");
  const invocationLog = path.join(tempDir, "pnpm-invocations.log");
  const fakePnpmPath = path.join(binDir, "pnpm");

  await mkdir(binDir);
  await mkdir(reportDir);
  await mkdir(blockedReportPath);
  await writeFile(
    fakePnpmPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_PNPM_INVOCATION_LOG"
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
      FAKE_PNPM_INVOCATION_LOG: invocationLog,
    },
  );

  assert.equal(
    result.code,
    1,
    `A successful build must fail when its JSON report cannot be written. stderr: ${result.stderr}`,
  );
  assert.match(result.stderr, /Could not write JSON timing report/);
  assert.match(
    result.stderr,
    /Build passed, but report writing failed \(exit code 1\)/,
    "The final error must identify the successful build/report-writing policy.",
  );
  assert.doesNotMatch(
    result.stderr,
    /controlled build failure/,
    "The controlled fake pnpm must complete every build phase successfully.",
  );

  const invocations = (await readFile(invocationLog, "utf8")).trim().split("\n");
  assert.deepEqual(invocations, [
    "run build:release",
    "--filter @workspace/scripts run typecheck",
    "run test:internal-request-controls",
    "run test:internal-request-control-outputs",
    "run test:beauty-marketplace-typecheck",
    "run test:frontend-generated-typecheck",
    "run test:api-server-typecheck",
    "run test:browser-specs-typecheck",
    "run test:browser-fixtures",
    "run test:bundle-budget",
    "run test:frontend-standards",
    "run test:seo-standards",
    "--filter @workspace/scripts exec tsx --test ./src/public-salon-address.test.ts",
    "--filter @workspace/scripts run test:salon-address-input",
    "run test:frontend-interactions",
    "run test:rmas",
  ]);
});

test("timed database CI job fails when a successful JSON timing report cannot be written", async () => {
  await assertSuccessfulTimedCiJobFailsWhenJsonReportCannotBeWritten("database");
});

test("timed browser CI job fails when a successful JSON timing report cannot be written", async () => {
  await assertSuccessfulTimedCiJobFailsWhenJsonReportCannotBeWritten("browser");
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
    /\.data\.repository\.deleteBranchOnMerge == true/,
    "The audit must require authoritative GraphQL confirmation of automatic merged-branch deletion.",
  );
  assert.match(
    auditScript,
    /\.data\.repository\.viewerPermission == "ADMIN"/,
    "The GraphQL setting must be accepted only for an administrator.",
  );
  assert.match(
    auditScript,
    /\.data\.repository\.nameWithOwner == \$expected/,
    "The GraphQL response must match the pinned repository identity.",
  );
  assert.doesNotMatch(
    auditScript,
    /\.delete_branch_on_merge == true/,
    "The audit must not treat the optional REST field as authoritative.",
  );
  assert.match(
    auditScript,
    /query RepositoryMergedBranchDeletion/,
    "The repository setting must be read through a GraphQL query.",
  );
  assert.doesNotMatch(
    auditScript,
    /\bmutation\b/,
    "The GraphQL operation must remain read-only.",
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
    /migration_contract_context=.*[\s\S]*Migration contract \(database-free\)/,
    "The audit must derive and verify the migration-contract job's exact check name.",
  );
  assert.match(
    auditScript,
    /phase5_migration_context=.*[\s\S]*Phase 5 migration integration \(owned PostgreSQL 16\)/,
    "The audit must derive and verify the Phase 5 integration job's exact check name.",
  );
  assert.match(
    auditScript,
    /all\(\$contexts\[\];/,
    "The same strict status-check rule must contain every required context.",
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

  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "lumera-ruleset-audit-"));
  const requiredContexts = [
    "GitHub Actions syntax and expressions",
    "Migration contract (database-free)",
    "Phase 5 migration integration (owned PostgreSQL 16)",
  ];
  try {
    await writeRulesetAuditFixture(fixtureDir, requiredContexts);
    // Fixture runs are intentionally offline even when this test suite runs in
    // GitHub Actions; never inherit the native Actions marker.
    const fixtureEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      GITHUB_REPOSITORY: "lumera-rs/Platforma-Beauty",
      LUMERA_RULESET_AUDIT_FIXTURE_DIR: fixtureDir,
    };
    delete fixtureEnv.GITHUB_ACTIONS;
    const validResult = await runCommand(
      "bash",
      [rulesetAuditScriptPath],
      fixtureEnv,
    );
    assert.equal(
      validResult.code,
      0,
      `A complete offline ruleset fixture must pass without API credentials. stderr: ${validResult.stderr}`,
    );

    const nativeActionsFixtureResult = await runCommand(
      "bash",
      [rulesetAuditScriptPath],
      {
        ...fixtureEnv,
        GITHUB_ACTIONS: "true",
      },
    );
    assert.equal(
      nativeActionsFixtureResult.code,
      1,
      "Fixture mode must be rejected under native GitHub Actions context.",
    );
    assert.match(
      nativeActionsFixtureResult.stderr,
      /fixture mode is forbidden in native GitHub Actions context/i,
    );

    const invalidGraphqlFixtures: Array<{
      name: string;
      response: unknown;
      error: RegExp;
    }> = [
      {
        name: "explicit false",
        response: {
          data: {
            repository: {
              nameWithOwner: "lumera-rs/Platforma-Beauty",
              viewerPermission: "ADMIN",
              deleteBranchOnMerge: false,
            },
          },
        },
        error: /automatic deletion of merged branches is disabled/i,
      },
      {
        name: "missing field",
        response: {
          data: {
            repository: {
              nameWithOwner: "lumera-rs/Platforma-Beauty",
              viewerPermission: "ADMIN",
            },
          },
        },
        error: /did not return a complete authoritative repository setting/i,
      },
      {
        name: "null repository",
        response: { data: { repository: null } },
        error: /did not return a complete authoritative repository setting/i,
      },
      {
        name: "GraphQL errors",
        response: {
          data: { repository: null },
          errors: [{ message: "Repository lookup failed" }],
        },
        error: /did not return a complete authoritative repository setting/i,
      },
      {
        name: "wrong repository",
        response: {
          data: {
            repository: {
              nameWithOwner: "lumera-rs/Other-Repository",
              viewerPermission: "ADMIN",
              deleteBranchOnMerge: true,
            },
          },
        },
        error: /did not return a complete authoritative repository setting/i,
      },
      {
        name: "insufficient permission",
        response: {
          data: {
            repository: {
              nameWithOwner: "lumera-rs/Platforma-Beauty",
              viewerPermission: "WRITE",
              deleteBranchOnMerge: true,
            },
          },
        },
        error: /did not return a complete authoritative repository setting/i,
      },
    ];
    for (const fixture of invalidGraphqlFixtures) {
      await writeRulesetAuditFixture(fixtureDir, requiredContexts, fixture.response);
      const result = await runCommand(
        "bash",
        [rulesetAuditScriptPath],
        fixtureEnv,
      );
      assert.equal(result.code, 1, `${fixture.name} must fail closed.`);
      assert.match(result.stderr, fixture.error, fixture.name);
    }

    await writeRulesetAuditFixture(fixtureDir, [requiredContexts[0]]);
    const missingMigrationContextResult = await runCommand(
      "bash",
      [rulesetAuditScriptPath],
      fixtureEnv,
    );
    assert.equal(
      missingMigrationContextResult.code,
      1,
      "Removing Migration contract (database-free) from an offline fixture must fail closed.",
    );
    assert.match(
      missingMigrationContextResult.stderr,
      /ruleset is missing or invalid/,
    );

    await writeRulesetAuditFixture(fixtureDir, requiredContexts.slice(0, 2));
    const missingPhase5ContextResult = await runCommand(
      "bash",
      [rulesetAuditScriptPath],
      fixtureEnv,
    );
    assert.equal(
      missingPhase5ContextResult.code,
      1,
      "Removing Phase 5 migration integration from an offline fixture must fail closed.",
    );
    assert.match(
      missingPhase5ContextResult.stderr,
      /ruleset is missing or invalid/,
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
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
  const parsedWorkflow = parseWorkflow(workflow);

  assert.equal(
    scripts["validate:ci:build"],
    "export CI=true && bash scripts/run-ci-build-with-timings.sh",
    "The build CI command must delegate to the timing-aware, fail-fast build runner.",
  );
  const expectedBuildSteps = [
    'run_phase "build:release" pnpm run build:release',
    'run_phase "scripts:typecheck" pnpm --filter @workspace/scripts run typecheck',
    'run_phase "internal-request-controls" pnpm run test:internal-request-controls',
    'run_phase "internal-request-control-outputs" pnpm run test:internal-request-control-outputs',
    'run_phase "beauty-marketplace-typecheck" pnpm run test:beauty-marketplace-typecheck',
    'run_phase "frontend-generated-typecheck" pnpm run test:frontend-generated-typecheck',
    'run_phase "api-server-typecheck" pnpm run test:api-server-typecheck',
    'run_phase "browser-specs-typecheck" pnpm run test:browser-specs-typecheck',
    'run_phase "browser-fixtures" pnpm run test:browser-fixtures',
    'run_phase "bundle-budget" pnpm run test:bundle-budget',
    'run_phase "frontend-standards" pnpm run test:frontend-standards',
    'run_phase "seo-standards" pnpm run test:seo-standards',
    'run_phase "public-salon-address" pnpm --filter @workspace/scripts exec tsx --test ./src/public-salon-address.test.ts',
    'run_phase "salon-address-input" pnpm --filter @workspace/scripts run test:salon-address-input',
    'run_phase "frontend-interactions" pnpm run test:frontend-interactions',
    'run_phase "rmas" pnpm run test:rmas',
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
  const emittedPhasesByJob = Object.fromEntries(
    ["build", "database", "browser"].map((job) => {
      const jobBlock = Array.from(
        buildTimingScript.matchAll(
          new RegExp(`^  ${job}\\)\\n([\\s\\S]*?)^    ;;$`, "gm"),
        ),
        (match) => match[1],
      ).find((block) => block.includes("run_phase "));
      assert.ok(jobBlock, `The timed CI runner must define the ${job} job.`);

      return [
        job,
        [
          ...Array.from(
            jobBlock.matchAll(/^\s+run_phase "([^"]+)"/gm),
            (match) => match[1],
          ),
          `validate:ci:${job}:total`,
        ],
      ];
    }),
  ) as Record<"build" | "database" | "browser", string[]>;
  const emittedPhases = Object.values(emittedPhasesByJob).flat().sort();
  const baselinePhases = Object.keys(timingBaselines.baselinesSeconds ?? {}).sort();

  assert.deepEqual(
    baselinePhases,
    emittedPhases,
    "Every phase emitted by the build, database, and browser timing reports must have exactly one baseline, with no stale baseline keys.",
  );
  for (const [job, phases] of Object.entries(emittedPhasesByJob)) {
    assert.ok(phases.length > 1, `The ${job} timing report must include phases and its total.`);
    for (const phase of phases) {
      assert.ok(
        (timingBaselines.baselinesSeconds?.[phase] ?? 0) > 0,
        `The ${job} timing report phase ${phase} must have a positive baseline.`,
      );
    }
  }
  assert.ok((timingBaselines.warningMultiplier ?? 0) > 1);
  assert.ok((timingBaselines.warningMinimumIncreaseSeconds ?? 0) > 0);
  assert.equal(
    scripts["validate:ci:database"],
    "export CI=true && bash scripts/run-ci-build-with-timings.sh database",
    "The database CI command must use the timing-aware runner for every database phase.",
  );
  assert.equal(
    scripts["validate:ci:browser"],
    "export CI=true && bash scripts/run-ci-build-with-timings.sh browser",
    "The browser CI command must use the timing-aware runner for every browser phase.",
  );

  assert.ok(parsedWorkflow.on?.pull_request !== undefined);
  assert.deepEqual(parsedWorkflow.on?.merge_group, {
    types: ["checks_requested"],
  });
  assert.deepEqual(parsedWorkflow.on?.push, {
    "branches-ignore": ["gh-readonly-queue/**"],
    tags: ["**"],
  });

  const migrationContractJob = parsedWorkflow.jobs?.["migration-contract"];
  assert.ok(migrationContractJob, "The migration-contract job must exist.");
  assert.equal(migrationContractJob.name, "Migration contract (database-free)");
  assert.equal(
    migrationContractJob.if,
    undefined,
    "Workflow on must be the sole event allowlist: every triggered event must run the migration contract.",
  );
  assert.equal(migrationContractJob.services, undefined);
  assert.equal(migrationContractJob.env?.DATABASE_URL, "");
  assert.equal(migrationContractJob.env?.LUMERA_MIGRATION_DATABASE_URL, "");
  assert.equal(
    migrationContractJob.env?.LUMERA_CI_PR_BASE_SHA,
    "${{ github.event.pull_request.base.sha }}",
  );
  assert.equal(
    migrationContractJob.env?.LUMERA_CI_MERGE_GROUP_BASE_SHA,
    "${{ github.event.merge_group.base_sha }}",
  );
  const checkoutStep = migrationContractJob.steps?.find(
    (step) => step.uses === "actions/checkout@v4",
  );
  assert.equal(
    checkoutStep?.with?.["fetch-depth"],
    2,
    "The gate must retain a shallow depth-two checkout before validator-owned bounded deepening.",
  );
  const migrationRuns = migrationContractJob.steps
    ?.map((step) => step.run)
    .filter((run): run is string => typeof run === "string") ?? [];
  assert.ok(migrationRuns.some((run) => run.includes("pnpm run test:migration-contract")));
  assert.ok(migrationRuns.some((run) => run.includes("pnpm run validate:ci:migration-contract")));
  assert.doesNotMatch(JSON.stringify(migrationContractJob), /\$\{\{\s*secrets\./);

  const releaseChainJob = parsedWorkflow.jobs?.["release-chain"];
  assert.equal(
    releaseChainJob?.needs,
    "migration-contract",
    "The migration contract must block the complete downstream release chain.",
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
  const databaseWorkflowJob = parsedWorkflow.jobs?.database;
  assert.ok(databaseWorkflowJob, "The database CI job must exist.");
  const databaseSteps = databaseWorkflowJob.steps ?? [];
  const databaseStepRuns = databaseSteps
    .map((step) => step.run?.trim())
    .filter((run): run is string => typeof run === "string");
  const findDatabaseStep = (command: string): number => {
    const index = databaseSteps.findIndex((step) => step.run?.trim() === command);
    assert.notEqual(index, -1, `Database CI must run ${command}.`);
    return index;
  };
  assert.match(databaseJob, /needs: release-chain/);
  assert.match(databaseJob, /image: postgres:16/);
  assert.match(databaseJob, /POSTGRES_DB: lumera_ci_database/);
  assert.match(
    databaseJob,
    /DATABASE_URL: postgres:\/\/lumera_ci:lumera_ci@127\.0\.0\.1:55432\/lumera_ci_database/,
  );
  const databasePreparationCommands = [
    "pnpm --filter @workspace/db run push-force",
    "pnpm --filter @workspace/scripts run ensure:retail-cart-index:ci",
    "pnpm --filter @workspace/scripts run test:retail-cart-ci-preparation",
    "pnpm run validate:ci:database",
    "pnpm run test:migrations:integration",
  ];
  let previousDatabasePreparationIndex = -1;
  for (const command of databasePreparationCommands) {
    const commandIndex = findDatabaseStep(command);
    assert.ok(
      commandIndex > previousDatabasePreparationIndex,
      `Database CI must order ${command} after the preceding preparation step and before the audit.`,
    );
    previousDatabasePreparationIndex = commandIndex;
  }
  assert.equal(
    databaseStepRuns.filter((run) => run === "pnpm --filter @workspace/db run push-force").length,
    1,
    "The isolated database schema must be prepared exactly once.",
  );
  assert.equal(
    databaseStepRuns.filter(
      (run) => run === "pnpm --filter @workspace/scripts run ensure:retail-cart-index:ci",
    ).length,
    1,
    "The isolated CI retail cart reconciliation must run exactly once.",
  );
  assert.equal(
    databaseStepRuns.filter(
      (run) => run === "pnpm --filter @workspace/scripts run test:retail-cart-ci-preparation",
    ).length,
    1,
    "The isolated CI retail cart preparation test must run exactly once.",
  );
  assert.equal(
    databaseStepRuns.filter((run) => run === "pnpm run validate:ci:database").length,
    1,
    "The database backend-standard audit must run exactly once.",
  );
  const migrationIntegrationSteps = databaseSteps.filter(
    (step) => step.run?.trim() === "pnpm run test:migrations:integration",
  );
  assert.equal(
    migrationIntegrationSteps.length,
    1,
    "The real Phase 4 migration integration suite must run exactly once.",
  );
  const migrationIntegrationStep = migrationIntegrationSteps[0]!;
  const databaseChecksStepIndex = findDatabaseStep("pnpm run validate:ci:database");
  const migrationIntegrationStepIndex = findDatabaseStep("pnpm run test:migrations:integration");
  assert.equal(
    migrationIntegrationStepIndex,
    databaseChecksStepIndex + 1,
    "The Phase 4 migration integration suite must run immediately after existing database checks.",
  );
  assert.equal(
    migrationIntegrationStep.env?.LUMERA_PHASE4_DISPOSABLE_DATABASE_URL,
    "postgres://lumera_ci:lumera_ci@127.0.0.1:55432/lumera_ci_database",
  );
  assert.equal(migrationIntegrationStep.env?.LUMERA_PHASE4_DISPOSABLE_DB, "1");
  assert.equal(databaseWorkflowJob.env?.LUMERA_PHASE4_DISPOSABLE_DATABASE_URL, undefined);
  assert.equal(databaseWorkflowJob.env?.LUMERA_PHASE4_DISPOSABLE_DB, undefined);
  assert.equal(migrationIntegrationStep.env?.LUMERA_PHASE4_UNIT_ONLY, undefined);
  assert.equal(databaseWorkflowJob.env?.LUMERA_PHASE4_UNIT_ONLY, undefined);
  assert.equal(parsedWorkflow.env?.LUMERA_PHASE4_UNIT_ONLY, undefined);
  assert.equal(migrationIntegrationStep["continue-on-error"], undefined);
  assert.equal(migrationIntegrationStep.if, undefined);
  const serializedMigrationIntegrationStep = JSON.stringify(migrationIntegrationStep);
  assert.doesNotMatch(serializedMigrationIntegrationStep, /LUMERA_PHASE4_UNIT_ONLY/u);
  assert.doesNotMatch(workflow, /LUMERA_PHASE4_UNIT_ONLY/u);
  assert.doesNotMatch(serializedMigrationIntegrationStep, /\$\{\{\s*secrets\./u);
  assert.doesNotMatch(serializedMigrationIntegrationStep, /\b(?:publish|deploy)\b/iu);
  assert.doesNotMatch(
    databaseStepRuns.join("\n"),
    /ensure(?::|-)?development-schema/,
    "CI must use the narrow retail cart reconciliation rather than broad development-schema reconciliation.",
  );
  const pushForceStepIndex = findDatabaseStep("pnpm --filter @workspace/db run push-force");
  const reconciliationStepIndex = findDatabaseStep(
    "pnpm --filter @workspace/scripts run ensure:retail-cart-index:ci",
  );
  assert.equal(
    reconciliationStepIndex,
    pushForceStepIndex + 1,
    "Retail cart reconciliation must be the step immediately after isolated schema preparation.",
  );
  assert.match(databaseJob, /name: Download recent successful database timing history/);
  assert.match(databaseJob, /name: Upload database timing history/);
  assert.match(databaseJob, /name: database-timings-\$\{\{ github\.run_attempt \}\}/);
  assert.match(databaseJob, /path: ci-timings\/database-timings\.json/);
  assert.match(databaseJob, /retention-days: 90/);
  assert.doesNotMatch(
    databaseJob,
    /\$\{\{\s*secrets\./,
    "Database checks must not consume repository secrets.",
  );

  const browserJob = workflow.slice(workflow.indexOf("  browser:"));
  assert.match(
    browserJob,
    /needs:\n {6}- release-chain\n {6}- build\n {4}runs-on:/,
    "Browser journeys must wait for the early gate and build, not the independent database checks.",
  );
  assert.match(browserJob, /image: postgres:16/);
  assert.match(browserJob, /POSTGRES_DB: lumera_ci_browser/);
  assert.match(browserJob, /playwright install --with-deps chromium/);
  assert.match(browserJob, /run: pnpm run validate:ci:browser/);
  assert.match(browserJob, /name: Download recent successful browser timing history/);
  assert.match(browserJob, /name: Upload browser timing history/);
  assert.match(browserJob, /name: browser-timings-\$\{\{ github\.run_attempt \}\}/);
  assert.match(browserJob, /path: ci-timings\/browser-timings\.json/);
  assert.match(browserJob, /retention-days: 90/);
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
  const [rootPackageJson, scriptsPackageJson, browserEntries] = await Promise.all([
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "package.json"), "utf8"),
    readdir(path.join(workspaceRoot, "scripts", "browser"), {
      withFileTypes: true,
    }),
  ]);
  const rootScripts = (JSON.parse(rootPackageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  const parsedScriptsPackageJson = JSON.parse(scriptsPackageJson) as {
    scripts?: Record<string, string>;
    focusedAdministratorBrowserGates?: FocusedAdministratorBrowserGateInventory;
  };
  const packageScripts = parsedScriptsPackageJson.scripts ?? {};
  const inventory = parsedScriptsPackageJson.focusedAdministratorBrowserGates;
  const isolatedPhaseCommand = rootScripts[requiredIsolatedBrowserGatePhase];
  const administratorSpecFiles = browserEntries
    .filter((entry) => entry.isFile() && /^admin-[\w-]+\.spec\.ts$/.test(entry.name))
    .map((entry) => `browser/${entry.name}`);

  assert.ok(isolatedPhaseCommand, `${requiredIsolatedBrowserGatePhase} must be defined.`);
  assert.ok(
    inventory,
    "scripts/package.json must define focusedAdministratorBrowserGates as the authoritative release/local-only inventory for focused administrator browser commands.",
  );

  validateFocusedAdministratorBrowserGateInventory(
    packageScripts,
    inventory,
    isolatedPhaseCommand,
    administratorSpecFiles,
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

test("an administrator browser spec without a runnable command fails validation", () => {
  const packageScripts: Record<string, string> = {
    "test:admin-existing": "pnpm run playwright:checked -- browser/admin-existing.spec.ts",
  };
  const inventory = {
    scriptNamePattern: "test:admin-*",
    specFilePattern: "browser/admin-*.spec.ts",
    release: ["test:admin-existing"],
    localOnly: [],
  };

  assert.throws(
    () =>
      validateFocusedAdministratorBrowserGateInventory(
        packageScripts,
        inventory,
        "pnpm run test:admin-existing",
        ["browser/admin-existing.spec.ts", "browser/admin-unreferenced.spec.ts"],
      ),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.startsWith(
        "Every browser/admin-*.spec.ts file must be referenced by exactly one convention-compliant test:admin-* command.",
      ),
  );
});

test("focused salon-owner browser inventory remains wired into the release gate", async () => {
  const [rootPackageJson, scriptsPackageJson, browserEntries] = await Promise.all([
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "package.json"), "utf8"),
    readdir(path.join(workspaceRoot, "scripts", "browser"), { withFileTypes: true }),
  ]);
  const rootScripts = (JSON.parse(rootPackageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  const parsedScriptsPackageJson = JSON.parse(scriptsPackageJson) as {
    scripts?: Record<string, string>;
    focusedOwnerBrowserGates?: FocusedOwnerBrowserGateInventory;
  };
  const packageScripts = parsedScriptsPackageJson.scripts ?? {};
  const inventory = parsedScriptsPackageJson.focusedOwnerBrowserGates;
  const isolatedPhaseCommand = rootScripts[requiredIsolatedBrowserGatePhase];
  const ownerSpecFiles = browserEntries
    .filter((entry) => entry.isFile() && /^owner-[\w-]+\.spec\.ts$/.test(entry.name))
    .map((entry) => `browser/${entry.name}`);

  assert.ok(isolatedPhaseCommand, `${requiredIsolatedBrowserGatePhase} must be defined.`);
  assert.ok(
    inventory,
    "scripts/package.json must define focusedOwnerBrowserGates as the authoritative release/local-only inventory for focused salon-owner browser commands.",
  );

  validateFocusedOwnerBrowserGateInventory(
    packageScripts,
    inventory,
    isolatedPhaseCommand,
    ownerSpecFiles,
  );
});

test("a salon-owner browser spec without a runnable command fails validation", () => {
  const packageScripts = {
    "test:owner-existing": "pnpm run playwright:checked -- browser/owner-existing.spec.ts",
  };

  assert.throws(
    () =>
      validateFocusedOwnerBrowserGateInventory(
        packageScripts,
        {
          scriptNamePattern: "test:owner-*",
          specFilePattern: "browser/owner-*.spec.ts",
          release: ["test:owner-existing"],
          localOnly: [],
        },
        "pnpm run test:owner-existing",
        ["browser/owner-existing.spec.ts", "browser/owner-unreferenced.spec.ts"],
      ),
    (error: unknown) =>
      error instanceof assert.AssertionError &&
      error.message.startsWith(
        "Every browser/owner-*.spec.ts file must be referenced by exactly one convention-compliant test:owner-* command.",
      ),
  );
});

test("focused employee browser inventory remains wired into the release gate", async () => {
  const [rootPackageJson, scriptsPackageJson, browserEntries] = await Promise.all([
    readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    readFile(path.join(workspaceRoot, "scripts", "package.json"), "utf8"),
    readdir(path.join(workspaceRoot, "scripts", "browser"), {
      withFileTypes: true,
    }),
  ]);
  const rootScripts = (JSON.parse(rootPackageJson) as { scripts?: Record<string, string> }).scripts ?? {};
  const parsedScriptsPackageJson = JSON.parse(scriptsPackageJson) as {
    scripts?: Record<string, string>;
    focusedEmployeeBrowserGates?: FocusedEmployeeBrowserGateInventory;
  };
  const packageScripts = parsedScriptsPackageJson.scripts ?? {};
  const inventory = parsedScriptsPackageJson.focusedEmployeeBrowserGates;
  const isolatedPhaseCommand = rootScripts[requiredIsolatedBrowserGatePhase];
  const employeeSpecFiles = browserEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^employee-[\w-]+\.spec\.ts$/.test(entry.name),
    )
    .map((entry) => `browser/${entry.name}`);

  assert.ok(isolatedPhaseCommand, `${requiredIsolatedBrowserGatePhase} must be defined.`);
  assert.ok(
    inventory,
    "scripts/package.json must define focusedEmployeeBrowserGates as the authoritative release/local-only inventory for focused employee browser commands.",
  );

  validateFocusedEmployeeBrowserGateInventory(
    packageScripts,
    inventory,
    isolatedPhaseCommand,
    employeeSpecFiles,
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
  const packageScripts: Record<string, string> = {
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
        [
          "browser/employee-existing.spec.ts",
          "browser/employee-new-regression.spec.ts",
        ],
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
        [
          "browser/employee-existing.spec.ts",
          "browser/employee-new-regression.spec.ts",
        ],
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
      [
        "browser/employee-existing.spec.ts",
        "browser/employee-new-regression.spec.ts",
      ],
    )
  );
});

test("an employee browser spec without a runnable command fails validation", () => {
  const inventory = {
    scriptNamePattern: "test:employee-*",
    specFilePattern: "browser/employee-*.spec.ts",
    release: ["test:employee-existing"],
    localOnly: [],
  };
  const employeeSpecFiles = [
    "browser/employee-existing.spec.ts",
    "browser/employee-unreferenced.spec.ts",
  ];
  const assertMissingRunnableCommand = (
    packageScripts: Record<string, string>,
  ) => {
    assert.throws(
      () =>
        validateFocusedEmployeeBrowserGateInventory(
          packageScripts,
          inventory,
          "pnpm run test:employee-existing",
          employeeSpecFiles,
        ),
      (error: unknown) =>
        error instanceof assert.AssertionError &&
        error.message.startsWith(
          "Every browser/employee-*.spec.ts file must be referenced by exactly one convention-compliant test:employee-* command.",
        ),
    );
  };

  assertMissingRunnableCommand({
    "test:employee-existing":
      "pnpm run playwright:checked -- browser/employee-existing.spec.ts",
  });
  assertMissingRunnableCommand({
    "test:employee-existing":
      "pnpm run playwright:checked -- browser/employee-existing.spec.ts",
    "test:employee-unreferenced":
      "echo browser/employee-unreferenced.spec.ts",
  });
  assertMissingRunnableCommand({
    "test:employee-existing":
      "pnpm run playwright:checked -- browser/employee-existing.spec.ts",
    "test:employee-unreferenced":
      "pnpm run playwright:checked -- browser/employee-existing.spec.ts && echo browser/employee-unreferenced.spec.ts",
  });
});

test("CI timing history keeps the newest successful reports regardless of API order", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lumera-ci-timings-history-limit-"));
  const binDir = path.join(tempDir, "bin");
  const artifactZipDir = path.join(tempDir, "artifact-zips");
  const reportDir = path.join(tempDir, "reports");
  const historyDir = path.join(tempDir, "ci-timings", "history");
  const summaryPath = path.join(tempDir, "step-summary.md");
  const outputPath = path.join(tempDir, "github-output");
  const runsJsonPath = path.join(tempDir, "runs.json");
  const scriptsDir = path.join(tempDir, "scripts");
  const configPath = path.join(scriptsDir, "ci-build-timings.json");
  const fakeGhPath = path.join(binDir, "gh");
  const phase = (durationSeconds: number, significantSlowdown: boolean) => ({
    name: "scripts:typecheck",
    durationSeconds,
    significantSlowdown,
  });
  const buildReport = (
    startedAt: string,
    durationSeconds: number,
    significantSlowdown: boolean,
  ) => ({
    schemaVersion: 2,
    job: "build",
    status: "passed",
    startedAt,
    phases: [
      phase(durationSeconds, significantSlowdown),
      { ...phase(durationSeconds, significantSlowdown), name: "build:release" },
      { ...phase(durationSeconds, significantSlowdown), name: "validate:ci:build:total" },
    ],
  });
  const historicalRuns = [
    { id: "run-oldest", run_attempt: 1, run_started_at: "2026-09-01T12:00:00Z", duration: 1, slow: false },
    { id: "run-newest", run_attempt: 1, run_started_at: "2026-09-09T12:00:00Z", duration: 60, slow: true },
    { id: "run-middle", run_attempt: 1, run_started_at: "2026-09-08T12:00:00Z", duration: 50, slow: true },
    { id: "run-second-newest", run_attempt: 1, run_started_at: "2026-09-07T12:00:00Z", duration: 40, slow: true },
    { id: "run-second-oldest", run_attempt: 1, run_started_at: "2026-09-02T12:00:00Z", duration: 2, slow: false },
  ];

  await mkdir(binDir);
  await mkdir(artifactZipDir);
  await mkdir(reportDir);
  await mkdir(scriptsDir);
  await writeFile(
    runsJsonPath,
    JSON.stringify([{
      workflow_runs: historicalRuns.map(({ id, run_attempt, run_started_at }) => ({
        id,
        run_attempt,
        run_started_at,
      })),
    }]),
  );
  await writeFile(configPath, JSON.stringify({ historyLimit: 3, sustainedSlowdownRuns: 4 }));
  await writeFile(
    path.join(tempDir, "current-build-timings.json"),
    JSON.stringify(buildReport("2026-09-10T12:00:00Z", 10, true)),
  );

  for (const run of historicalRuns) {
    const reportPath = path.join(reportDir, run.id, "build-timings.json");
    const zipPath = path.join(artifactZipDir, `artifact-${run.id}.zip`);
    await mkdir(path.dirname(reportPath));
    await writeFile(reportPath, JSON.stringify(buildReport(run.run_started_at, run.duration, run.slow)));
    const zipResult = await runCommand("zip", ["-q", "-j", zipPath, reportPath], process.env, tempDir);
    assert.equal(zipResult.code, 0, `Could not create test artifact ZIP: ${zipResult.stderr}`);
  }

  await writeFile(
    fakeGhPath,
    `#!/usr/bin/env bash
set -euo pipefail
endpoint=""
for arg in "$@"; do
  case "$arg" in
    repos/example/lumera|repos/example/lumera/*) endpoint="$arg" ;;
  esac
done
case "$endpoint" in
  repos/example/lumera)
    printf '%s\\n' 'main'
    ;;
  repos/example/lumera/actions/workflows/ci.yml/runs)
    cat "$FAKE_RUNS_JSON"
    ;;
  repos/example/lumera/actions/runs/*/artifacts)
    run_id="\${endpoint##*/actions/runs/}"
    run_id="\${run_id%/artifacts}"
    printf '{"artifacts":[{"id":"artifact-%s","name":"build-timings-1","expired":false,"created_at":"2026-09-10T12:00:00Z"}]}\\n' "$run_id"
    ;;
  repos/example/lumera/actions/artifacts/*/zip)
    artifact_id="\${endpoint##*/artifacts/}"
    artifact_id="\${artifact_id%/zip}"
    cat "$FAKE_ARTIFACT_ZIP_DIR/\${artifact_id}.zip"
    ;;
  *)
    echo "Unexpected GitHub API endpoint: $endpoint" >&2
    exit 1
    ;;
esac
`,
  );
  await chmod(fakeGhPath, 0o755);

  const downloadScript = extractWorkflowRunStep(
    await readFile(branchCiPath, "utf8"),
    "Download recent successful build timing history",
  );
  const environment = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    GITHUB_REPOSITORY: "example/lumera",
    GITHUB_OUTPUT: outputPath,
    GITHUB_STEP_SUMMARY: summaryPath,
    FAKE_RUNS_JSON: runsJsonPath,
    FAKE_ARTIFACT_ZIP_DIR: artifactZipDir,
    GH_TOKEN: "test-token",
  };
  const downloadResult = await runCommand(
    "bash",
    ["-euo", "pipefail", "-c", downloadScript],
    environment,
    tempDir,
  );
  assert.equal(downloadResult.code, 0, `History download failed: ${downloadResult.stderr}`);
  assert.match(await readFile(outputPath, "utf8"), /^history_count=3$/m);

  const historyEntries = await readdir(historyDir, { withFileTypes: true });
  assert.deepEqual(
    historyEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
    ["run-middle", "run-newest", "run-second-newest"],
    "Only the three newest successful reports may be downloaded.",
  );

  const trendResult = await runCommand(
    "node",
    [
      path.join(workspaceRoot, "scripts", "summarize-ci-build-trend.mjs"),
      path.join(tempDir, "current-build-timings.json"),
      historyDir,
      summaryPath,
      configPath,
    ],
    process.env,
    tempDir,
  );
  assert.equal(trendResult.code, 0, `Trend summary failed: ${trendResult.stderr}`);
  const summary = await readFile(summaryPath, "utf8");
  assert.match(summary, /Historical reports found: 3\./);
  assert.match(
    summary,
    /\| scripts:typecheck \| 45s \| — \| — \| 4 \| 4 \| ⚠️ Sustained slowdown \|/,
    "The trend must use the current report plus the three newest historical reports.",
  );
});

test("database and browser timing history keep newest reports regardless of API order", async () => {
  const jobs = {
    database: [
      "database:test:monitoring",
      "database:test:backend-standards:static",
      "database:release:2-backend",
      "database:release:3-api",
      "validate:ci:database:total",
    ],
    browser: [
      "browser:release:4-isolated",
      "browser:release:5-final",
      "validate:ci:browser:total",
    ],
  } as const;
  const workflow = await readFile(branchCiPath, "utf8");

  for (const [job, phaseNames] of Object.entries(jobs)) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), `lumera-${job}-timings-history-limit-`));
    const binDir = path.join(tempDir, "bin");
    const artifactZipDir = path.join(tempDir, "artifact-zips");
    const reportDir = path.join(tempDir, "reports");
    const historyDir = path.join(tempDir, "ci-timings", "history");
    const summaryPath = path.join(tempDir, "step-summary.md");
    const runsJsonPath = path.join(tempDir, "runs.json");
    const scriptsDir = path.join(tempDir, "scripts");
    const configPath = path.join(scriptsDir, "ci-build-timings.json");
    const fakeGhPath = path.join(binDir, "gh");

    const report = (startedAt: string, durationSeconds: number) => ({
      schemaVersion: 2,
      job,
      status: "passed",
      startedAt,
      phases: phaseNames.map((name) => ({
        name,
        durationSeconds,
        significantSlowdown: true,
      })),
    });

    const historicalRuns = [
      { id: `${job}-oldest`, run_started_at: "2026-09-01T12:00:00Z", duration: 1 },
      { id: `${job}-newest`, run_started_at: "2026-09-09T12:00:00Z", duration: 60 },
      { id: `${job}-middle`, run_started_at: "2026-09-08T12:00:00Z", duration: 50 },
      { id: `${job}-second-newest`, run_started_at: "2026-09-07T12:00:00Z", duration: 40 },
      { id: `${job}-second-oldest`, run_started_at: "2026-09-02T12:00:00Z", duration: 2 },
    ];

  await mkdir(binDir);
  await mkdir(artifactZipDir);
  await mkdir(reportDir);
  await mkdir(scriptsDir);
  await writeFile(
    runsJsonPath,
    JSON.stringify([{
      workflow_runs: historicalRuns.map(({ id, run_started_at }) => ({ id, run_started_at })),
    }]),
  );
  await writeFile(
    configPath,
    JSON.stringify({ historyLimit: 3, sustainedSlowdownRuns: 4 }),
  );
    const currentPath = path.join(tempDir, `current-${job}-timings.json`);
    await writeFile(currentPath, JSON.stringify(report("2026-09-10T12:00:00Z", 10)));

    for (const run of historicalRuns) {
      const reportPath = path.join(reportDir, run.id, `${job}-timings.json`);
      const zipPath = path.join(artifactZipDir, `artifact-${run.id}.zip`);
      await mkdir(path.dirname(reportPath));
      await writeFile(reportPath, JSON.stringify(report(run.run_started_at, run.duration)));
      const zipResult = await runCommand("zip", ["-q", "-j", zipPath, reportPath], process.env, tempDir);
      assert.equal(zipResult.code, 0, `Could not create ${job} test artifact ZIP: ${zipResult.stderr}`);
    }

    await writeFile(
      fakeGhPath,
      `#!/usr/bin/env bash
set -euo pipefail
endpoint=""
has_jq=false
for arg in "$@"; do
  case "$arg" in
    repos/example/lumera|repos/example/lumera/*) endpoint="$arg" ;;
    --jq) has_jq=true ;;
  esac
done
case "$endpoint" in
  repos/example/lumera)
    printf '%s\\n' 'main'
    ;;
  repos/example/lumera/actions/workflows/ci.yml/runs)
    cat "$FAKE_RUNS_JSON"
    ;;
  repos/example/lumera/actions/runs/*/artifacts)
    run_id="\${endpoint##*/actions/runs/}"
    run_id="\${run_id%/artifacts}"
    if [[ "$has_jq" == true ]]; then
      printf 'artifact-%s\\n' "$run_id"
    else
      printf '{"artifacts":[{"id":"artifact-%s","name":"${job}-timings-1","expired":false,"created_at":"2026-09-10T12:00:00Z"}]}\\n' "$run_id"
    fi
    ;;
  repos/example/lumera/actions/artifacts/*/zip)
    artifact_id="\${endpoint##*/artifacts/}"
    artifact_id="\${artifact_id%/zip}"
    cat "$FAKE_ARTIFACT_ZIP_DIR/\${artifact_id}.zip"
    ;;
  *)
    echo "Unexpected GitHub API endpoint: $endpoint" >&2
    exit 1
    ;;
esac
`,
    );
    await chmod(fakeGhPath, 0o755);

    const downloadScript = extractWorkflowRunStep(
      workflow,
      `Download recent successful ${job} timing history`,
    );
    const downloadResult = await runCommand(
      "bash",
      ["-euo", "pipefail", "-c", downloadScript],
      {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        GITHUB_REPOSITORY: "example/lumera",
        GITHUB_STEP_SUMMARY: summaryPath,
        FAKE_RUNS_JSON: runsJsonPath,
        FAKE_ARTIFACT_ZIP_DIR: artifactZipDir,
        GH_TOKEN: "test-token",
      },
      tempDir,
    );
    assert.equal(downloadResult.code, 0, `${job} history download failed: ${downloadResult.stderr}`);

    const historyEntries = await readdir(historyDir, { withFileTypes: true });
    assert.deepEqual(
      historyEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
      [`${job}-middle`, `${job}-newest`, `${job}-second-newest`],
      `Only the three newest ${job} reports may be downloaded.`,
    );

    const trendResult = await runCommand(
      "node",
      [
        path.join(workspaceRoot, "scripts", "summarize-ci-build-trend.mjs"),
        currentPath,
        historyDir,
        summaryPath,
        configPath,
      ],
      process.env,
      tempDir,
    );
    assert.equal(trendResult.code, 0, `${job} trend summary failed: ${trendResult.stderr}`);
    const summary = await readFile(summaryPath, "utf8");

    assert.match(summary, /Historical reports found: 3\./);
    assert.match(
      summary,
      new RegExp(`\\| ${phaseNames[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\| 45s \\| — \\| — \\| 4 \\| 4 \\|`),
      `The ${job} trend must exclude older reports outside historyLimit.`,
    );
  }
});
