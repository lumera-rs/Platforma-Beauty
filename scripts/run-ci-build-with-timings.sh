#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
baseline_file="$workspace_root/scripts/ci-build-timings.json"
report_dir="${CI_TIMING_REPORT_DIR:-$workspace_root/ci-timings}"
report_file="$report_dir/build-timings.json"
history_dir="${CI_TIMING_HISTORY_DIR:-$report_dir/history}"
summary_file="${GITHUB_STEP_SUMMARY:-$report_dir/build-summary.md}"
mkdir -p "$report_dir"

warning_multiplier="$(node -e 'const b=require(process.argv[1]); process.stdout.write(String(b.warningMultiplier))' "$baseline_file")"
warning_minimum_increase_seconds="$(node -e 'const b=require(process.argv[1]); process.stdout.write(String(b.warningMinimumIncreaseSeconds))' "$baseline_file")"
run_started_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
run_started_seconds=$SECONDS
measurements_file="$(mktemp)"
trap 'rm -f "$measurements_file"' EXIT

baseline_for() {
  node -e 'const b=require(process.argv[1]); process.stdout.write(String(b.baselinesSeconds[process.argv[2]] ?? ""))' "$baseline_file" "$1"
}

record_timing() {
  local name="$1"
  local duration_seconds="$2"
  local baseline_seconds
  baseline_seconds="$(baseline_for "$name")"
  printf '%s\t%s\t%s\n' "$name" "$duration_seconds" "$baseline_seconds" >> "$measurements_file"
}

run_phase() {
  local name="$1"
  shift
  local started_seconds=$SECONDS
  echo "::group::$name"
  local status=0
  if "$@"; then
    status=0
  else
    status=$?
  fi
  echo "::endgroup::"
  record_timing "$name" "$((SECONDS - started_seconds))"
  return "$status"
}

write_report() {
  local status="$1"
  local report_status=0
  local step_status=0
  local total_seconds="$((SECONDS - run_started_seconds))"
  if record_timing "validate:ci:build:total" "$total_seconds"; then
    :
  else
    step_status=$?
    report_status=1
    echo "::error title=CI build report failed::Could not record total build timing (exit code $step_status)." >&2
  fi

  if node - "$measurements_file" "$report_file" "$status" "$warning_multiplier" "$warning_minimum_increase_seconds" "$run_started_ms" <<'NODE'
const fs = require("node:fs");
const [measurementsPath, reportPath, status, multiplierRaw, minimumIncreaseRaw, startedAtRaw] = process.argv.slice(2);
const multiplier = Number(multiplierRaw);
const minimumIncreaseSeconds = Number(minimumIncreaseRaw);
const phases = fs.readFileSync(measurementsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => {
  const [name, durationRaw, baselineRaw] = line.split("\t");
  const durationSeconds = Number(durationRaw);
  const baselineSeconds = baselineRaw === "" ? null : Number(baselineRaw);
  const warningThresholdSeconds = baselineSeconds === null
    ? null
    : Math.ceil(Math.max(baselineSeconds * multiplier, baselineSeconds + minimumIncreaseSeconds));
  return {
    name,
    durationSeconds,
    baselineSeconds,
    warningThresholdSeconds,
    significantSlowdown: warningThresholdSeconds !== null && durationSeconds >= warningThresholdSeconds,
  };
});
fs.writeFileSync(reportPath, JSON.stringify({
  schemaVersion: 1,
  status,
  startedAt: new Date(Number(startedAtRaw)).toISOString(),
  commitSha: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  phases,
}, null, 2) + "\n");
NODE
  then
    :
  else
    step_status=$?
    report_status=1
    echo "::error title=CI build report failed::Could not write JSON timing report (exit code $step_status)." >&2
  fi

  if node - "$report_file" <<'NODE'
const report = require(process.argv[2]);
for (const phase of report.phases.filter((item) => item.significantSlowdown)) {
  console.log(`::warning title=CI build slowdown::${phase.name} took ${phase.durationSeconds}s (baseline ${phase.baselineSeconds}s; warning threshold ${phase.warningThresholdSeconds}s). This warning does not block the build.`);
}
NODE
  then
    :
  else
    step_status=$?
    report_status=1
    echo "::error title=CI build report failed::Could not render timing warnings (exit code $step_status)." >&2
  fi

  if {
    echo "### Build timing trend"
    echo
    echo "| Phase | Duration | Baseline | Warning threshold | Result |"
    echo "| --- | ---: | ---: | ---: | --- |"
    node - "$report_file" <<'NODE'
const report = require(process.argv[2]);
for (const phase of report.phases) {
  const baseline = phase.baselineSeconds === null ? "—" : `${phase.baselineSeconds}s`;
  const threshold = phase.warningThresholdSeconds === null ? "—" : `${phase.warningThresholdSeconds}s`;
  const result = phase.significantSlowdown ? "⚠️ Significant slowdown" : "Within baseline range";
  console.log(`| ${phase.name} | ${phase.durationSeconds}s | ${baseline} | ${threshold} | ${result} |`);
}
NODE
    echo
    echo "Timing warnings are informational and never change the validation result."
  } >> "$summary_file"; then
    :
  else
    step_status=$?
    report_status=1
    echo "::error title=CI build report failed::Could not write Markdown timing summary at $summary_file (exit code $step_status)." >&2
  fi

  if [ "$status" = "passed" ]; then
    node "$workspace_root/scripts/summarize-ci-build-trend.mjs" \
      "$report_file" "$history_dir" "$summary_file" "$baseline_file" \
      || echo "::notice title=Build timing history unavailable::Could not summarize previous build timings. This does not block the build."
  fi

  return "$report_status"
}

status="passed"
handle_build_failure() {
  local build_status="$?"
  trap - ERR
  status="failed"

  local report_status=0
  if write_report "$status"; then
    :
  else
    report_status=$?
    echo "::error title=CI build report failed::Build failed with exit code $build_status; report writing also failed (exit code $report_status). Preserving the original build failure." >&2
  fi

  return "$build_status"
}
trap 'handle_build_failure' ERR

run_phase "build:release" pnpm run build:release
run_phase "scripts:typecheck" pnpm --filter @workspace/scripts run typecheck
run_phase "internal-request-control-outputs" pnpm run test:internal-request-control-outputs
run_phase "beauty-marketplace-typecheck" pnpm run test:beauty-marketplace-typecheck
run_phase "frontend-generated-typecheck" pnpm run test:frontend-generated-typecheck
run_phase "api-server-typecheck" pnpm run test:api-server-typecheck
run_phase "browser-specs-typecheck" pnpm run test:browser-specs-typecheck
run_phase "browser-fixtures" pnpm run test:browser-fixtures
run_phase "bundle-budget" pnpm run test:bundle-budget
run_phase "frontend-standards" pnpm run test:frontend-standards
run_phase "seo-standards" pnpm run test:seo-standards
run_phase "frontend-interactions" pnpm run test:frontend-interactions

trap - ERR
if write_report "$status"; then
  :
else
  report_status=$?
  echo "::error title=CI build report failed::Build passed, but report writing failed (exit code $report_status)." >&2
  exit "$report_status"
fi