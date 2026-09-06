# BOOKING FINAL v2 — Full Adversarial Audit, Integrity Test & Production Readiness Review

**Production behavior changed: NO.** This pass added one audit harness
(`artifacts/api-server/src/lib/booking-audit-v2.test.ts`) and this report. No production booking
code was modified. Every confirmed defect is filed as `BOOKING-Fn` for remediation in separate tasks.

The v1 audit and its remediation are recorded separately in `reports/booking-audit/final.md`. This
pass audits the result of that work, plus the subsystems v1 never reached.

---

## A. Booking executive decision

> ### BOOKING CONDITIONAL GO

The transactional core is sound and got measurably harder since v1. Package ledgers, multi-service
carts, cart idempotency, cross-customer isolation, slot granularity and both DST transitions all
survived direct attack, and every impossible-state query returns 0.

The condition is **BOOKING-F14**: availability is computed from scheduled times only, so a treatment
that starts late silently overruns into the next appointment. No database invariant is violated —
the clash exists on the salon floor, where nobody is warned. Section 71 requires an explicit
launch-impact decision on this, and section V gives one.

---

## B. Revision audited

| | |
|---|---|
| Branch | `claude/repo-architecture-analysis-wkrlf3` |
| HEAD | `06eb22fb14b1be0ab1b39a2b1f66b033f30f28bf` |
| Working tree | clean, no untracked files at freeze time |
| Ahead of `origin/main` | 2 commits (`2899903` audit v1, `06eb22f` v1 remediation) |
| Node | 22.22.2 |
| pnpm | 10.33.0 |
| PostgreSQL | 16.13 |
| Databases used | `lumera_audit2` (v2 harness), `lumera_audit` (v1 re-check), disposable load DBs |
| Production data touched | none |

This is deliberately **not** the same revision v1 audited (`beb783d`). The v1 findings were
remediated in `06eb22f`, so this pass re-audits the fixed system.

---

## C. Booking architecture

### Creation surfaces

| Surface | Route | Idempotency | Admission gate | Rate limit | `salons.active` |
|---|---|---|---|---|---|
| Customer, single | `POST /api/appointments` | receipts | yes (disabled by default) | **none** | **not checked** |
| Customer, cart | `POST /api/booking-groups` | receipts | yes (disabled by default) | **none** | required |
| Owner | `POST /api/salon/appointments` | receipts | — | **none** | **not checked** |
| Widget guest | `POST /api/widget/salons/:slug/appointments` | receipts | — | 5 / 60 s per IP+slug | required + `isVerified` |
| Widget cart | `POST /api/widget/salons/:slug/booking-groups` | receipts | — | 5 / 60 s per IP+slug | required + `isVerified` |

The inconsistency in the last two columns is **BOOKING-F15** and **BOOKING-F16**.

### The guarded path

`POST /api/appointments` runs in one transaction:

1. `executeBookingCommand` (`booking-command.ts`) takes an advisory lock on
   `(salonId, actorType, actorId, idempotencyKey)` and replays a stored receipt if one exists.
2. `lockAppointmentResources` / `lockAppointmentParticipants` (`appointment-locks.ts`) lock salon →
   salon-day → **employee (deliberately global, no `salonId` in the key)** → resource.
3. `canonicalAvailability` re-runs **inside** the transaction under those locks.
4. Since `06eb22f`: the customer's own diary is checked (no overlapping appointment anywhere).
5. Row insert, resource allocation, status-history row, receipt — all in the same transaction.

There is still **no database-level exclusion constraint** on `appointments`. Correctness rests
entirely on steps 2–4.

### Package entitlement (`package-entitlement.ts`)

`redeemPackageSessionInTx` takes `FOR UPDATE` on the purchase row, then on the appointment row,
validates salon/customer/status/expiry/remaining, checks the **immutable purchase snapshot**
(`package_purchase_service_links`) rather than the live package definition, guards both decrements
with `> 0` predicates, zeroes the appointment price, inserts the redemption, and completes the
purchase when it empties. `reversePackageRedemptionInTx` is the mirror image.

