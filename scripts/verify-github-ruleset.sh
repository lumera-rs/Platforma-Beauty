#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be owner/repository}"

api_url="${GITHUB_API_URL:-https://api.github.com}"
graphql_url="${GITHUB_GRAPHQL_URL:-https://api.github.com/graphql}"
expected_repository="lumera-rs/Platforma-Beauty"
ruleset_name="${GITHUB_RULESET_NAME:-Protect default branch CI}"
workflow_lint_context="GitHub Actions syntax and expressions"
workflow_file="workflow-lint.yml"
branch_ci_file="${LUMERA_BRANCH_CI_FILE:-.github/workflows/ci.yml}"
fixture_dir="${LUMERA_RULESET_AUDIT_FIXTURE_DIR:-}"

if [[ -n "$fixture_dir" && "${GITHUB_ACTIONS:-}" == "true" ]]; then
  echo "Ruleset audit fixture mode is forbidden in native GitHub Actions context." >&2
  exit 1
fi

migration_contract_context="$(
  awk '
    /^  migration-contract:$/ { in_job = 1; next }
    in_job && /^  [[:alnum:]_-]+:$/ { exit }
    in_job && /^    name: / { sub(/^    name: /, ""); print; exit }
  ' "$branch_ci_file"
)"
if [[ "$migration_contract_context" != "Migration contract (database-free)" ]]; then
  echo "Could not derive the exact Migration contract (database-free) check name from ${branch_ci_file}." >&2
  exit 1
fi

phase5_migration_context="$(
  awk '
    /^  phase5-migration-integration:$/ { in_job = 1; next }
    in_job && /^  [[:alnum:]_-]+:$/ { exit }
    in_job && /^    name: / { sub(/^    name: /, ""); print; exit }
  ' "$branch_ci_file"
)"
if [[ "$phase5_migration_context" != "Phase 5 migration integration (owned PostgreSQL 16)" ]]; then
  echo "Could not derive the exact Phase 5 migration integration check name from ${branch_ci_file}." >&2
  exit 1
fi

required_contexts_json="$(
  jq -cn \
    --arg lint "$workflow_lint_context" \
    --arg migration "$migration_contract_context" \
    --arg phase5 "$phase5_migration_context" \
    '[$lint, $migration, $phase5]'
)"

if [[ -z "$fixture_dir" ]]; then
  : "${GITHUB_TOKEN:?GITHUB_TOKEN with repository Administration read access is required}"
fi

if [[ "$GITHUB_REPOSITORY" != "$expected_repository" ]]; then
  echo "Refusing to audit unexpected repository ${GITHUB_REPOSITORY}; expected ${expected_repository}." >&2
  exit 1
fi

read_api_or_fixture() {
  local fixture_name="$1"
  local endpoint="$2"
  if [[ -n "$fixture_dir" ]]; then
    cat "${fixture_dir}/${fixture_name}.json"
  else
    curl --fail-with-body --silent --show-error \
      --header "Accept: application/vnd.github+json" \
      --header "Authorization: Bearer ${GITHUB_TOKEN}" \
      --header "X-GitHub-Api-Version: 2022-11-28" \
      "${api_url}${endpoint}"
  fi
}

read_graphql_or_fixture() {
  local fixture_name="$1"
  local payload="$2"
  if [[ -n "$fixture_dir" ]]; then
    cat "${fixture_dir}/${fixture_name}.json"
  else
    curl --fail-with-body --silent --show-error \
      --header "Accept: application/vnd.github+json" \
      --header "Authorization: Bearer ${GITHUB_TOKEN}" \
      --header "Content-Type: application/json" \
      --data-binary "$payload" \
      "$graphql_url"
  fi
}

repository="$(read_api_or_fixture repository "/repos/${GITHUB_REPOSITORY}")"

repository_owner="${GITHUB_REPOSITORY%%/*}"
repository_name="${GITHUB_REPOSITORY#*/}"
repository_graphql_payload="$(
  jq -cn \
    --arg owner "$repository_owner" \
    --arg name "$repository_name" \
    '{
      query: "query RepositoryMergedBranchDeletion($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { nameWithOwner viewerPermission deleteBranchOnMerge } }",
      variables: { owner: $owner, name: $name }
    }'
)"
repository_graphql="$(read_graphql_or_fixture graphql-repository "$repository_graphql_payload")"

