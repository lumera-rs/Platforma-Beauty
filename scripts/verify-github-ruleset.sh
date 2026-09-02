#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN with repository Administration read access is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be owner/repository}"

api_url="${GITHUB_API_URL:-https://api.github.com}"
ruleset_name="${GITHUB_RULESET_NAME:-Protect default branch CI}"
required_context="GitHub Actions syntax and expressions"
workflow_file="workflow-lint.yml"

repository="$(
  curl --fail-with-body --silent --show-error \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer ${GITHUB_TOKEN}" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "${api_url}/repos/${GITHUB_REPOSITORY}"
)"

if ! jq -e '
  (.owner.type == "Organization")
  and (.visibility == "public")
' <<<"$repository" >/dev/null; then
  echo "Merge queue audit requires a public organization-owned repository." >&2
  exit 1
fi

rulesets="$(
  curl --fail-with-body --silent --show-error \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer ${GITHUB_TOKEN}" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "${api_url}/repos/${GITHUB_REPOSITORY}/rulesets?includes_parents=true"
)"

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

ruleset="$(
  curl --fail-with-body --silent --show-error \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer ${GITHUB_TOKEN}" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "${api_url}/repos/${GITHUB_REPOSITORY}/rulesets/${ruleset_ids[0]}?includes_parents=true"
)"

if ! jq -e \
  --arg name "$ruleset_name" \
  --arg context "$required_context" \
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
      and any(.parameters.required_status_checks[]?; .context == $context)
    )
  ' <<<"$ruleset" >/dev/null; then
  echo "Required GitHub default-branch CI ruleset is missing or invalid." >&2
  exit 1
fi

merge_group_runs="$(
  curl --fail-with-body --silent --show-error \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer ${GITHUB_TOKEN}" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "${api_url}/repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow_file}/runs?event=merge_group&status=success&per_page=20"
)"

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

echo "GitHub merge queue is active, requires ${required_context}, and has a successful merge-group run: ${latest_merge_group_url}"