Two balances move together: the aggregate `customer_package_purchases.remaining_sessions` and, for
`quotaPolicy = "per_service"`, the snapshot `package_purchase_service_links.remaining_quota`.

### Lifecycle (`appointment-lifecycle.ts`)

Statuses: `pending`, `confirmed`, `completed`, `cancelled`, `no-show`, plus the sub-states
`arrivedAt` / `actualStartedAt`. Transitions are gated by `canTransitionAppointmentLifecycle`, and
`occurredAt` is clamped to ±5 minutes of server time by `isAllowedLifecycleOccurredAt` — so a late
start cannot be manufactured by backdating.

`start` additionally refuses when the remaining time to the planned end falls below
`minimumUsefulLateTreatmentMinutes` (`INSUFFICIENT_USEFUL_TIME`).

### Loyalty

`awardLoyaltyPointsInTx` is called from exactly two places — the B2C retail order path
(`marketplace.ts:14670`) and the B2B order path (`:17581`). **No appointment path calls it.**
Section 0.4 confirmed.

---

## D. Booking invariants

Invariants 1–15 were established in v1 and re-verified here through the v1 harness (section E).
Invariants 16–22 from this brief:

| # | Invariant | Status |
|---|---|---|
| 16 | Real occupancy must not silently diverge from scheduled occupancy on a late start | **VIOLATED — BOOKING-F14** |
| 17 | A package session is released only by an explicit, defined transition (`cancelled`, not `no-show`) | HOLDS — confirmed intentional |
| 18 | Purchase balance, per-service snapshot and appointment price move together atomically | HOLDS |
| 19 | Multi-employee appointments confirm all employees atomically | **N/A — the feature does not exist** |
| 20 | A multi-service cart commits all members or none | HOLDS |
| 21 | A deactivated salon cannot receive bookings through any surface | **VIOLATED — BOOKING-F15** |
| 22 | Featured/subscription expiry never affects booking admission | HOLDS — no booking path reads it |

---

## C-bis. Features the brief assumes that do not exist

Reported as absent with evidence rather than tested against an invented specification. Each was
confirmed by exhaustive grep across `artifacts/` and `lib/`.

| Brief section | Reality |
|---|---|
| §6, §7, §13 — pre/processing/post segments | **Absent.** No `preProcessingMinutes` / `processingMinutes` / `postProcessingMinutes` anywhere. `services.duration_minutes` is one scalar; the employee is blocked for the whole treatment. |
| §73 — multi-employee per appointment | **Absent.** No `requiredEmployeeCount`, no `appointmentTreatmentEmployees`. `appointment_treatments` carries a single nullable `employee_id` per ordered treatment row. Invariant 19 is not applicable. |
| §44 — seat capacity / group bookings | **Absent** from the appointment schema. Capacity exists only on `salon_resources.capacity`. |
| §77 — drag-and-drop calendar reschedule | **Absent.** The only `draggable` / `onDragEnd` in the frontend is `salon-gallery.tsx` (photo reordering). No calendar drag path exists, so there is no second reschedule path to audit. |
| §78 — add-on / extra services | **Absent.** No add-on concept; a cart is modelled as several `appointment_treatments` rows. |
| §82 — appointment waitlist, recurring appointments | **Absent.** Only `education_waitlist` and `product_waitlist` exist. Confirmed as stated in the brief. |
| §83 — deposit / payment capture at booking | **Absent** for salon booking. `depositAmount` exists only in education course validation. Package redemption (section Z) is the only payment-like step in the booking transaction. |

---

## E. Existing test inventory

Unchanged from v1's section S, plus the two suites wired into release phase 4 by `06eb22f`
(`test:final-booking-qa`, `test:booking-journey-browser`).

`calendar-timezone-boundaries.test.ts` (12 assertions) covers impossible ISO dates, leap day,
midnight and year rollover, and salon-wall-clock-vs-UTC cutoffs. It does **not** cover the DST
transitions themselves — that gap is closed by probe V13 below rather than duplicated.

**v1 harness re-run on this revision: `findings: 0`.** All 22 v1 probes still clean, so the v1
remediation holds and this pass did not regress it.

