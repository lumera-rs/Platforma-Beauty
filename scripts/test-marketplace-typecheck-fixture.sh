#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/frontend-generated-typecheck.XXXXXX")"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

run_fixture() {
  local dependency_field="$1"
  local fixture_name="$2"
  local case_dir="$FIXTURE_DIR/$fixture_name"
  local package_name="@fixture/$fixture_name-frontend"

  mkdir -p \
    "$case_dir/bin" \
    "$case_dir/artifacts/new-frontend" \
    "$case_dir/lib/declaration-only/dist"

  cat > "$case_dir/lib/declaration-only/package.json" <<'JSON'
{
  "name": "@fixture/declaration-only",
  "version": "0.0.0",
  "types": "dist/index.d.ts"
}
JSON

  cat > "$case_dir/lib/declaration-only/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "composite": true,
    "emitDeclarationOnly": true
  }
}
JSON

  cat > "$case_dir/artifacts/new-frontend/package.json" <<JSON
{
  "name": "$package_name",
  "version": "0.0.0",
  "$dependency_field": {
    "@fixture/declaration-only": "workspace:*"
  }
}
JSON

  # This stale output proves the clean check removes declarations before running
  # the consumer's typecheck. The fixture's fake package manager then simulates a
  # consumer that incorrectly reports success without rebuilding them.
  printf 'export declare const stale: true;\n' \
    > "$case_dir/lib/declaration-only/dist/index.d.ts"

  cat > "$case_dir/bin/pnpm" <<'PNPM'
#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  "--filter ${FIXTURE_PACKAGE_NAME} run typecheck")
    if [[ -e "${FIXTURE_ROOT}/lib/declaration-only/dist/index.d.ts" ]]; then
      echo "fixture did not receive a clean declaration output" >&2
      exit 1
    fi
    echo "fixture consumer typecheck completed without rebuilding declarations"
    ;;
  "-w exec tsc --build --force lib/declaration-only")
    # The tested gate must still fail when restoration is unnecessary to the
    # fixture's assertion. The real workspace restoration remains untouched.
    ;;
  *)
    echo "unexpected fixture package-manager invocation: $*" >&2
    exit 1
    ;;
esac
PNPM
  chmod +x "$case_dir/bin/pnpm"

  local output
  local exit_code
  set +e
  output="$(
    FRONTEND_TYPECHECK_ROOT_DIR="$case_dir" \
      FIXTURE_ROOT="$case_dir" \
      FIXTURE_PACKAGE_NAME="$package_name" \
      PATH="$case_dir/bin:$PATH" \
      bash "$ROOT_DIR/scripts/test-marketplace-typecheck.sh" 2>&1
  )"
  exit_code=$?
  set -e

  if (( exit_code == 0 )); then
    echo "Expected the $dependency_field clean generated-declaration check to fail." >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi

  grep -qF "Running clean generated-declaration typecheck: $package_name" \
    <<< "$output" || {
    echo "Fixture frontend using $dependency_field was not discovered." >&2
    printf '%s\n' "$output" >&2
    exit 1
  }

  grep -qF "$package_name typecheck did not rebuild generated declarations" \
    <<< "$output" || {
    echo "Clean-output failure was not reported for the $dependency_field fixture frontend." >&2
    printf '%s\n' "$output" >&2
    exit 1
  }
}

run_fixture "devDependencies" "dev-dependency"
run_fixture "dependencies" "dependency"
run_fixture "peerDependencies" "peer-dependency"

echo "Frontend generated-declaration discovery fixtures covered dependencies, devDependencies, and peerDependencies."
