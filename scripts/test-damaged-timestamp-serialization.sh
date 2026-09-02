#!/usr/bin/env bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/src/api-preflight.sh"
resolve_api_base_url
check_api_server

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required so damaged timestamp fixtures can be created and removed." >&2
  exit 1
fi
if ! command -v psql >/dev/null; then
  echo "psql is required so damaged timestamp fixtures can be created and removed." >&2
  exit 1
fi

fixture_marker="damaged-timestamp-${$}-${RANDOM}"
fixture_slug="${fixture_marker}-category"
body="$(mktemp)"
cookie="$(mktemp)"
demo_password="${LUMERA_DEMO_PASSWORD:-LumeraDemo2026!}"

cleanup() {
  local cleanup_failed=false
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v marker="$fixture_marker" -v slug="$fixture_slug" >/dev/null <<'SQL' || cleanup_failed=true
delete from beauty_job_application_actions
where listing_id in (select id from beauty_job_listings where description = :'marker');
delete from beauty_job_listings where description = :'marker';
delete from beauty_job_categories where slug = :'slug';
SQL
  rm -f "$body" "$cookie"
  if [[ "$cleanup_failed" == true ]]; then
    echo "Failed to remove damaged timestamp fixtures." >&2
    return 1
  fi
}
trap cleanup EXIT

