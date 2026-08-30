#!/usr/bin/env bash

require_isolated_admin_fixture_dependencies() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is required for the isolated administrator fixture." >&2
    return 1
  fi
  if ! command -v psql >/dev/null; then
    echo "psql is required for the isolated administrator fixture." >&2
    return 1
  fi
}

create_isolated_admin_fixture() {
  local run_id="$1"
  ISOLATED_ADMIN_EMAIL="authorization-regression-${run_id}@example.test"
  ISOLATED_ADMIN_ID="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt \
    -v email="$ISOLATED_ADMIN_EMAIL" <<'SQL'
INSERT INTO users (
  first_name, last_name, email, password_hash, password_set_at,
  role, active, marketing_emails_enabled
)
SELECT
  'Authorization', 'Regression', :'email', password_hash, now(),
  'ADMIN', true, false
FROM users
WHERE email = 'admin@lumera.local'
RETURNING id;
SQL
  )"
  if [[ -z "$ISOLATED_ADMIN_ID" ]]; then
    echo "FAIL: could not create isolated ADMIN fixture from the seeded administrator." >&2
    return 1
  fi
}

remove_isolated_admin_fixture() {
  [[ -n "${ISOLATED_ADMIN_EMAIL:-}" && -n "${ISOLATED_ADMIN_ID:-}" ]] || return 0
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -v email="$ISOLATED_ADMIN_EMAIL" -v user_id="$ISOLATED_ADMIN_ID" <<'SQL' >/dev/null
DELETE FROM users WHERE id = :'user_id'::uuid AND email = :'email';
SQL
}

verify_isolated_admin_fixture_removed() {
  [[ -n "${ISOLATED_ADMIN_EMAIL:-}" && -n "${ISOLATED_ADMIN_ID:-}" ]] || return 0
  [[ "$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt \
    -v email="$ISOLATED_ADMIN_EMAIL" -v user_id="$ISOLATED_ADMIN_ID" <<'SQL'
SELECT count(*) FROM users WHERE id = :'user_id'::uuid AND email = :'email';
SQL
  )" == "0" ]]
}

verify_education_demo_invariant() {
  [[ "$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt <<'SQL'
SELECT count(*) = 1
FROM users u
WHERE u.email = 'edukacija@lumera.local'
  AND u.role = 'EDUKATIVNI_CENTAR'
  AND u.active = true
  AND EXISTS (
    SELECT 1 FROM education_centers ec WHERE ec.owner_id = u.id
  );
SQL
  )" == "t" ]]
}