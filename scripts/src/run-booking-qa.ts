import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasRealActivityStateEvidence } from "./booking-load-telemetry";

type Status = "PASS" | "FAIL" | "NOT TESTED" | "NOT APPLICABLE";
type Severity = "critical" | "high" | "medium" | "low";
type CommandKey =
  | "appointment"
  | "tenant"
  | "notifications"
  | "admin"
  | "monitoring"
  | "browser"
  | "calendar"
  | "calendarTimezone"
  | "finalBooking";

type CommandOutcome = {
  key: CommandKey;
  command: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  status: "PASS" | "FAIL";
  outputTail: string;
};

type Failure = {
  problem: string;
  severity: Severity;
  reproduction: string;
  affectedSystem: string;
  risk: string;
  cause: string;
  solution: string;
  proposedSolution: string;
  applied: boolean;
  appliedStatus: "NOT APPLIED";
};

type Scenario = {
  id: string;
  area: string;
  title: string;
  critical: boolean;
  status: Status;
  evidence: string;
  source: string;
  telemetry?: "TELEMETRY UNAVAILABLE";
  failure?: Failure;
};

type ScenarioDefinition = Omit<Scenario, "status" | "evidence" | "source" | "failure"> & {
  command?: CommandKey;
  notApplicable?: string;
  failureSeverity?: Severity;
  risk?: string;
  establishedFailure?: Omit<Failure, "applied" | "appliedStatus">;
};

const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const reportDirectory = path.join(workspaceRoot, "reports", "booking-qa");

const commands: Record<CommandKey, string> = {
  appointment: "pnpm run test:appointment-regressions",
  tenant: "pnpm run test:tenant-isolation",
  notifications: "pnpm run test:rescheduled-confirmations && pnpm run test:salon-notifications:release",
  admin: "pnpm run test:admin-validation && pnpm run test:admin-list-pagination && pnpm run test:admin-summary",
  monitoring: "pnpm run test:monitoring",
  browser: "pnpm run test:booking-journey && pnpm --filter @workspace/scripts run test:appointment-status-consistency",
  calendar: "pnpm run test:booking-settings && pnpm --filter @workspace/scripts run test:service-availability && pnpm --filter @workspace/scripts run test:employee-location-booking",
  calendarTimezone: "pnpm run test:calendar-timezone-boundaries",
  finalBooking: "pnpm run test:final-booking-qa",
};

