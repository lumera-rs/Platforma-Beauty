#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
baseline_file="$workspace_root/scripts/ci-build-timings.json"
report_dir="${CI_TIMING_REPORT_DIR:-$workspace_root/ci-timings}"
job="${1:-build}"
case "$job" in
  build)
    report_name="build-timings.json"
    total_phase="validate:ci:build:total"
    ;;
  database)
    report_name="database-timings.json"
    total_phase="validate:ci:database:total"
    ;;
  browser)
    report_name="browser-timings.json"
    total_phase="validate:ci:browser:total"
    ;;
  *)
    echo "Unknown CI timing job: $job (expected build, database, or browser)" >&2
    exit 2
    ;;
esac
report_file="$report_dir/$report_name"
history_dir="${CI_TIMING_HISTORY_DIR:-$report_dir/history}"
summary_file="${GITHUB_STEP_SUMMARY:-$report_dir/build-summary.md}"
fallback_report_dir="${CI_TIMING_REPORT_FALLBACK_DIR:-}"
fallback_report_file=""
fallback_summary_file=""
if mkdir -p "$report_dir"; then
  :
else
  echo "::error title=CI build report failed::Could not prepare primary timing report directory at $report_dir. A fallback location will be attempted after the build." >&2
fi

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

initialize_fallback_report_dir() {
  if [ -n "$fallback_report_dir" ]; then
    fallback_report_file="$fallback_report_dir/$report_name"
    fallback_summary_file="$fallback_report_dir/build-summary.md"
  else
    local fallback_parent="${CI_TIMING_REPORT_FALLBACK_PARENT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}}"
    if ! mkdir -p "$fallback_parent"; then
      return 1
    fi
    if ! fallback_report_dir="$(mktemp -d "$fallback_parent/lumera-ci-timings.XXXXXX")"; then
      return 1
    fi
    fallback_report_file="$fallback_report_dir/$report_name"
    fallback_summary_file="$fallback_report_dir/build-summary.md"
  fi

  if ! mkdir -p "$fallback_report_dir"; then
    return 1
  fi

  local write_probe="$fallback_report_dir/.write-probe.$$"
  if ! (umask 077 && : > "$write_probe") || ! rm -f "$write_probe"; then
    return 1
  fi
}

write_json_report() {
  local target="$1"
  node - "$measurements_file" "$target" "$status" "$job" "$warning_multiplier" "$warning_minimum_increase_seconds" "$run_started_ms" <<'NODE'
const fs = require("node:fs");
const [measurementsPath, reportPath, status, job, multiplierRaw, minimumIncreaseRaw, startedAtRaw] = process.argv.slice(2);
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
  schemaVersion: 2,
  job,
  status,
  startedAt: new Date(Number(startedAtRaw)).toISOString(),
  commitSha: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  phases,
}, null, 2) + "\n");
NODE
}

write_markdown_summary() {
  local target="$1"
  {
    echo "### CI timing trend"
    echo
    echo "| Phase | Duration | Baseline | Warning threshold | Result |"
    echo "| --- | ---: | ---: | ---: | --- |"
    node - "$report_file_for_consumers" <<'NODE'
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
  } > "$target"
}

write_report() {
  local status="$1"
  local report_status=0
  local step_status=0
  local total_seconds="$((SECONDS - run_started_seconds))"
  if record_timing "$total_phase" "$total_seconds"; then
    :
  else
    step_status=$?
    report_status=1
    echo "::error title=CI build report failed::Could not record total build timing (exit code $step_status)." >&2
  fi

  report_file_for_consumers="$report_file"
  if write_json_report "$report_file"; then
    :
  else
    step_status=$?
    report_status=1
    echo "::error title=CI build report failed::Could not write JSON timing report (exit code $step_status)." >&2
    if initialize_fallback_report_dir && write_json_report "$fallback_report_file"; then
      report_file_for_consumers="$fallback_report_file"
      echo "::notice title=CI build report fallback::Saved JSON timing report to $fallback_report_file." >&2
    else
      echo "::error title=CI build report failed::Could not write fallback JSON timing report." >&2
    fi
  fi

  if node - "$report_file_for_consumers" <<'NODE'
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

  summary_file_for_consumers="$summary_file"
  if [ "$report_file_for_consumers" != "$report_file" ]; then
    if write_markdown_summary "$fallback_summary_file"; then
      summary_file_for_consumers="$fallback_summary_file"
      echo "::notice title=CI build report fallback::Saved Markdown timing summary to $fallback_summary_file." >&2
    else
      report_status=1
      echo "::error title=CI build report failed::Could not write fallback Markdown timing summary." >&2
    fi
  elif write_markdown_summary "$summary_file"; then
    :
  else
    step_status=$?
    report_status=1
    echo "::error title=CI build report failed::Could not write Markdown timing summary at $summary_file (exit code $step_status)." >&2
    if initialize_fallback_report_dir; then
      if [ "$report_file_for_consumers" = "$report_file" ] && write_json_report "$fallback_report_file"; then
        report_file_for_consumers="$fallback_report_file"
      fi
      if write_markdown_summary "$fallback_summary_file"; then
        summary_file_for_consumers="$fallback_summary_file"
        echo "::notice title=CI build report fallback::Saved Markdown timing summary to $fallback_summary_file." >&2
      else
        echo "::error title=CI build report failed::Could not write fallback Markdown timing summary." >&2
      fi
    else
      echo "::error title=CI build report failed::Could not prepare a fallback timing report directory." >&2
    fi
  fi

  if [ "$status" = "passed" ]; then
    node "$workspace_root/scripts/summarize-ci-build-trend.mjs" \
      "$report_file_for_consumers" "$history_dir" "$summary_file_for_consumers" "$baseline_file" \
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

case "$job" in
  build)
    run_phase "build:release" pnpm run build:release
    run_phase "scripts:typecheck" pnpm --filter @workspace/scripts run typecheck
    run_phase "internal-request-controls" pnpm run test:internal-request-controls
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
    ;;
  database)
    run_phase "database:test:monitoring" pnpm run test:monitoring
    run_phase "database:test:backend-standards:static" pnpm run test:backend-standards:static
    run_phase "database:release:2-backend" pnpm run validate:release:2-backend
    run_phase "database:release:3-api" pnpm run validate:release:3-api
    ;;
  browser)
    run_phase "browser:release:4-isolated" pnpm run validate:release:4-isolated
    run_phase "browser:release:5-final" pnpm run validate:release:5-final
    ;;
esac

trap - ERR
if write_report "$status"; then
  :
else
  report_status=$?
  echo "::error title=CI build report failed::Build passed, but report writing failed (exit code $report_status)." >&2
  exit "$report_status"
fi