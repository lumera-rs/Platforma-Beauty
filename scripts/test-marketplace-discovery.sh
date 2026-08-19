#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:80/api}"
first_available="$(curl -fsS "${BASE_URL}/salons?sort=first-available")"
nearest="$(curl -fsS "${BASE_URL}/salons?sort=nearest&latitude=44&longitude=20")"

FIRST_AVAILABLE="$first_available" NEAREST="$nearest" node <<'NODE'
const firstAvailable = JSON.parse(process.env.FIRST_AVAILABLE);
const nearest = JSON.parse(process.env.NEAREST);
if (!Array.isArray(firstAvailable) || !firstAvailable.length) throw new Error("First-available query returned no salons.");
if (!firstAvailable.every((salon) => typeof salon.earliestSlot === "string")) throw new Error("Missing calculated earliestSlot.");
if (!Array.isArray(nearest) || !nearest.length) throw new Error("Nearest query returned no salons.");
if (!nearest.every((salon) => typeof salon.topSalon === "boolean" && typeof salon.instantBooking === "boolean")) throw new Error("Marketplace badges missing from nearest response.");
const haversine = (a, b) => {
  const rad = (value) => value * Math.PI / 180;
  const lat = rad(b.latitude - a.latitude);
  const lon = rad(b.longitude - a.longitude);
  const value = Math.sin(lat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(lon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};
const origin = { latitude: 44, longitude: 20 };
const distances = nearest.map((salon) => haversine(origin, salon));
if (!distances.every((distance, index) => index === 0 || distances[index - 1] <= distance)) throw new Error("Nearest results are not sorted by geographic distance.");
console.log("Marketplace discovery checks passed.");
NODE

if [[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]]; then
  cookie_file="$(mktemp)"
  trap 'rm -f "$cookie_file"' EXIT
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