read -r damaged_id valid_id damaged_slot_id valid_slot_id damaged_request_id valid_request_id applicant_listing_id damaged_contact_id valid_contact_id < <(
  psql "$DATABASE_URL" -AtF ' ' -v ON_ERROR_STOP=1 -v marker="$fixture_marker" -v slug="$fixture_slug" <<'SQL'
with fixture_user as (
  select id from users where email = 'admin@lumera.local'
),
fixture_category as (
  insert into beauty_job_categories (slug, name)
  values (:'slug', :'marker')
  returning id
),
fixture_listings as (
  insert into beauty_job_listings (
    category_id, salon_id, user_id, posted_by_type, type, intent, title, description,
    city, region, status, moderation_status, expires_at, created_at, updated_at
  )
  select category.id, null::uuid, fixture_user.id,
    'user'::beauty_job_posted_by_type,
    'equipment_rental'::beauty_job_listing_type,
    'offering'::beauty_job_listing_intent,
    :'marker' || '-damaged', :'marker', 'Beograd', 'Beograd',
    'active'::beauty_job_listing_status,
    'approved'::beauty_job_moderation_status,
    now() + interval '30 days', '-infinity'::timestamptz, now()
  from fixture_category category cross join fixture_user
  union all
  select category.id, null::uuid, fixture_user.id,
    'user'::beauty_job_posted_by_type,
    'job'::beauty_job_listing_type,
    'offering'::beauty_job_listing_intent,
    :'marker' || '-valid', :'marker', 'Novi Sad', 'Vojvodina',
    'active'::beauty_job_listing_status,
    'approved'::beauty_job_moderation_status,
    now() + interval '30 days', now(), now()
  from fixture_category category cross join fixture_user
  union all
  select category.id, owner.active_salon_id, null::uuid,
    'salon'::beauty_job_posted_by_type,
    'job'::beauty_job_listing_type,
    'offering'::beauty_job_listing_intent,
    :'marker' || '-applicants', :'marker', 'Niš', 'Južna Srbija',
    'active'::beauty_job_listing_status,
    'approved'::beauty_job_moderation_status,
    now() + interval '30 days', now(), now()
  from fixture_category category
  cross join lateral (
    select active_salon_id from users
    where email = 'salon@lumera.local' and active_salon_id is not null
  ) owner
  returning id, title
),
fixture_availability as (
  insert into beauty_job_listing_availability (listing_id, availability_pattern, day_labels)
  select id, 'Po dogovoru', '["Ponedeljak", "Utorak"]'::jsonb
  from fixture_listings
  where title = :'marker' || '-damaged'
),
fixture_slots as (
  insert into beauty_job_rental_slots (listing_id, starts_at, ends_at)
  select id, '-infinity'::timestamptz, now() + interval '2 days'
  from fixture_listings
  where title = :'marker' || '-damaged'
  union all
  select id, now() + interval '3 days', now() + interval '4 days'
  from fixture_listings
  where title = :'marker' || '-damaged'
  returning id, starts_at
),
fixture_requests as (
  insert into beauty_job_rental_requests (
    listing_id, slot_id, applicant_user_id, message, status, created_at, updated_at
  )
  select listing.id, slot.id, applicant.id, :'marker' || '-damaged-request',
    'pending'::beauty_job_rental_request_status, '-infinity'::timestamptz, now()
  from fixture_listings listing
  join fixture_slots slot on slot.starts_at = '-infinity'::timestamptz
  cross join lateral (select id from users where email = 'kupac@lumera.local') applicant
  where listing.title = :'marker' || '-damaged'
  union all
  select listing.id, slot.id, applicant.id, :'marker' || '-valid-request',
    'pending'::beauty_job_rental_request_status, now(), now()
  from fixture_listings listing
  join fixture_slots slot on slot.starts_at <> '-infinity'::timestamptz
  cross join lateral (select id from users where email = 'kupac@lumera.local') applicant
  where listing.title = :'marker' || '-damaged'
  returning id, message
),
fixture_contact as (
  insert into beauty_job_contacts (
    listing_id, applicant_user_id, applicant_message, applicant_status, author_status,
    author_reply, decision_at, replied_at, created_at, updated_at
  )
  select listing.id, applicant.id, :'marker' || '-damaged-application',
    'pending'::beauty_job_contact_status, 'replied'::beauty_job_contact_status,
    :'marker' || '-damaged-reply', now(), now(), '-infinity'::timestamptz, now()
  from fixture_listings listing
  cross join lateral (select id from users where email = 'kupac@lumera.local') applicant
  where listing.title = :'marker' || '-applicants'
  union all
  select listing.id, applicant.id, :'marker' || '-valid-application',
    'pending'::beauty_job_contact_status, 'replied'::beauty_job_contact_status,
    :'marker' || '-valid-reply', now(), now(), now(), now()
  from fixture_listings listing
  cross join lateral (select id from users where email = 'admin@lumera.local') applicant
  where listing.title = :'marker' || '-applicants'
  returning id, listing_id, applicant_message
),
fixture_actions as (
  insert into beauty_job_application_actions (
    contact_id, listing_id, from_status, to_status, private_note, actor_user_id, created_at
  )
  select contact.id, contact.listing_id,
    'pending'::beauty_job_contact_status, 'viewed'::beauty_job_contact_status,
    contact.applicant_message || '-damaged-action', owner.id, '-infinity'::timestamptz
  from fixture_contact contact
  cross join lateral (select id from users where email = 'salon@lumera.local') owner
  union all
  select contact.id, contact.listing_id,
    'viewed'::beauty_job_contact_status, 'replied'::beauty_job_contact_status,
    contact.applicant_message || '-valid-action', owner.id, now()
  from fixture_contact contact
  cross join lateral (select id from users where email = 'salon@lumera.local') owner
  returning id
)
select
  (select max(id::text) filter (where title = :'marker' || '-damaged') from fixture_listings),
  (select max(id::text) filter (where title = :'marker' || '-valid') from fixture_listings),
  (select max(id::text) filter (where starts_at = '-infinity'::timestamptz) from fixture_slots),
  (select max(id::text) filter (where starts_at <> '-infinity'::timestamptz) from fixture_slots),
  (select max(id::text) filter (where message = :'marker' || '-damaged-request') from fixture_requests),
  (select max(id::text) filter (where message = :'marker' || '-valid-request') from fixture_requests),
  (select max(id::text) filter (where title = :'marker' || '-applicants') from fixture_listings),
  (select max(id::text) filter (where applicant_message = :'marker' || '-damaged-application') from fixture_contact),
  (select max(id::text) filter (where applicant_message = :'marker' || '-valid-application') from fixture_contact);
SQL
)

if [[ -z "$damaged_id" || -z "$valid_id" || -z "$damaged_slot_id" || -z "$valid_slot_id" || -z "$damaged_request_id" || -z "$valid_request_id" || -z "$applicant_listing_id" || -z "$damaged_contact_id" || -z "$valid_contact_id" ]]; then
  echo "Failed to create damaged timestamp fixtures." >&2
  exit 1
fi

request_and_expect_200() {
  local endpoint="$1"
  local label="$2"
  local status
  status="$(curl -sS -o "$body" -w "%{http_code}" "$BASE_URL$endpoint")"
  if [[ "$status" != "200" ]]; then
    echo "FAIL: $label expected 200, got $status: $(cat "$body")" >&2
    exit 1
  fi
}

