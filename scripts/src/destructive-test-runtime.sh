#!/usr/bin/env bash

assert_destructive_test_runtime_allowed() {
  local label="${1:-Destructive test}"
  local scripts_directory
  scripts_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
  pnpm --dir "$scripts_directory" exec tsx \
    "$scripts_directory/src/assert-destructive-test-runtime.ts" \
    "$label"
}