---

## F. New tests added

`artifacts/api-server/src/lib/booking-audit-v2.test.ts` — 13 probes, exit 0 by design.
Not wired into any release phase.

| Probe | Targets |
|---|---|
| V1 | §0.1 / §71 late-arrival occupancy drift |
| V2 | §0.2 / §72 no-show → package + loyalty matrix |
| V3 | §0.3 / §76 `salons.active` gating across all four surfaces |
| V4 | §75 last package session under 10-way contention |
| V5 | §75 concurrent reversal idempotency |
| V6 | §75 expiry boundary |
| V7 | §35 cross-customer package redemption |
| V8 | §74 cart atomicity with a failing last member |
| V9 | §74 cart idempotency after a lost response |
| V10 | §79 slot granularity / off-grid start time |
| V11 | §80 rate limiting on authenticated surfaces |
| V12 | §81 cascading deactivation (**not exercised** — see AC) |
| V13 | §41 both Belgrade DST transitions |
| Z | §63 package and booking-group integrity scan |

---

## G. Functional matrix

| Scenario | Expected | Actual | Result |
|---|---|---|---|
| Late start, next scheduled slot | refused or flagged | `201`, booked | **FAIL — F14** |
| No-show with an active package | session stays consumed, price stays 0 | exactly that | PASS |
| Deactivated salon, customer surface | refused | `201`, booked | **FAIL — F15** |
| Deactivated salon, cart surface | refused | `404` | PASS |
| Deactivated salon, owner surface | refused (or documented exemption) | `201`, booked | **FAIL — F15** |
| Deactivated salon, widget surface | refused | `400` | PASS |
| 10 concurrent redemptions, 1 session | exactly 1 succeeds | 1 succeeded | PASS |
| 3 concurrent reversals of 1 redemption | exactly 1 restores | 1 succeeded | PASS |
| Expired purchase redeemed | rejected, ledger untouched | `expired`, untouched | PASS |
| Customer B redeems customer A's package | rejected | `wrong_customer` | PASS |
| 3-treatment cart, 3rd slot occupied | all or nothing | `409`, 0 rows | PASS |
| Cart retried with same key | original group replayed | same group, 2 rows, `replayed=true` | PASS |
| Start time `10:07` off a 15-min grid | refused | `409` | PASS |
| 20 rapid bookings, one authenticated actor | some throttling | 0 throttled | **FAIL — F16** |
| Both Belgrade DST transitions | valid wall clocks round-trip | all round-trip | PASS |

---

## H. Segmented-treatment results

Not applicable — the feature does not exist (section C-bis). The nearest real structure is the
ordered `appointment_treatments` cart, audited in sections Y and G.

---

## I. Employee/resource scheduling results

Multi-employee-per-appointment (§73) does not exist, so invariant 19 cannot be violated. Single
employee selection, cross-location employee occupancy and resource capacity were audited in v1 and
re-verified clean by the v1 harness on this revision.

The one scheduling defect found in this pass is F14, which is not a selection or locking failure —
the locks are correct for the times the system believes in. It is that the times it believes in stop
matching reality the moment a treatment starts late.

---

## J. Availability consistency

v1 probes D1–D3 (advertised first-available bookable, every offered slot bookable, previewed
employee is the booked employee) are clean on this revision.

The remaining inconsistency is temporal rather than logical: availability is a projection of
scheduled times, and section V explains where that projection stops matching the room.

---

## K. Concurrency / race results

| Test | Requests | Outcome |
|---|---|---|
| Last package session | 10 concurrent redemptions | 1 succeeded, 9 rejected; `remainingSessions` 1 → 0; 1 redemption row; 1 zero-priced appointment |
| Redemption reversal | 3 concurrent reversals | 1 succeeded; balance restored to 3/3; per-service quota 3/3; price restored to 3000 |
| Same-slot booking (load harness) | 200 across 2 processes | `{201: 1, 409: 199}` |

The package ledger's `FOR UPDATE` sequence holds under real contention, not just by inspection.

---

