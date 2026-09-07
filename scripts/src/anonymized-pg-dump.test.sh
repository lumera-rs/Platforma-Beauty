#!/usr/bin/env bash
set -Eeuo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/destructive-test-runtime.sh"
assert_destructive_test_runtime_allowed "Anonymized dump tests"

root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

cat >"$tmp/bin/psql" <<'MOCK'
#!/usr/bin/env bash
printf 'psql PGOPTIONS=%q args=' "${PGOPTIONS:-}" >>"$MOCK_LOG"
printf '%q ' "$@" >>"$MOCK_LOG"; printf '\n' >>"$MOCK_LOG"
case "$*" in
  *server_version_num*) echo '160000|source_db|10.0.0.1|5432' ;;
  *"current_database() ||"*) echo 'postgres|10.0.0.2|5432' ;;
  *"select current_database()"*) echo 'anon_test' ;;
  *"not convalidated"*) echo '0' ;;
esac
cat >/dev/null || true
MOCK
cat >"$tmp/bin/pg_dump" <<'MOCK'
#!/usr/bin/env bash
printf 'pg_dump PGOPTIONS=%q args=' "${PGOPTIONS:-}" >>"$MOCK_LOG"
printf '%q ' "$@" >>"$MOCK_LOG"; printf '\n' >>"$MOCK_LOG"
file=
for arg in "$@"; do [[ $arg == --file=* ]] && file=${arg#--file=}; done
if [[ " $* " == *" --schema-only "* ]]; then printf '%s\n' 'CREATE TABLE preserved();' >"$file"
else printf '%s\n' dump >"$file"; fi
MOCK
for command in pg_restore createdb dropdb; do
  cat >"$tmp/bin/$command" <<'MOCK'
#!/usr/bin/env bash
printf '%s args=' "$(basename "$0")" >>"$MOCK_LOG"
printf '%q ' "$@" >>"$MOCK_LOG"; printf '\n' >>"$MOCK_LOG"
MOCK
done
chmod +x "$tmp/bin/"*

export MOCK_LOG="$tmp/commands.log"
export PATH="$tmp/bin:$PATH"
export SOURCE_DATABASE_URL='postgres://source/source_db'
export TARGET_ADMIN_URL='postgres://disposable/postgres'
export TARGET_DATABASE_URL='postgres://disposable/anon_test'
export TARGET_DB_NAME='anon_test'
export ANONYMIZATION_SALT='deterministic-test-salt'
export ALLOW_ANONYMIZED_COPY=yes

bash "$root/scripts/anonymized-pg-dump.sh" "$tmp/result.dump"
[[ -s "$tmp/result.dump" ]]
grep -q 'pg_dump PGOPTIONS=.*default_transaction_read_only.*source/source_db' "$MOCK_LOG"
if grep 'psql .*source/source_db' "$MOCK_LOG" | grep -Eqi '(update|delete|insert|drop|truncate|alter|create)'; then
  echo "source received mutating SQL" >&2; exit 1
fi
grep -q 'createdb args=.*anon_test' "$MOCK_LOG"
grep -q 'dropdb args=.*anon_test' "$MOCK_LOG"

if TARGET_DB_NAME=production bash "$root/scripts/anonymized-pg-dump.sh" "$tmp/unsafe.dump" 2>/dev/null; then
  echo "unsafe target name was accepted" >&2; exit 1
fi
if ALLOW_ANONYMIZED_COPY=no bash "$root/scripts/anonymized-pg-dump.sh" "$tmp/unconfirmed.dump" 2>/dev/null; then
  echo "missing acknowledgement was accepted" >&2; exit 1
fi

echo "anonymized pg_dump guard tests passed"