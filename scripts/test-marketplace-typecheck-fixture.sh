#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/frontend-generated-typecheck.XXXXXX")"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

mkdir -p \
  "$FIXTURE_DIR/bin" \
  "$FIXTURE_DIR/artifacts/new-frontend" \
  "$FIXTURE_DIR/lib/declaration-only/dist"

cat > "$FIXTURE_DIR/lib/declaration-only/package.json" <<'JSON'
{
  "name": "@fixture/declaration-only",
  "version": "0.0.0",
  "types": "dist/index.d.ts"
}
JSON

cat > "$FIXTURE_DIR/lib/declaration-only/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "composite": true,
    "emitDeclarationOnly": true
  }
}
JSON

cat > "$FIXTURE_DIR/artifacts/new-frontend/package.json" <<'JSON'
{
  "name": "@fixture/new-frontend",
  "version": "0.0.0",
  "devDependencies": {
    "@fixture/declaration-only": "workspace:*"
  }
}
JSON

# This stale output proves the clean check removes declarations before running
# the consumer's typecheck. The fixture's fake package manager then simulates a
# consumer that incorrectly reports success without rebuilding them.
printf 'export declare const stale: true;\n' \
  > "$FIXTURE_DIR/lib/declaration-only/dist/index.d.ts"

cat > "$FIXTURE_DIR/bin/pnpm" <<'PNPM'
#!/usr/bin/env bash
set -euo pipefail

case "$*" in
  "--filter @fixture/new-frontend run typecheck")
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
chmod +x "$FIXTURE_DIR/bin/pnpm"

set +e
output="$(
  FRONTEND_TYPECHECK_ROOT_DIR="$FIXTURE_DIR" \
    FIXTURE_ROOT="$FIXTURE_DIR" \
    PATH="$FIXTURE_DIR/bin:$PATH" \
    bash "$ROOT_DIR/scripts/test-marketplace-typecheck.sh" 2>&1
)"
exit_code=$?
set -e

if (( exit_code == 0 )); then
  echo "Expected the clean generated-declaration check to fail." >&2
  printf '%s\n' "$output" >&2
  exit 1
fi

grep -qF "Running clean generated-declaration typecheck: @fixture/new-frontend" \
  <<< "$output" || {
  echo "Fixture frontend was not discovered by the generated-declaration check." >&2
  printf '%s\n' "$output" >&2
  exit 1
}

grep -qF "@fixture/new-frontend typecheck did not rebuild generated declarations" \
  <<< "$output" || {
  echo "Clean-output failure was not reported for the fixture frontend." >&2
  printf '%s\n' "$output" >&2
  exit 1
}

echo "Frontend generated-declaration discovery fixture caught the stale-output regression."