## L. Multi-process results

The package and cart probes run in one process against a real database, so their concurrency is
transactional rather than cross-process. **Genuinely independent processes** were used only by
`scripts/src/run-booking-load.ts`, whose four scenarios were re-run on this revision (section T).

That is a deliberate boundary and stated as such: the package contention above is serialized by
PostgreSQL row locks, which behave identically whether the callers share a process or not; the
same-slot booking race is the one where process independence actually changes what is tested, and
that one uses the multi-process harness.

---

## M. Reschedule / cancellation results

Re-verified clean by the v1 harness. Drag-and-drop parity (§77) is not applicable — no such feature
exists (section C-bis).

---

## N. Idempotency / restart results

Cart idempotency (§74): a retried `POST /api/booking-groups` with the same key returned the original
group id with `Idempotency-Replayed: true`, and the database held 2 appointments under 1 booking
group — no duplicate, no partial.

Receipt scope is `(salonId, actorType, actorId, idempotencyKey)`. v1 probes A6/A7 confirmed a
changed payload gives `409 IDEMPOTENCY_KEY_REUSED` and that the same raw key from two customers does
not collide.

Process-restart replay (§26) was **not** tested in either pass — coverage gap AC.

---

## O. Transaction rollback results

Cart atomicity was proven by contention rather than injection: a 3-treatment cart whose third member
hit an occupied slot returned `409` and left **0** rows. Combined with the Z scan finding no booking
group without appointments and no redemption without an appointment, the all-or-nothing property
holds on the paths tested.

Deliberate failure injection at each commit point (§31) was **not** performed — coverage gap AC,
carried over from v1.

---

## P. Snapshot / configuration-change results

v1 probe C7 (service duration and price changed to 180 min / 99000 after booking; the booked row
kept 60 min / 3000) is clean on this revision.

The package snapshot is stronger than the service snapshot: `redeemPackageSessionInTx` validates
against `package_purchase_service_links`, populated at purchase time and immutable, so editing the
package definition afterwards cannot broaden or narrow what an existing purchase covers.

---

## Q. Timezone / DST findings

The model is wall-clock `date` + `start_time`/`end_time` as TEXT, with lifecycle instants as
`timestamptz`, and a single global `DEFAULT_SALON_TIME_ZONE = "Europe/Belgrade"`. There is **no
per-salon timezone column**, so a salon outside that zone cannot be represented.

Probe V13 drove `zonedAppointmentInstant` through both 2026 transitions:

| Wall clock | Instant | Round-trip |
|---|---|---|
| 2026-03-29 01:30 | `00:30Z` | 01:30 ✓ |
| 2026-03-29 02:30 (does not exist) | `01:30Z` | 03:30 — shifted forward |
| 2026-03-29 03:30 | `01:30Z` | 03:30 ✓ |
| 2026-10-25 01:30 | `2026-10-24 23:30Z` | 01:30 ✓ |
| 2026-10-25 02:30 (happens twice) | `01:30Z` | 02:30 ✓ — first occurrence |
| 2026-10-25 03:30 | `02:30Z` | 03:30 ✓ |

Every valid wall-clock time round-trips exactly. The nonexistent hour resolves forward, and the
repeated hour resolves to its first occurrence. The iterative DST-correction loop converges at both
transitions. **No finding.**

---

## R. Browser / UI booking results

Not re-run in this pass. The 19 `booking-journey.spec.ts` specs were run 19/19 green during the v1
remediation on this exact revision and are now wired into release phase 4. Browser coverage of the
v2 subsystems — package redemption in the UI, cart checkout, late-arrival warnings — is a coverage
gap (AC).

---

## S. Notifications / outbox results

Not re-tested in this pass beyond v1's finding that reschedule notifications now fire on every move
and enqueue inside the transaction. Two-worker `FOR UPDATE SKIP LOCKED` behaviour and provider
outage (§48, §49) remain untested — coverage gap AC, carried over from v1.

---

## T. Performance

