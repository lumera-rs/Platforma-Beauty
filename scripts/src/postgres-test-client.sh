# Explicit CI PostgreSQL installation; never add server binaries to PATH.
# Retain normal command lookup only when no installation was declared.
psql() {
  if [[ -n "${LUMERA_POSTGRES_16_BIN:-}" ]]; then
    "${LUMERA_POSTGRES_16_BIN}/psql" "$@"
  else
    command psql "$@"
  fi
}