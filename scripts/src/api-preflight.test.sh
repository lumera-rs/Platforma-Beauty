#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PREFLIGHT_SCRIPT="$SCRIPT_DIR/api-preflight.sh"
FAKE_BIN="$(mktemp -d)"
BASE_URL="http://unreachable.test/api"

cleanup() {
  rm -rf "$FAKE_BIN"
}
trap cleanup EXIT

cat > "$FAKE_BIN/curl" <<'FAKE_CURL'
#!/usr/bin/env bash

if [[ "${FAKE_CURL_MODE:-}" == "unreachable" ]]; then
  exit 7
fi

printf '%s' "${FAKE_CURL_STATUS:-000}"
FAKE_CURL
chmod +x "$FAKE_BIN/curl"

run_preflight() {
  local mode="$1"
  local status_code="$2"
  local expected_exit="$3"
  local expected_output="$4"
  local output
  local actual_exit

  if output="$(
    PATH="$FAKE_BIN:$PATH" \
      BASE_URL="$BASE_URL" \
      FAKE_CURL_MODE="$mode" \
      FAKE_CURL_STATUS="$status_code" \
      bash -c 'source "$1"; check_api_server; printf "PREFLIGHT_CONTINUED\n"' _ "$PREFLIGHT_SCRIPT" 2>&1
  )"; then
    actual_exit=0
  else
    actual_exit=$?
  fi

  if [[ "$actual_exit" != "$expected_exit" ]]; then
    echo "FAIL: $mode expected exit $expected_exit, got $actual_exit" >&2
    echo "$output" >&2
    exit 1
  fi

  if [[ "$output" != "$expected_output" ]]; then
    echo "FAIL: $mode produced unexpected output" >&2
    printf 'Expected: %s\nActual: %s\n' "$expected_output" "$output" >&2
    exit 1
  fi

  echo "PASS: $mode"
}

failure_message="The LUMERA API dev server is not responding at ${BASE_URL}/healthz — start the API Server workflow before running this test"
run_preflight "unreachable" "" 1 "$failure_message"
run_preflight "http-5xx" "503" 1 "$failure_message"
run_preflight "http-200" "200" 0 "PREFLIGHT_CONTINUED"

echo "API preflight checks passed."