The brief's §62 asks whether booking-critical code changed since the 1,000-concurrent benchmark. It
did — `06eb22f` touched `appointment-locks` usage, `availability-engine`, and the booking
transaction — so the benchmark was re-run on this revision rather than reused.

| Scenario | Statuses | p50 | p95 | p99 | req/s | Objective |
|---|---|---|---|---|---|---|
| same-slot | `{201: 1, 409: 199}` | — | 3270 ms | — | — | PASS |
| 1000-distinct | `{201: 1000}` | — | 7231 ms | — | — | PASS |
| 250-groups | `{201: 125, 409: 125}` | — | 2863 ms | — | — | PASS |
| mixed-1000 | `{200: 500, 201: 255, 409: 245}` | — | 6560 ms | — | — | PASS |

Integrity counters: `sameSlotActive: 1`, `activeOverlaps: 0`, `crossCustomerRows: 0`,
`partialGroups: 0`. Full data in `reports/booking-load/audit-postfix.json`.

p95 is 25–40% higher than the pre-remediation run, the cost of the customer-occupancy check and the
status-history row added by `06eb22f`. Every objective still passes with room. These numbers measure
this sandbox, not a production runner.

---

## U. Final DB integrity scan

Every query answers "how many rows are in a state the rules should make impossible".

| Impossible state | Count |
|---|---|
| Redemption without an appointment | **0** |
| `remainingSessions` disagrees with active redemptions | **0** |
| Negative remaining sessions or per-service quota | **0** |
| Per-service quota disagrees with its redemptions | **0** |
| Redemption crossing tenants | **0** |
| Zero-priced API-created appointment with no redemption | **0** |
| Booking group with no appointments | **0** |

Plus the v1 scan on this revision, also all **0**: `end_time <= start_time`, duration disagreeing
with the booked window, negative price/travel fee, service belonging to another salon, employee not
assigned to the location, orphan resource allocation, duplicate receipt per scope, and the
whole-database employee-overlap pair scan.

---

## V. Late-arrival / occupancy-drift findings — §71

**BOOKING-F14 — HIGH — confirmed.**

`grep` over `availability-engine.ts` and `availability-store.ts` returns **no occurrence** of
`actualStartedAt`. Availability is a pure function of `date` / `start_time` / `end_time`.

**Reproduction** (probe V1, real clock, real routes):

1. An appointment for employee A is scheduled `now-30min` for 60 minutes — scheduled window
   `[now-30, now+30)`.
2. `POST /api/appointments/:id/lifecycle` `arrive`, then `start`, both at server time. The row now
   carries `actualStartedAt ≈ now`, i.e. 30 minutes late. The treatment really runs to about
   `now+60`.
3. `POST /api/appointments` for the same employee at `now+30` — the first slot the schedule says is
   free.

**Result:** HTTP **201**. The appointment is created and persisted. Employee A is now booked for a
customer at `now+30` while still working on the previous one until `now+60`.

**Database state:** no invariant is violated. The employee-overlap scan returns 0, because by
scheduled time the two do not overlap. That is precisely what makes it dangerous: nothing in the
data says anything is wrong.

**Root cause:** the scheduling model has one notion of time (scheduled) and the lifecycle has
another (`arrivedAt` / `actualStartedAt`), and the two never meet. `start` does consult
`minimumUsefulLateTreatmentMinutes` to refuse a start too close to the planned end, which bounds how
late a treatment may *begin* — but once started, nothing recomputes what that means for the rest of
the day.

**UI warning:** none found. No owner-calendar or employee-view surface reads `actualStartedAt` to
flag an overrun.

**Realistic impact:** high frequency, low blast radius per occurrence. A busy salon has late clients
daily; the result is a customer waiting past their appointment time, not corrupted data.

### Explicit launch-impact decision — required by §69 and §71

**Accepted for launch, with a mandatory operational mitigation. Not a launch blocker.**

Reasoning, stated so it is not silently dropped:

- It cannot corrupt data, cross tenants, or duplicate a financial mutation. Every database invariant
  holds.
- It is the software behaving exactly as a paper appointment book does. Salons already manage
  overruns by hand, and staff can see the clock.
