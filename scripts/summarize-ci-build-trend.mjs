#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TREND_PHASES = [
  "scripts:typecheck",
  "build:release",
  "validate:ci:build:total",
];

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function buildTrend(currentReport, historicalReports, sustainedSlowdownRuns) {
  const reports = [currentReport, ...historicalReports]
    .filter((report) => report?.status === "passed")
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  return TREND_PHASES.map((name) => {
    const observations = reports
      .map((report) => report.phases?.find((phase) => phase.name === name))
      .filter((phase) => Number.isFinite(phase?.durationSeconds));
    const recent = observations.slice(0, sustainedSlowdownRuns);
    const sustainedSlowdown = recent.length === sustainedSlowdownRuns
      && recent.every((phase) => phase.significantSlowdown === true);

    return {
      name,
      observations: observations.length,
      medianSeconds: median(observations.map((phase) => phase.durationSeconds)),
      consecutiveSlowdowns: observations.findIndex((phase) => !phase.significantSlowdown) === -1
        ? observations.length
        : observations.findIndex((phase) => !phase.significantSlowdown),
      sustainedSlowdown,
    };
  });
}

function readReports(historyDir, limit) {
  if (!fs.existsSync(historyDir)) return [];
  return fs.readdirSync(historyDir, { recursive: true })
    .filter((file) => path.basename(file) === "build-timings.json")
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(historyDir, file), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((report) => report?.status === "passed")
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
  const history = readReports(historyDir, config.historyLimit);
  const trend = buildTrend(current, history, config.sustainedSlowdownRuns);

  const lines = [
    "",
    "### Recent successful build trend",
    "",
    `Using the current successful build and up to ${config.historyLimit} previous successful main-branch reports. Historical reports found: ${history.length}.`,
    "",
    "| Phase | Recent median | Observations | Consecutive slow results | Trend |",
    "| --- | ---: | ---: | ---: | --- |",
    ...trend.map((phase) => `| ${phase.name} | ${formatSeconds(phase.medianSeconds)} | ${phase.observations} | ${phase.consecutiveSlowdowns} | ${phase.sustainedSlowdown ? "⚠️ Sustained slowdown" : "No sustained slowdown"} |`),
    "",
    `A sustained warning requires ${config.sustainedSlowdownRuns} consecutive results above the existing per-phase warning threshold. Missing history never blocks the build.`,
  ];
  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);

  for (const phase of trend.filter((item) => item.sustainedSlowdown)) {
    console.log(`::warning title=Sustained CI build slowdown::${phase.name} exceeded its warning threshold in at least ${config.sustainedSlowdownRuns} consecutive successful builds (recent median ${formatSeconds(phase.medianSeconds)}).`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}