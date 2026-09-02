#!/usr/bin/env bash

set -euo pipefail

shopt -s nullglob
workflows=(.github/workflows/*.yml .github/workflows/*.yaml)

if ((${#workflows[@]} == 0)); then
  echo "No GitHub Actions workflow files found." >&2
  exit 1
fi

for workflow in "${workflows[@]}"; do
  pnpm exec github-actionlint "$workflow"
done