- A real fix means introducing a second, actual-time occupancy model that competes with the
  scheduled one — a scheduling-engine change, not a patch, and not something to rush before launch.

The mitigation this decision **requires**, and which should not be deferred with the fix:

1. Surface `actualStartedAt` on the owner calendar and employee view, with a visible marker when a
   started treatment's projected end passes the next appointment's start. The data is already on the
   row; this is a display change.
2. Say so in salon onboarding: the calendar shows planned times, and a late start is the salon's to
   manage.

If either mitigation is dropped, this finding should be re-escalated to a launch blocker, because
the only thing keeping it acceptable is that a human is watching.

---

## W. No-show / package / loyalty interaction — §72

**Confirmed intentional. No finding.**

`no-show` sets `status`, `noShowAt`, `noShowByUserId`, writes a status-history row, and records an
invalid referral transition. It **never** calls `handleAppointmentCancellationReversalsInTx`, whose
only two call sites are `cancelAppointmentInTx` (`marketplace.ts:8600`) and the owner status
transition into `cancelled` (`:10310`).

Probe V2, with a live package redemption on the appointment:

| After `no-show` | Observed |
|---|---|
| Appointment status | `no-show` |
| Appointment price | `0` — stays zeroed |
| `remainingSessions` | 2 → 1 — stays consumed |
| Redemption status | `redeemed` — not reversed |
| Loyalty points | none awarded |

This matches real salon policy: a no-show burns the session. **Documented here so it is not later
"fixed" incorrectly.**

A no-show is only reachable while `!arrivedAt && !actualStartedAt`, so a client who arrived cannot
be marked absent — a sensible guard worth recording.

Manual reversal through the growth endpoint (with `reversedByUserId` audit) remains available and is
the intended escape hatch when a salon chooses to be generous. Probe V5 proves that reversal path is
concurrency-safe.

**Loyalty (§0.4): confirmed informational.** `awardLoyaltyPointsInTx` has exactly two call sites,
both order paths, neither reachable from any appointment transition. If loyalty is ever wired into
booking payment, it must get the same `FOR UPDATE` treatment the package ledger has — flagged here
as required future work, not a current defect.

---

## X. Multi-employee atomicity — §73

**Not applicable.** `requiredEmployeeCount` and `appointmentTreatmentEmployees` do not exist
anywhere in the codebase. `appointment_treatments` carries one nullable `employee_id` per ordered
treatment row — a cart of consecutive treatments, not a crew on one treatment.

Invariant 19 cannot be violated by code that does not exist. If the feature is built, it needs its
own audit pass: the partial-assignment scenario the brief describes is exactly the shape that would
require locking every participant, and `lockAppointmentResources` currently locks only the
employees it is handed.

---

## Y. Cart / booking-group atomicity — §74

**No finding.** Both properties confirmed with database evidence:

- **All-or-nothing.** A 3-treatment cart whose third member contended an occupied slot returned
  `409` and left **0** rows for that customer on that date. The first two were not committed.
- **Idempotent.** The same cart replayed with the same key returned the original group id with
  `Idempotency-Replayed: true`; the database held 2 appointments under exactly **1** booking group.

The Z scan found **0** booking groups with no appointments across the whole database.

Owner, employee and widget grouped variants were not separately exercised — coverage gap AC.

---

## Z. Package / loyalty ledger integrity — §75

**No finding. This is the strongest subsystem in the audit.**

| Test | Result |
|---|---|
| 10 concurrent redemptions, `remainingSessions = 1` | exactly **1** succeeded; balance 1 → 0; purchase auto-completed; 1 redemption row; 1 zero-priced appointment |
| 3 concurrent reversals of one redemption | exactly **1** restored; aggregate back to 3/3; per-service quota back to 3/3; price restored to 3000 |
| Purchase expired at attempt time | rejected `expired`; ledger untouched |
| Customer B redeeming customer A's purchase | rejected `wrong_customer`; balance and price untouched |

The `per_service` and `shared_pool` policies were exercised separately (V5 uses `per_service`, V4
`shared_pool`), and the aggregate and snapshot balances never diverged.

