#!/usr/bin/env bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/src/api-preflight.sh"
resolve_api_base_url
check_api_server

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required so marketplace availability fixtures can be created and removed." >&2
  exit 1
fi
if ! command -v psql >/dev/null; then
  echo "psql is required so marketplace availability fixtures can be created and removed." >&2
  exit 1
fi

fixture_marker="marketplace-discovery-${$}-${RANDOM}"
cookie_file=""
cleanup() {
  local cleanup_failed=false
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v marker="$fixture_marker" >/dev/null <<'SQL' || cleanup_failed=true
delete from employees where name = :'marker';
delete from appointments
where service_id in (select id from services where description = :'marker');
delete from services where description = :'marker';
SQL
  if [[ -n "$cookie_file" ]]; then
    rm -f "$cookie_file"
  fi
  if [[ "$cleanup_failed" == true ]]; then
    echo "Failed to remove marketplace discovery fixtures." >&2
    return 1
  fi
}
trap cleanup EXIT

# The first-available assertion covers the complete first page, so every active
# salon needs an independently available service/employee pair. Employees with
# no location schedule are available by design; marker-owned rows avoid changing
# existing schedules and cascade their assignment/link rows during cleanup.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v marker="$fixture_marker" >/dev/null <<'SQL'
with fixture_services as (
  insert into services (
    salon_id, category_name, name, description, duration_minutes, price, image_url, active
  )
  select
    id, 'Regression', :'marker', :'marker', 30, 1, '/marketplace-discovery-fixture.jpg', true
  from salons
  where active = true
  returning id, salon_id
),
fixture_employees as (
  insert into employees (salon_id, name, role, bio, avatar_url, active)
  select id, :'marker', 'Regression', :'marker', '/marketplace-discovery-fixture.jpg', true
  from salons
  where active = true
  returning id, salon_id
),
fixture_assignments as (
  insert into employee_location_assignments (employee_id, salon_id, active, is_default)
  select id, salon_id, true, true
  from fixture_employees
)
insert into employee_services (employee_id, service_id)
select employee.id, service.id
from fixture_employees employee
inner join fixture_services service on service.salon_id = employee.salon_id;
SQL

first_available="$(curl -fsS "${BASE_URL}/salons?sort=first-available")"
nearest="$(curl -fsS "${BASE_URL}/salons?sort=nearest&latitude=44&longitude=20")"
nearest_coordinates="$(psql "$DATABASE_URL" -At -c "
  select coalesce(
    json_agg(json_build_object('id', id, 'latitude', latitude, 'longitude', longitude)),
    '[]'::json
  )::text
  from salons
  where active = true
")"

FIRST_AVAILABLE="$first_available" NEAREST="$nearest" NEAREST_COORDINATES="$nearest_coordinates" node <<'NODE'
const firstAvailable = JSON.parse(process.env.FIRST_AVAILABLE);
const nearest = JSON.parse(process.env.NEAREST);
const nearestCoordinates = JSON.parse(process.env.NEAREST_COORDINATES);
if (!Array.isArray(firstAvailable) || !firstAvailable.length) throw new Error("First-available query returned no salons.");
if (!firstAvailable.every((salon) => typeof salon.earliestSlot === "string")) throw new Error("Missing calculated earliestSlot.");
const expectedFirstAvailableIds = [...firstAvailable]
  .sort((left, right) => left.earliestSlot.localeCompare(right.earliestSlot) || left.id.localeCompare(right.id))
  .map((salon) => salon.id);
if (JSON.stringify(firstAvailable.map((salon) => salon.id)) !== JSON.stringify(expectedFirstAvailableIds)) {
  throw new Error("First-available results are not sorted by earliestSlot and salon ID.");
}
if (!Array.isArray(nearest) || !nearest.length) throw new Error("Nearest query returned no salons.");
if (!nearest.every((salon) => typeof salon.topSalon === "boolean" && typeof salon.instantBooking === "boolean")) throw new Error("Marketplace badges missing from nearest response.");
if (nearestCoordinates.length) {
  const origin = { latitude: 44, longitude: 20 };
  const haversine = (salon) => {
    if (!Number.isFinite(salon.latitude) || !Number.isFinite(salon.longitude)) return Infinity;
    const rad = (value) => value * Math.PI / 180;
    const latitude = rad(salon.latitude - origin.latitude);
    const longitude = rad(salon.longitude - origin.longitude);
    const value = Math.sin(latitude / 2) ** 2
      + Math.cos(rad(origin.latitude)) * Math.cos(rad(salon.latitude)) * Math.sin(longitude / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  };
  const expectedIds = nearestCoordinates
    .map((salon) => ({ id: salon.id, distance: haversine(salon) }))
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
    .slice(0, nearest.length)
    .map((salon) => salon.id);
  const actualIds = nearest.map((salon) => salon.id);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error("Nearest results are not sorted by geographic distance.");
  }
}
console.log("Marketplace discovery checks passed.");
NODE

if [[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]]; then
  cookie_file="$(mktemp)"
  curl -fsS -c "$cookie_file" -H 'content-type: application/json' -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" "${BASE_URL}/auth/login" >/dev/null
  admin_salons="$(curl -fsS -b "$cookie_file" "${BASE_URL}/admin/salons")"
  ADMIN_SALONS="$admin_salons" node -e 'const s=JSON.parse(process.env.ADMIN_SALONS)[0]; console.log(`${s.id} ${s.topSalon}`)' > /tmp/lumera-admin-salon
  read -r salon_id original_top_salon < /tmp/lumera-admin-salon
  if [[ "$original_top_salon" == "true" ]]; then toggled=false; else toggled=true; fi
  curl -fsS -b "$cookie_file" -X PATCH -H 'content-type: application/json' -d "{\"topSalon\":${toggled}}" "${BASE_URL}/admin/salons/${salon_id}" >/dev/null
  curl -fsS "${BASE_URL}/salons" >/dev/null
  persisted="$(curl -fsS -b "$cookie_file" "${BASE_URL}/admin/salons" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).find(x=>x.id==='${salon_id}').topSalon))")"
  [[ "$persisted" == "$toggled" ]] || { echo "Admin Top Salon update was overwritten by marketplace data." >&2; exit 1; }
  curl -fsS -b "$cookie_file" -X PATCH -H 'content-type: application/json' -d "{\"topSalon\":${original_top_salon}}" "${BASE_URL}/admin/salons/${salon_id}" >/dev/null
  echo "Admin Top Salon persistence check passed."
fi