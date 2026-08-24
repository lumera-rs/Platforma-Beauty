#!/usr/bin/env bash

resolve_api_base_url() {
  if [[ -n "${LUMERA_API_BASE_URL:-}" ]]; then
    BASE_URL="${LUMERA_API_BASE_URL%/}"
  elif [[ -n "${BASE_URL:-}" ]]; then
    BASE_URL="${BASE_URL%/}"
  elif [[ -n "${REPLIT_DEV_DOMAIN:-}" ]]; then
    BASE_URL="https://${REPLIT_DEV_DOMAIN}/api"
  else
    echo "Set LUMERA_API_BASE_URL, BASE_URL, or REPLIT_DEV_DOMAIN before running this test." >&2
    return 1
  fi
}

check_api_server() {
  local health_url="${BASE_URL%/}/healthz"
  local status

  if ! status="$(curl -sS -o /dev/null -w "%{http_code}" \
    --connect-timeout "${LUMERA_API_PREFLIGHT_CONNECT_TIMEOUT_SECONDS:-5}" \
    --max-time "${LUMERA_API_PREFLIGHT_TIMEOUT_SECONDS:-5}" \
    "$health_url" 2>/dev/null)"; then
    echo "The LUMERA API dev server is not responding at $health_url — start the API Server workflow before running this test" >&2
    exit 1
  fi

  if [[ "$status" != "200" ]]; then
    echo "The LUMERA API dev server is not responding at $health_url — start the API Server workflow before running this test" >&2
    exit 1
  fi
}