The design deserves the credit: the purchase row is locked `FOR UPDATE` first, both decrements carry
`> 0` guards so an out-of-band writer fails closed, the service snapshot is immutable, and the
lifecycle guard refuses to burn a session against a cancelled or completed appointment.

---

## AA. Salon gating consistency — §76

**BOOKING-F15 — MEDIUM — confirmed, and it is the opposite of what section 0.3 predicted.**

Section 0.3 suspected the owner-side path. It is right about that but incomplete: the **customer**
single-appointment endpoint — the primary booking surface — does not check `salons.active` either.

Probe V3, against a salon with `active = false`:

| Surface | Result |
|---|---|
| `POST /api/appointments` (customer) | **201 — booked** |
| `POST /api/booking-groups` (customer cart) | 404 — refused |
| `POST /api/salon/appointments` (owner) | **201 — booked** |
| `POST /api/widget/.../appointments` (widget) | 400 — refused |

Two appointments persisted at a deactivated salon.

**Root cause:** `POST /api/appointments` resolves the salon by joining `services → salons` with no
`active` predicate (`marketplace.ts:8307`), and `ownedSalon()` selects by `ownerId + activeSalonId`
with no `active` filter (`marketplace.ts:1422`). Only `POST /api/booking-groups`
(`marketplace.ts:7846`) and `widgetSalon()` (`widget.ts:152`, which also requires `isVerified`)
apply it.

**Impact:** a salon removed from the marketplace still takes bookings through its direct link and
through its own portal. Customers book somewhere that is not open for business.

**Recommended fix:** decide the rule once and apply it in one place. The owner surface plausibly
*should* stay open so an owner can wind down existing operations — but that must be a documented
exemption, not four routes disagreeing. The customer surface should match the cart surface.

**Featured / subscription expiry (invariant 22):** no booking-creation path reads featured or
subscription state. Confirmed by inspection across all five surfaces. **Holds.**

---

## AB. New findings

Numbering continues the v1 namespace (`BOOKING-F1` … `F13`) so the project has one series.

### BOOKING-F14 — HIGH — Late start silently double-books the floor

Section V has the full reproduction, root cause, database state, impact and the explicit
launch-impact decision. **Launch blocker: NO**, conditional on the two mitigations in section V.

**Recommended fix:** project occupancy from `actualStartedAt` when it is set, and surface the
overrun. The minimum viable version is display-only and needs no engine change.

### BOOKING-F15 — MEDIUM — Deactivated salon accepts bookings on two of four surfaces

Section AA has the full detail. **Launch blocker: NO** — but it should be fixed before any salon is
actually deactivated in anger, because today deactivation does not do what its name says.

**Recommended fix:** add the `active` predicate to the customer single-appointment salon lookup;
decide and document whether the owner surface is a deliberate wind-down exemption.

### BOOKING-F16 — RELIABILITY — Only the widget surface is rate limited

20 consecutive `POST /api/appointments` from one authenticated customer produced **no** 429. One was
created, the rest were legitimate `409` slot conflicts — correctness held throughout; only volume is
unbounded.

`widget.ts` limits bookings to 5 per 60 s per IP+slug (`:77`, `:238`). The customer, owner and
employee surfaces rely on `admitBookingRequest`, whose limit comes from
`BOOKING_MAX_IN_FLIGHT_PER_PROCESS` and **defaults to `"0"` — a passthrough**
(`booking-admission.ts:3`, `:18`).

**Impact:** an authenticated actor can hammer booking endpoints. Idempotency prevents duplicates and
the transaction prevents corruption, so this is load, not corruption. A slot-holding attack is
weak here because there is no hold-then-pay step — a booking either commits or does not.

**Launch blocker: NO.** **Recommended fix:** set a non-zero
`BOOKING_MAX_IN_FLIGHT_PER_PROCESS` in the deployment environment, and add a per-actor booking rate
limit mirroring the widget's.

### Pre-seeded candidates resolved

