#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN with repository Administration read access is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be owner/repository}"

api_url="${GITHUB_API_URL:-https://api.github.com}"
ruleset_name="${GITHUB_RULESET_NAME:-Protect default branch CI}"
required_context="GitHub Actions syntax and expressions"

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
      .type == "required_status_checks"
      and (.parameters.strict_required_status_checks_policy == true)
      and (.parameters.do_not_enforce_on_create == true)
      and any(.parameters.required_status_checks[]?; .context == $context)
    )
  ' <<<"$ruleset" >/dev/null; then
  echo "Required GitHub default-branch CI ruleset is missing or invalid." >&2
  exit 1
fi

echo "GitHub default-branch CI ruleset is active and requires ${required_context}."