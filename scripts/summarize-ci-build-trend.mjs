#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TREND_PHASES_BY_JOB = {
  build: [
  "scripts:typecheck",
  "build:release",
  "validate:ci:build:total",
  ],
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
};

// Keep the original export for consumers that only inspect the build trend.
export const TREND_PHASES = TREND_PHASES_BY_JOB.build;

function reportJob(report) {
  return report?.job ?? "build";
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function buildTrend(currentReport, historicalReports, sustainedSlowdownRuns) {
  const job = reportJob(currentReport);
  const reports = [currentReport, ...historicalReports]
    .filter((report) => report?.status === "passed" && reportJob(report) === job)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const phaseNames = TREND_PHASES_BY_JOB[job] ?? [
    ...new Set(reports.flatMap((report) => report.phases?.map((phase) => phase.name) ?? [])),
  ];

  return phaseNames.map((name) => {
    const phaseReports = reports.map((report) => report.phases?.find((phase) => phase.name === name));
    const observations = phaseReports.filter((phase) => Number.isFinite(phase?.durationSeconds));
    let consecutiveSlowdowns = 0;
    for (const phase of phaseReports) {
      if (!Number.isFinite(phase?.durationSeconds) || phase.significantSlowdown !== true) break;
      consecutiveSlowdowns += 1;
    }

    return {
      name,
      observations: observations.length,
      medianSeconds: median(observations.map((phase) => phase.durationSeconds)),
      baselineSeconds: Number.isFinite(phaseReports[0]?.baselineSeconds)
        ? phaseReports[0].baselineSeconds
        : null,
      warningThresholdSeconds: Number.isFinite(phaseReports[0]?.warningThresholdSeconds)
        ? phaseReports[0].warningThresholdSeconds
        : null,
      consecutiveSlowdowns,
      sustainedSlowdown: consecutiveSlowdowns >= sustainedSlowdownRuns,
    };
  });
}

function readReports(historyDir, limit, job) {
  if (!fs.existsSync(historyDir)) return [];
  return fs.readdirSync(historyDir, { recursive: true })
    .filter((file) => /-timings\.json$/.test(path.basename(file)))
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((report) => report?.status === "passed" && reportJob(report) === job)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, limit);
}

function formatSeconds(value) {
  if (value === null) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}s`;
}

export function main(argv = process.argv.slice(2)) {
  const [currentPath, historyDir, summaryPath, configPath] = argv;
  const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const job = reportJob(current);
  const history = readReports(historyDir, config.historyLimit, job);
  const trend = buildTrend(current, history, config.sustainedSlowdownRuns);

  const lines = [
    "",
    `### Recent successful ${job} CI trend`,
    "",
    `Using the current successful ${job} run and up to ${config.historyLimit} previous successful main-branch reports for this job. Historical reports found: ${history.length}.`,
    "",
    "| Phase | Recent median | Baseline | Warning threshold | Observations | Consecutive slow results | Trend |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...trend.map((phase) => `| ${phase.name} | ${formatSeconds(phase.medianSeconds)} | ${formatSeconds(phase.baselineSeconds)} | ${formatSeconds(phase.warningThresholdSeconds)} | ${phase.observations} | ${phase.consecutiveSlowdowns} | ${phase.sustainedSlowdown ? "⚠️ Sustained slowdown" : "No sustained slowdown"} |`),
    "",
    `Warning threshold per phase is the greater of ${config.warningMultiplier}× baseline or baseline + ${config.warningMinimumIncreaseSeconds}s, rounded up. A sustained warning requires ${config.sustainedSlowdownRuns} consecutive successful results above that threshold; missing history never blocks the build.`,
  ];
  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);

  for (const phase of trend.filter((item) => item.sustainedSlowdown)) {
    console.log(`::warning title=Sustained CI build slowdown::${phase.name} exceeded its warning threshold in at least ${config.sustainedSlowdownRuns} consecutive successful builds (recent median ${formatSeconds(phase.medianSeconds)}).`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}