#!/usr/bin/env bash

assert_destructive_test_runtime_allowed() {
  local label="${1:-Destructive test}"
  if [[ "${NODE_ENV:-}" == "production" || "${REPLIT_DEPLOYMENT:-}" == "1" || "${REPL_DEPLOYMENT:-}" == "1" ]]; then
    echo "${label} refuses production or deployment runtimes." >&2
    return 1
  fi
}