const definitions: ScenarioDefinition[] = [
  { id: "concurrency.slot-locking", area: "1. Concurrency and idempotency", title: "Concurrent requests cannot double-book one slot or leave a partial group", critical: true, command: "finalBooking", failureSeverity: "critical", risk: "Two customers may receive the same resource/time or a partial group may persist." },
  { id: "concurrency.idempotency-key-replay", area: "1. Concurrency and idempotency", title: "Idempotency-Key replays the original successful booking outcome", critical: true, command: "finalBooking", failureSeverity: "critical", risk: "Clients retrying after a transport failure may duplicate a booking or lose its original outcome." },
  { id: "calendar.availability-rules", area: "2. Calendar and timezone", title: "Calendar availability enforces hours, services, employees and locations", critical: true, command: "calendar", failureSeverity: "critical", risk: "Invalid or unavailable slots may be shown or booked." },
  { id: "calendar.timezone-boundaries", area: "2. Calendar and timezone", title: "Timezone, DST and date-boundary booking behavior", critical: true, command: "calendarTimezone", failureSeverity: "critical", risk: "A customer can book the wrong local day or time around timezone boundaries." },
  { id: "permissions.tenant-isolation", area: "3. Permissions, multi-tenant, and API ID tampering", title: "Foreign appointment data and mutations are rejected", critical: true, command: "tenant", failureSeverity: "critical", risk: "One salon or customer may read or alter another tenant's bookings." },
  { id: "permissions.mixed-ids", area: "3. Permissions, multi-tenant, and API ID tampering", title: "Mixed valid salon/service/employee/customer IDs are re-derived and rejected", critical: true, command: "finalBooking", failureSeverity: "critical", risk: "Tampered IDs may cross tenant or salon boundaries." },
  { id: "recovery.transaction-rollback", area: "4. Failure recovery and deterministic outcome", title: "Database failure rolls back grouped booking atomically", critical: true, command: "finalBooking", failureSeverity: "critical", risk: "A database interruption can leave partial durable booking state." },
  { id: "recovery.lost-response-reconciliation", area: "4. Failure recovery and deterministic outcome", title: "Lost response/process restart can reconcile a booking command to its durable outcome", critical: true, command: "finalBooking", failureSeverity: "critical", risk: "A client may be unable to determine whether an accepted booking committed." },
  { id: "notifications.retry-dedup", area: "5. Notifications retry and deduplication", title: "Rescheduled confirmations retry durably without duplicate sends", critical: false, command: "notifications", failureSeverity: "high", risk: "Customers may miss changed appointment details or receive duplicate notifications." },
  { id: "notifications.cross-process", area: "5. Notifications retry and deduplication", title: "Owner alerts are tenant-isolated and recover across API processes", critical: false, command: "notifications", failureSeverity: "high", risk: "An owner may miss alerts or receive another salon's alert." },
  { id: "integrity.lifecycle-history", area: "6. Data integrity, status, and history", title: "Lifecycle races preserve one terminal status and status history", critical: true, command: "finalBooking", failureSeverity: "critical", risk: "Appointment state and audit history may disagree." },
  { id: "integrity.historical-snapshot", area: "6. Data integrity, status, and history", title: "Existing bookings retain historical price, duration and lifecycle after configuration changes", critical: true, command: "finalBooking", failureSeverity: "critical", risk: "Past bookings can be corrupted by later catalog changes." },
  { id: "ux.input-validation", area: "7. Input validation and responsive UX", title: "Booking API validates malformed/unauthorized input", critical: true, command: "appointment", failureSeverity: "critical", risk: "Malformed or unauthorized booking input may be accepted." },
  { id: "ux.responsive-booking", area: "7. Input validation and responsive UX", title: "Responsive customer booking and appointment-status UX", critical: false, command: "browser", failureSeverity: "high", risk: "Mobile customers may be unable to complete or understand a booking." },
  { id: "admin.list-controls", area: "8. Admin search, filter, sort, and pagination", title: "Administrative list search, filters, sort and pagination remain stable", critical: false, command: "admin", failureSeverity: "high", risk: "Administrative investigation and operations may omit or misorder records." },
  { id: "admin.booking-list", area: "8. Admin search, filter, sort, and pagination", title: "Centralized admin booking-list filter, sort and pagination", critical: false, notApplicable: "No centralized admin booking-list feature exists; booking lists are intentionally managed in the tenant-owned salon portal." },
  { id: "observability.monitoring-contract", area: "9. Observability with TELEMETRY UNAVAILABLE", title: "Slow requests, generic errors and fatal shutdown produce safe observability signals", critical: false, command: "monitoring", failureSeverity: "high", risk: "Booking incidents may not be detected or diagnosed." },
  { id: "observability.database-state", area: "9. Observability with TELEMETRY UNAVAILABLE", title: "Managed PostgreSQL activity-state telemetry", critical: false, failureSeverity: "medium", risk: "Database contention cannot be fully diagnosed during an incident." },
  { id: "load.same-slot", area: "10. Load and capacity (disposable staging)", title: "200-request same-slot collision objective", critical: true, failureSeverity: "critical", risk: "Peak collisions may create duplicates or excessive failures." },
  { id: "load.distinct", area: "10. Load and capacity (disposable staging)", title: "1,000 simultaneous distinct booking objective", critical: true, failureSeverity: "critical", risk: "A traffic spike may breach latency or error objectives." },
  { id: "load.groups", area: "10. Load and capacity (disposable staging)", title: "250 grouped-booking objective", critical: true, failureSeverity: "critical", risk: "Grouped bookings may fail or become partial under load." },
  { id: "load.mixed", area: "10. Load and capacity (disposable staging)", title: "1,000 mixed booking-operation objective", critical: true, failureSeverity: "critical", risk: "Mixed production traffic may exhaust API or database capacity." },
];

function selectedCommands(): CommandKey[] {
  const runArgument = process.argv.find((argument) => argument.startsWith("--run="))?.slice("--run=".length);
  if (process.argv.includes("--report-only") || runArgument === "none") return [];
  if (!runArgument || runArgument === "all") return Object.keys(commands) as CommandKey[];
  const selected = runArgument.split(",") as CommandKey[];
  for (const key of selected) {
    if (!(key in commands)) throw new Error(`Unknown booking QA command group: ${key}`);
  }
  return [...new Set(selected)];
}