status="$(curl -sS -o "$body" -w "%{http_code}" -c "$cookie" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"kupac@lumera.local\",\"password\":\"$demo_password\"}" \
  "$BASE_URL/auth/login")"
if [[ "$status" != "200" ]]; then
  echo "FAIL: customer login expected 200, got $status: $(cat "$body")" >&2
  exit 1
fi

request_and_expect_200 "/beauty-jobs?category=$fixture_slug&sort=oldest" "beauty job list with damaged timestamp"
LIST_BODY="$(cat "$body")" DAMAGED_ID="$damaged_id" VALID_ID="$valid_id" node <<'NODE'
const response = JSON.parse(process.env.LIST_BODY);
if (!Array.isArray(response.items)) throw new Error("Beauty job list response has no items.");
const damaged = response.items.find((item) => item.id === process.env.DAMAGED_ID);
const valid = response.items.find((item) => item.id === process.env.VALID_ID);
if (!damaged || !valid) throw new Error("Beauty job list omitted a fixture row.");
if (damaged.createdAt !== null) throw new Error(`Damaged list timestamp was not null: ${damaged.createdAt}`);
if (damaged.city !== "Beograd" || valid.city !== "Novi Sad") throw new Error("Unrelated fixture fields were not preserved.");
if (typeof valid.createdAt !== "string") throw new Error("Valid neighboring list timestamp was not preserved.");
NODE

request_and_expect_200 "/beauty-jobs/$damaged_id" "beauty job detail with damaged timestamp"
DETAIL_BODY="$(cat "$body")" DETAIL_MARKER="$fixture_marker" DAMAGED_ID="$damaged_id" DAMAGED_SLOT_ID="$damaged_slot_id" VALID_SLOT_ID="$valid_slot_id" node <<'NODE'
const response = JSON.parse(process.env.DETAIL_BODY);
if (response.id !== process.env.DAMAGED_ID) throw new Error("Beauty job detail returned the wrong row.");
if (response.createdAt !== null) throw new Error(`Damaged detail timestamp was not null: ${response.createdAt}`);
if (response.city !== "Beograd" || response.description !== process.env.DETAIL_MARKER) {
  throw new Error("Unrelated beauty job detail fields were not preserved.");
}
const damagedSlot = response.availableSlots.find((slot) => slot.id === process.env.DAMAGED_SLOT_ID);
const validSlot = response.availableSlots.find((slot) => slot.id === process.env.VALID_SLOT_ID);
if (!damagedSlot || !validSlot) throw new Error("Beauty job detail omitted a nested slot fixture.");
if (damagedSlot.startsAt !== null) throw new Error(`Damaged nested detail timestamp was not null: ${damagedSlot.startsAt}`);
if (typeof damagedSlot.endsAt !== "string") throw new Error("Unrelated field on the damaged nested detail row was not preserved.");
if (typeof validSlot.startsAt !== "string" || typeof validSlot.endsAt !== "string") {
  throw new Error("Valid neighboring nested detail row was not preserved.");
}
NODE

status="$(curl -sS -o "$body" -w "%{http_code}" -b "$cookie" "$BASE_URL/beauty-jobs/rental-requests/mine")"
if [[ "$status" != "200" ]]; then
  echo "FAIL: authenticated rental-request history expected 200, got $status: $(cat "$body")" >&2
  exit 1
fi
REQUESTS_BODY="$(cat "$body")" DETAIL_MARKER="$fixture_marker" DAMAGED_REQUEST_ID="$damaged_request_id" VALID_REQUEST_ID="$valid_request_id" node <<'NODE'
const response = JSON.parse(process.env.REQUESTS_BODY);
if (!Array.isArray(response.requests)) throw new Error("Rental-request history response has no requests.");
const damaged = response.requests.find((request) => request.id === process.env.DAMAGED_REQUEST_ID);
const valid = response.requests.find((request) => request.id === process.env.VALID_REQUEST_ID);
if (!damaged || !valid) throw new Error("Rental-request history omitted a nested fixture row.");
if (damaged.createdAt !== null) throw new Error(`Damaged rental-request timestamp was not null: ${damaged.createdAt}`);
if (damaged.message !== `${process.env.DETAIL_MARKER}-damaged-request` || typeof damaged.updatedAt !== "string") {
  throw new Error("Unrelated fields on the damaged rental-request row were not preserved.");
}
if (valid.message !== `${process.env.DETAIL_MARKER}-valid-request` || typeof valid.createdAt !== "string" || typeof valid.updatedAt !== "string") {
  throw new Error("Valid neighboring rental-request row was not preserved.");
}
NODE