if ! jq -e \
  --arg expected "$expected_repository" \
  '
    ((.errors // []) | length == 0)
    and (.data.repository.nameWithOwner == $expected)
    and (.data.repository.viewerPermission == "ADMIN")
    and (.data.repository.deleteBranchOnMerge | type == "boolean")
  ' <<<"$repository_graphql" >/dev/null; then
  echo "GitHub GraphQL did not return a complete authoritative repository setting." >&2
  exit 1
fi

if ! jq -e '.data.repository.deleteBranchOnMerge == true' <<<"$repository_graphql" >/dev/null; then
  echo "Automatic deletion of merged branches is disabled for ${GITHUB_REPOSITORY}; enable delete_branch_on_merge." >&2
  exit 1
fi

if ! jq -e '
  (.owner.type == "Organization")
  and (.visibility == "public")
' <<<"$repository" >/dev/null; then
  echo "Merge queue audit requires a public organization-owned repository." >&2
  exit 1
fi

rulesets="$(read_api_or_fixture rulesets "/repos/${GITHUB_REPOSITORY}/rulesets?includes_parents=true")"

mapfile -t ruleset_ids < <(
  jq -r \
    --arg name "$ruleset_name" \
    '.[] | select(.name == $name and .target == "branch") | .id' \
    <<<"$rulesets"
)

if ((${#ruleset_ids[@]} != 1)); then
  echo "Expected exactly one branch ruleset named ${ruleset_name}." >&2
  exit 1
fi

ruleset="$(read_api_or_fixture ruleset "/repos/${GITHUB_REPOSITORY}/rulesets/${ruleset_ids[0]}?includes_parents=true")"

if ! jq -e \
  --arg name "$ruleset_name" \
  --argjson contexts "$required_contexts_json" \
  '
    (.name == $name)
    and (.target == "branch")
    and (.enforcement == "active")
    and ((.conditions.ref_name.include // []) | index("~DEFAULT_BRANCH") != null)
    and ((.bypass_actors // []) | length == 0)
    and any(.rules[]?; .type == "pull_request")
    and any(.rules[]?;
      .type == "merge_queue"
      and (.parameters.merge_method | IN("MERGE", "SQUASH", "REBASE"))
      and (.parameters.min_entries_to_merge >= 1)
    )
    and any(.rules[]?;
      .type == "required_status_checks"
      and (.parameters.strict_required_status_checks_policy == true)
      and (.parameters.do_not_enforce_on_create == true)
      and (
        [.parameters.required_status_checks[]?.context] as $actual_contexts
        | all($contexts[];
            . as $context | $actual_contexts | index($context) != null
          )
      )
    )
  ' <<<"$ruleset" >/dev/null; then
  echo "Required GitHub default-branch CI ruleset is missing or invalid." >&2
  exit 1
fi

merge_group_runs="$(read_api_or_fixture merge-group-runs "/repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow_file}/runs?event=merge_group&status=success&per_page=20")"

if ! jq -e '
  any(.workflow_runs[]?;
    .event == "merge_group"
    and .status == "completed"
    and .conclusion == "success"
    and (.head_branch | startswith("gh-readonly-queue/"))
  )
' <<<"$merge_group_runs" >/dev/null; then
  echo "No successful Workflow syntax run on a merge-group ref was found." >&2
  exit 1
fi

latest_merge_group_url="$(
  jq -r '
    [.workflow_runs[]?
      | select(
          .event == "merge_group"
          and .status == "completed"
          and .conclusion == "success"
          and (.head_branch | startswith("gh-readonly-queue/"))
        )
    ]
    | sort_by(.created_at)
    | last
    | .html_url
  ' <<<"$merge_group_runs"
)"

echo "Automatic merged-branch deletion is enabled. GitHub merge queue is active, requires ${workflow_lint_context}, ${migration_contract_context}, and ${phase5_migration_context}, and has a successful merge-group run: ${latest_merge_group_url}"