async function runCommand(key: CommandKey): Promise<CommandOutcome> {
  const command = commands[key];
  const startedAt = new Date().toISOString();
  let output = "";
  const child = spawn("bash", ["-lc", command], {
    cwd: workspaceRoot,
    env: { ...process.env, CI: process.env.CI ?? "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk: Buffer) => {
    process.stdout.write(chunk);
    output = `${output}${chunk.toString()}`.slice(-12_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  return {
    key,
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...result,
    status: result.exitCode === 0 ? "PASS" : "FAIL",
    outputTail: output,
  };
}

async function loadCapacityEvidence(): Promise<{ path: string; report: any } | null> {
  for (const name of ["staging-capacity.json", "latest.json"]) {
    const candidate = path.join(workspaceRoot, "reports", "booking-load", name);
    try {
      return { path: path.relative(workspaceRoot, candidate), report: JSON.parse(await readFile(candidate, "utf8")) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

function commandScenario(definition: ScenarioDefinition, outcomes: Map<CommandKey, CommandOutcome>): Scenario {
  if (definition.establishedFailure) {
    return {
      ...definition,
      status: "FAIL",
      evidence: `Established code-review finding: ${definition.establishedFailure.cause}`,
      source: "code review",
      failure: {
        ...definition.establishedFailure,
        applied: false,
        appliedStatus: "NOT APPLIED",
      },
    };
  }
  if (definition.notApplicable) {
    return { ...definition, status: "NOT APPLICABLE", evidence: definition.notApplicable, source: "matrix policy" };
  }
  const outcome = definition.command ? outcomes.get(definition.command) : undefined;
  if (!outcome) {
    return {
      ...definition,
      status: "NOT TESTED",
      evidence: `Command not executed in this invocation: ${definition.command ? commands[definition.command] : "no evidence source"}`,
      source: definition.command ? commands[definition.command] : "none",
    };
  }
  if (outcome.status === "PASS") {
    return { ...definition, status: "PASS", evidence: `Command exited 0 at ${outcome.finishedAt}.`, source: outcome.command };
  }
  return {
    ...definition,
    status: "FAIL",
    evidence: `Command exited ${outcome.exitCode ?? outcome.signal ?? "without a code"} at ${outcome.finishedAt}.`,
    source: outcome.command,
    failure: {
      problem: "The required test command did not complete successfully.",
      severity: definition.failureSeverity ?? "high",
      reproduction: outcome.command,
      affectedSystem: definition.area,
      risk: definition.risk ?? "The scenario's expected booking behavior is not assured.",
      cause: "The command failed; inspect commandOutcomes.outputTail for the first actionable error. Root cause is not inferred.",
      solution: "Fix the first failing assertion or environment dependency, rerun this exact command, then regenerate the final report.",
      proposedSolution: "Preserve the existing production safeguards; apply only the smallest fix proven by the failing isolated test.",
      applied: false,
      appliedStatus: "NOT APPLIED",
    },
  };
}

function loadScenario(definition: ScenarioDefinition, load: Awaited<ReturnType<typeof loadCapacityEvidence>>): Scenario {
  const loadNames: Record<string, string> = {
    "load.same-slot": "same-slot",
    "load.distinct": "1000-distinct",
    "load.groups": "250-groups",
    "load.mixed": "mixed-1000",
  };
  if (!load) return commandScenario(definition, new Map());
  if (definition.id === "observability.database-state") {
    const expectedNames = Object.values(loadNames);
    const observed = expectedNames.map((name) => load.report.scenarios?.find((scenario: any) => scenario.name === name));
    const unavailable = observed.some((scenario) => !scenario || !hasRealActivityStateEvidence(scenario));
    return {
      ...definition,
      status: unavailable ? "NOT TESTED" : "PASS",
      evidence: unavailable
        ? "TELEMETRY UNAVAILABLE: every selected load scenario must contain observed PostgreSQL activity states."
        : "Real PostgreSQL activity-state evidence was observed in every load scenario.",
      source: load.path,
      ...(unavailable ? { telemetry: "TELEMETRY UNAVAILABLE" as const } : {}),
    };
  }
  const scenarioName = loadNames[definition.id];
  const result = load.report.scenarios?.find((scenario: any) => scenario.name === scenarioName);
  if (!result) return commandScenario(definition, new Map());
  const activityStateEvidence = hasRealActivityStateEvidence(result);
  const passed = result.objective?.passed === true
    && result.operationalObjective?.passed === true
    && activityStateEvidence
    && !load.report.failure;
  if (passed) {
    return {
      ...definition,
      status: "PASS",
      evidence: `${scenarioName}: p95=${result.latency?.p95}ms, p99=${result.latency?.p99}ms, unexpectedErrors=${result.unexpectedErrors}; customer and operational objectives passed.`,
      source: load.path,
    };
  }
  return {
    ...definition,
    status: "FAIL",
    evidence: `${scenarioName}: customerObjective=${String(result.objective?.passed)}, operationalObjective=${String(result.operationalObjective?.passed)}, activityStateEvidence=${String(activityStateEvidence)}, reportFailure=${load.report.failure ?? "none"}.`,
    source: load.path,
    failure: {
      problem: "The disposable staging load objective did not pass.",
      severity: definition.failureSeverity ?? "critical",
      reproduction: "pnpm run test:booking-load:staging",
      affectedSystem: definition.area,
      risk: definition.risk ?? "Capacity or data-integrity objectives are not assured.",
      cause: load.report.failure
        ?? (!activityStateEvidence
          ? "The scenario lacks real pg_stat_activity state evidence; disabled, restricted, empty, or failed telemetry cannot satisfy readiness."
          : "One or more measured customer or operational load objectives failed."),
      solution: load.report.optimizationDecision ?? "Diagnose the failed objective, apply a measured fix, and rerun the staging load profile.",
      proposedSolution: "Reproduce only in the disposable staging profile, preserve the connection budget, and rerun the complete objective set after the targeted fix.",
      applied: false,
      appliedStatus: "NOT APPLIED",
    },
  };
}

function countStatuses(scenarios: Scenario[]) {
  return {
    PASS: scenarios.filter((scenario) => scenario.status === "PASS").length,
    FAIL: scenarios.filter((scenario) => scenario.status === "FAIL").length,
    "NOT TESTED": scenarios.filter((scenario) => scenario.status === "NOT TESTED").length,
    "NOT APPLICABLE": scenarios.filter((scenario) => scenario.status === "NOT APPLICABLE").length,
  };
}

function markdown(report: any): string {
  const lines = [
    "# Final Booking QA",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `**Production readiness: ${report.productionReadiness.ready ? "READY" : "NOT READY"}** — ${report.productionReadiness.reason}`,
    "",
    ...(report.telemetry.status === "TELEMETRY UNAVAILABLE"
      ? ["**TELEMETRY UNAVAILABLE:** Real PostgreSQL activity-state evidence was missing from at least one selected load scenario. Pool, lock, latency, throughput and HTTP result measurements remain present.", ""]
      : []),
    "## Global totals",
    "",
    "| PASS | FAIL | NOT TESTED | NOT APPLICABLE | Critical | High | Medium | Low |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${report.totals.PASS} | ${report.totals.FAIL} | ${report.totals["NOT TESTED"]} | ${report.totals["NOT APPLICABLE"]} | ${report.severityCounts.critical} | ${report.severityCounts.high} | ${report.severityCounts.medium} | ${report.severityCounts.low} |`,
    "",
    "## Area totals",
    "",
    "| Area | PASS | FAIL | NOT TESTED | NOT APPLICABLE |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...report.areas.map((area: any) => `| ${area.area} | ${area.totals.PASS} | ${area.totals.FAIL} | ${area.totals["NOT TESTED"]} | ${area.totals["NOT APPLICABLE"]} |`),
    "",
    "## Scenario matrix",
    "",
    "| Area | Scenario | Critical | Result | Evidence |",
    "| --- | --- | :---: | --- | --- |",
    ...report.scenarios.map((scenario: Scenario) =>
      `| ${scenario.area} | ${scenario.title} | ${scenario.critical ? "yes" : "no"} | **${scenario.status}** | ${scenario.evidence.replaceAll("|", "\\|").replaceAll("\n", " ")} |`),
    "",
    "## Failures",
    "",
  ];
  const failures = report.scenarios.filter((scenario: Scenario) => scenario.status === "FAIL");
  if (!failures.length) lines.push("None.");
  for (const scenario of failures) {
    lines.push(
      `### ${scenario.id} — ${scenario.failure!.severity.toUpperCase()}`,
      "",
      `- Problem: ${scenario.failure!.problem}`,
      `- Reproduction: \`${scenario.failure!.reproduction}\``,
      `- Affected system: ${scenario.failure!.affectedSystem}`,
      `- Risk: ${scenario.failure!.risk}`,
      `- Cause: ${scenario.failure!.cause}`,
      `- Proposed safe solution: ${scenario.failure!.proposedSolution}`,
      `- Resolution guidance: ${scenario.failure!.solution}`,
      `- Applied status: ${scenario.failure!.appliedStatus}`,
      "",
    );
  }
  lines.push("## Unresolved blockers", "");
  for (const blocker of report.unresolvedBlockers) lines.push(`- ${blocker}`);
  if (!report.unresolvedBlockers.length) lines.push("None.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const selected = selectedCommands();
  const outcomes = new Map<CommandKey, CommandOutcome>();
  for (const key of selected) outcomes.set(key, await runCommand(key));
  const load = await loadCapacityEvidence();
  const loadIds = new Set([
    "load.same-slot",
    "load.distinct",
    "load.groups",
    "load.mixed",
    "observability.database-state",
  ]);
  const scenarios = definitions.map((definition) =>
    loadIds.has(definition.id) ? loadScenario(definition, load) : commandScenario(definition, outcomes));
  const areaNames = [...new Set(definitions.map((definition) => definition.area))];
  const areas = areaNames.map((area) => {
    const areaScenarios = scenarios.filter((scenario) => scenario.area === area);
    return { area, totals: countStatuses(areaScenarios) };
  });
  const failures = scenarios.filter((scenario) => scenario.status === "FAIL");
  const criticalUnverified = scenarios.filter((scenario) =>
    scenario.critical && (scenario.status === "FAIL" || scenario.status === "NOT TESTED"));
  const severityCounts = {
    critical: failures.filter((scenario) => scenario.failure?.severity === "critical").length,
    high: failures.filter((scenario) => scenario.failure?.severity === "high").length,
    medium: failures.filter((scenario) => scenario.failure?.severity === "medium").length,
    low: failures.filter((scenario) => scenario.failure?.severity === "low").length,
  };
  const unresolvedBlockers = [
    ...criticalUnverified.map((scenario) => `${scenario.id}: ${scenario.status}`),
    ...scenarios.filter((scenario) => scenario.telemetry === "TELEMETRY UNAVAILABLE")
      .map((scenario) => `${scenario.id}: TELEMETRY UNAVAILABLE`),
  ];
  const ready = failures.length === 0 && criticalUnverified.length === 0 && unresolvedBlockers.length === 0;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    statusVocabulary: ["PASS", "FAIL", "NOT TESTED", "NOT APPLICABLE"],
    telemetry: {
      status: scenarios.some((scenario) => scenario.telemetry) ? "TELEMETRY UNAVAILABLE" : "AVAILABLE",
      detail: "Managed PostgreSQL activity-state telemetry; other measurements are reported independently.",
    },
    productionReadiness: {
      ready,
      decision: ready ? "READY" : "NOT READY",
      reason: ready
        ? "All applicable scenarios passed and no blocker remains."
        : `Conservative gate blocked by ${failures.length} failure(s), ${criticalUnverified.length} critical failed/not-tested scenario(s), and ${unresolvedBlockers.length} unresolved blocker(s).`,
      rule: "Never ready when any critical scenario is FAIL or NOT TESTED; also block on any failure or unresolved telemetry blocker.",
    },
    commandOutcomes: [...outcomes.values()],
    loadEvidence: load?.path ?? null,
    totals: countStatuses(scenarios),
    severityCounts,
    areas,
    unresolvedBlockers,
    scenarios,
  };
  await mkdir(reportDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(reportDirectory, "final.json"), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(path.join(reportDirectory, "final.md"), markdown(report)),
  ]);
  console.log(`Booking QA report written to ${path.relative(workspaceRoot, reportDirectory)}/final.{json,md}`);
  if (process.argv.includes("--fail-on-blockers") && !ready) process.exitCode = 1;
}

await main();