status="$(curl -sS -o "$body" -w "%{http_code}" -c "$cookie" \
  -H "Content-Type: application/json" \
  --data "{\"email\":\"salon@lumera.local\",\"password\":\"$demo_password\"}" \
  "$BASE_URL/auth/login")"
if [[ "$status" != "200" ]]; then
  echo "FAIL: salon login expected 200, got $status: $(cat "$body")" >&2
  exit 1
fi

status="$(curl -sS -o "$body" -w "%{http_code}" -b "$cookie" "$BASE_URL/beauty-jobs/$applicant_listing_id/applicants")"
if [[ "$status" != "200" ]]; then
  echo "FAIL: authenticated applicant history expected 200, got $status: $(cat "$body")" >&2
  exit 1
fi
APPLICANTS_BODY="$(cat "$body")" DETAIL_MARKER="$fixture_marker" DAMAGED_CONTACT_ID="$damaged_contact_id" VALID_CONTACT_ID="$valid_contact_id" node <<'NODE'
const response = JSON.parse(process.env.APPLICANTS_BODY);
if (!Array.isArray(response.applicants)) throw new Error("Applicant history response has no applicants.");
const damagedApplicant = response.applicants.find((item) => item.id === process.env.DAMAGED_CONTACT_ID);
const validApplicant = response.applicants.find((item) => item.id === process.env.VALID_CONTACT_ID);
if (!damagedApplicant || !validApplicant) throw new Error("Applicant history omitted a fixture applicant.");
if (damagedApplicant.createdAt !== null) {
  throw new Error(`Damaged top-level applicant timestamp was not null: ${damagedApplicant.createdAt}`);
}
if (damagedApplicant.applicantMessage !== `${process.env.DETAIL_MARKER}-damaged-application`
  || damagedApplicant.authorReply !== `${process.env.DETAIL_MARKER}-damaged-reply`
  || typeof damagedApplicant.applicantDisplayName !== "string"
  || typeof damagedApplicant.decisionAt !== "string"
  || typeof damagedApplicant.repliedAt !== "string"
  || typeof damagedApplicant.updatedAt !== "string") {
  throw new Error("Unrelated applicant fields were not preserved.");
}
if (validApplicant.applicantMessage !== `${process.env.DETAIL_MARKER}-valid-application`
  || validApplicant.authorReply !== `${process.env.DETAIL_MARKER}-valid-reply`
  || typeof validApplicant.applicantDisplayName !== "string"
  || typeof validApplicant.decisionAt !== "string"
  || typeof validApplicant.repliedAt !== "string"
  || typeof validApplicant.createdAt !== "string"
  || typeof validApplicant.updatedAt !== "string") {
  throw new Error("Valid neighboring applicant was not preserved.");
}
for (const [applicant, label] of [[damagedApplicant, "damaged"], [validApplicant, "valid"]]) {
  if (!Array.isArray(applicant.actions) || applicant.actions.length !== 2) {
    throw new Error(`${label} applicant action history was not preserved.`);
  }
  const damaged = applicant.actions.find((action) => action.privateNote === `${applicant.applicantMessage}-damaged-action`);
  const valid = applicant.actions.find((action) => action.privateNote === `${applicant.applicantMessage}-valid-action`);
  if (!damaged || !valid) throw new Error(`${label} applicant history omitted a neighboring action.`);
  if (damaged.createdAt !== null) throw new Error(`Damaged applicant action timestamp was not null: ${damaged.createdAt}`);
  if (damaged.privateNote !== `${applicant.applicantMessage}-damaged-action`
  || damaged.fromStatus !== "pending" || damaged.toStatus !== "viewed") {
    throw new Error(`Unrelated fields on the ${label} applicant's damaged action were not preserved.`);
  }
  if (valid.privateNote !== `${applicant.applicantMessage}-valid-action`
  || typeof valid.createdAt !== "string"
  || valid.fromStatus !== "viewed" || valid.toStatus !== "replied") {
    throw new Error(`Valid neighboring action for the ${label} applicant was not preserved.`);
  }
}
NODE

echo "Damaged timestamp HTTP serialization checks passed."
