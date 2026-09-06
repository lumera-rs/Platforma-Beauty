#!/bin/bash
# Task #10: runtime adversarial security suite.
#
# Runs inside run-isolated-browser-suite.ts's runIsolatedApiRegressionSuite
# harness (see scripts/src/run-runtime-security-suite.ts): a fresh
# disposable Postgres database is created and schema-pushed, and a real
# disposable API server process is started before this script runs.
# DATABASE_URL/NODE_ENV/LUMERA_API_BASE_URL are already set in the
# environment by that harness.
#
# This script runs a curated set of existing, focused regression tests
# (each already proving one or more invariants from the Task #10 security
# matrix) plus the three new tests written for this task, in one place,
# against the SAME fresh database. `set -e` means any single failure
# aborts the whole suite immediately with a non-zero exit code.
set -euo pipefail

cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

run_lib_test() {
  echo "=== $1 ==="
  NODE_ENV=test pnpm --filter @workspace/scripts exec tsx "$1"
}

run_lib_test_node_test() {
  echo "=== $1 (node:test) ==="
  NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test "$1"
}

# --- New tests written for Task #10 -----------------------------------
run_lib_test ../artifacts/api-server/src/lib/runtime-adversarial-authorization.test.ts
run_lib_test ../artifacts/api-server/src/lib/runtime-restart-durability.test.ts
run_lib_test ../artifacts/api-server/src/lib/runtime-error-disclosure.test.ts

# --- Reused existing tests, one per invariant already proven -----------
run_lib_test_node_test ../artifacts/api-server/src/lib/login-rate-limit.test.ts
run_lib_test_node_test ../artifacts/api-server/src/lib/change-password-session-revocation.test.ts
run_lib_test ../artifacts/api-server/src/lib/tenant-isolation.test.ts
run_lib_test ../artifacts/api-server/src/lib/employee-location-deactivation-scoping.test.ts
run_lib_test_node_test ../artifacts/api-server/src/lib/education-b2b-checkout-idempotency.test.ts
run_lib_test_node_test ../artifacts/beauty-marketplace/src/lib/idempotency-key-lifecycle.test.ts
run_lib_test ../artifacts/api-server/src/lib/education-course-featured-authorization.test.ts
run_lib_test ../artifacts/api-server/src/lib/education-featured-eligibility-consistency.test.ts
run_lib_test ../artifacts/api-server/src/lib/social-oauth-facebook-account-linking-safety.test.ts
run_lib_test ../artifacts/api-server/src/lib/internal-job-secret-timing-safety.test.ts
run_lib_test ../artifacts/api-server/src/lib/safe-external-url.test.ts
run_lib_test ../artifacts/api-server/src/lib/http-security-hardening.test.ts
run_lib_test ../artifacts/api-server/src/lib/business-role-transition.test.ts

echo "=== scripts/test-admin-authorization.sh ==="
bash scripts/test-admin-authorization.sh
echo "=== scripts/test-education-authorization.sh ==="
bash scripts/test-education-authorization.sh

echo ""
echo "Task #10 runtime security suite: ALL 19 CHECKS PASSED."
