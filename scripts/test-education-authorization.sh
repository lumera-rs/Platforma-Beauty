#!/bin/bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/src/api-preflight.sh"
resolve_api_base_url
check_api_server

DEMO_PASSWORD="${LUMERA_DEMO_PASSWORD:-LumeraDemo2026!}"
SALON_COOKIE="$(mktemp)"
CENTER_COOKIE="$(mktemp)"
EMPLOYEE_COOKIE="$(mktemp)"
BODY="$(mktemp)"

cleanup() {
  rm -f "$SALON_COOKIE" "$CENTER_COOKIE" "$EMPLOYEE_COOKIE" "$BODY"
}
trap cleanup EXIT

expect_status() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label expected $expected, got $actual: $(cat "$BODY")" >&2
    exit 1
  fi
  echo "PASS: $label -> $actual"
}

status="$(curl -sS -o "$BODY" -w "%{http_code}" -c "$SALON_COOKIE" -H "Content-Type: application/json" --data "{\"email\":\"salon@lumera.local\",\"password\":\"$DEMO_PASSWORD\"}" "$BASE_URL/auth/login")"
expect_status 200 "$status" "salon owner login"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -c "$CENTER_COOKIE" -H "Content-Type: application/json" --data "{\"email\":\"edukacija@lumera.local\",\"password\":\"$DEMO_PASSWORD\"}" "$BASE_URL/auth/login")"
expect_status 200 "$status" "education-center owner login"
node -e 'const body=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(body.user?.role!=="EDUKATIVNI_CENTAR") process.exit(1)' "$BODY"
echo "PASS: education demo login keeps canonical active role"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -c "$EMPLOYEE_COOKIE" -H "Content-Type: application/json" --data "{\"email\":\"zaposleni@lumera.local\",\"password\":\"$DEMO_PASSWORD\"}" "$BASE_URL/auth/login")"
expect_status 200 "$status" "enrolled salon employee login"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$CENTER_COOKIE" "$BASE_URL/education/courses?mine=true")"
expect_status 200 "$status" "publisher course list"
node -e 'const items=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!items.length || !items.every((course)=>course.centerId)) process.exit(1)' "$BODY"
echo "PASS: education demo remains linked to owned center courses"
EXTERNAL_COURSE_ID="$(node -e 'const items=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!items[0]) process.exit(1); process.stdout.write(items[0].id)' "$BODY")"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$SALON_COOKIE" "$BASE_URL/education/courses/$EXTERNAL_COURSE_ID")"
expect_status 200 "$status" "unenrolled course detail"
node -e 'const course=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(course.modules.flatMap((m)=>m.lessons).some((lesson)=>Object.hasOwn(lesson,"content"))) process.exit(1)' "$BODY"
echo "PASS: unenrolled course detail excludes lesson content"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$SALON_COOKIE" "$BASE_URL/education/courses/$EXTERNAL_COURSE_ID/modules")"
expect_status 200 "$status" "unenrolled module list"
node -e 'const modules=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(modules.flatMap((m)=>m.lessons).some((lesson)=>Object.hasOwn(lesson,"content"))) process.exit(1)' "$BODY"
echo "PASS: unenrolled module list excludes lesson content"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$SALON_COOKIE" "$BASE_URL/education/enrollments")"
expect_status 200 "$status" "owner enrollment list"
ENROLLMENT_ID="$(node -e 'const items=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!items[0]) process.exit(1); process.stdout.write(items[0].id)' "$BODY")"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$EMPLOYEE_COOKIE" "$BASE_URL/education/enrollments")"
expect_status 200 "$status" "employee assigned enrollment list"
EMPLOYEE_ENROLLMENT_ID="$(node -e 'const items=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!items[0]) process.exit(1); process.stdout.write(items[0].id)' "$BODY")"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$EMPLOYEE_COOKIE" "$BASE_URL/education/enrollments/$EMPLOYEE_ENROLLMENT_ID/lms")"
expect_status 200 "$status" "employee assigned LMS"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$SALON_COOKIE" "$BASE_URL/education/enrollments/$ENROLLMENT_ID/lms")"
expect_status 200 "$status" "authorized LMS"
LESSON_ID="$(node -e 'const lms=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const lesson=lms.course.modules.flatMap((m)=>m.lessons)[0]; if(!lesson || !Object.hasOwn(lesson,"content")) process.exit(1); process.stdout.write(lesson.id)' "$BODY")"
echo "PASS: authorized LMS includes lesson content"

status="$(curl -sS -o "$BODY" -w "%{http_code}" -b "$CENTER_COOKIE" -X POST "$BASE_URL/education/enrollments/$ENROLLMENT_ID/lessons/$LESSON_ID/complete")"
expect_status 403 "$status" "unenrolled publisher progress mutation blocked"

echo "Education authorization checks passed."