| Candidate | Verdict |
|---|---|
| 0.1 late-arrival drift | **Confirmed — BOOKING-F14 (HIGH)** |
| 0.2 no-show does not reverse package | **Confirmed intentional. Not a defect.** Documented in section W |
| 0.3 owner routes miss `salons.active` | **Confirmed and widened — BOOKING-F15 (MEDIUM).** The customer surface has the same gap |
| 0.4 loyalty does not touch booking | **Confirmed informational.** Two call sites, both order paths |

---

## AC. Coverage gaps

Stated as gaps, not passes. Nothing here was tested and cleared.

1. **Transaction failure injection (§31, §32).** The `test-server.ts` IPC hooks were not exercised
   in either pass. Cart atomicity was proven by contention instead, which is weaker.
2. **Process-restart idempotency (§26, §50).** Lost-response retry against a *newly started* process
   was not tested. In-process replay was.
3. **Two-worker outbox (§48) and provider outage (§49).** Untested.
4. **§81 cascading deactivation — not exercised.** Probe V12 could not deactivate a salon:
   `PATCH /api/salon/profile {active:false}` returned 400, and no owner-facing route that
   deactivates a salon was found. Customer-account and employee deactivation with live appointments
   and live package purchases were not tested at all. This is the largest untested area in this pass.
5. **Owner, employee and widget grouped-booking variants (§73, §74).** Only the customer cart path
   was exercised.
6. **Browser coverage of v2 subsystems (§52–59).** No UI test drives package redemption, cart
   checkout, or a late-arrival warning.
7. **Property/fuzz testing (§64) and mutation testing (§65).** Not performed in either pass.
8. **Multi-process concurrency for the package ledger (§27).** Row-lock contention was exercised in
   one process; only the booking race used independent processes.
9. **§79 partial.** Off-grid start times are refused, but whether an attacker can *displace* the
   advertised grid was not separately tested.

Sections marked not-applicable in C-bis (§6, §7, §44, §73, §77, §78, §82, §83) are absences of
features, not gaps in testing.

---

## AD. Production changes

**Production behavior changed: NO.**

This task added `artifacts/api-server/src/lib/booking-audit-v2.test.ts` and this report. `git status`
shows no modification to any production source file. The harness is not wired into any
`validate:release` phase.

---

## AE. Final booking sign-off

**Would I personally approve this exact booking implementation for real paying salons and customers
today?**

**Yes — with BOOKING-F14's display mitigation shipped alongside, and BOOKING-F15 fixed.**

I went in expecting the package ledger to be where this broke. It is the opposite: `FOR UPDATE` on
the purchase, guarded decrements that fail closed, an immutable purchase snapshot, and a lifecycle
guard that refuses to burn a session against a settled appointment. Ten concurrent redemptions of
one remaining session produced exactly one. Three concurrent reversals restored exactly one. That is
someone having thought about it properly, and it held everything I threw at it.

The cart is the same story — all-or-nothing under contention, idempotent on replay, zero orphan
groups in the whole database. DST, which I expected to be soft, round-trips cleanly at both
transitions. Every impossible-state query returns 0.

What I would not ship silently is **F14**. It is not a bug in the sense the other findings are — no
data is wrong, no lock is missing, and the code does exactly what it was designed to do. The problem
is that what it was designed to do stops describing the salon the moment a client walks in twenty
minutes late, which in a busy salon is most days. The system knows the treatment started late — it
writes `actualStartedAt` — and then never uses it again. Shipping that without at least showing it
on the calendar means the software is quietly confident about something it has no basis for. The
data is already on the row; putting it on screen is a small piece of work and I would not launch
without it.

**F15** I would fix this week. "Deactivated" that still takes bookings through the main endpoint is
a word that does not mean what it says, and someone will find that out the hard way.

**F16** is a deployment setting and a follow-up ticket.

One thing on the record: this pass did **not** test failure injection, process-restart replay,
outbox workers, or cascading deactivation — and cascading deactivation I actively tried and could
not reach. The system held everything I did test, but I have not earned the right to say those areas
are fine, and section AC says so plainly rather than letting a green report imply it.

---

*Audit performed against `06eb22f`. Production behavior changed: NO.*
