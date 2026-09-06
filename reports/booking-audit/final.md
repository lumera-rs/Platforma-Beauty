# BOOKING FINAL — adversarial audit, integrity test and production readiness review

**Two passes are recorded here.**

1. **The audit** (`beb783d`): tests, an audit harness and this report only. Production behaviour
   changed: **NO**. Thirteen defects confirmed and filed as `BOOKING-F1` … `BOOKING-F13`.
2. **The remediation**, run afterwards on the same branch at the owner's instruction. Production
   behaviour changed: **YES** — see section AA for exactly what changed and what it costs.

Sections A–Z describe the system **as audited**. Section AA records the fixes and the re-measured
result. Where the two disagree, section AA is current.

---

## A. Decision

> ### BOOKING CONDITIONAL GO

The guarded booking path is sound. Under genuine multi-process concurrency, 200 simultaneous
requests for one slot produced **exactly one** appointment row, and a whole-database scan found
**zero** appointments booked over HTTP in an impossible state. Nothing found in this audit can
produce a double-booked employee through `POST /api/appointments`.

The condition is **BOOKING-F1**. Shift-swap approval reassigns a whole salon-day without taking the
employee lock and without revalidating, and it is the one path in the system that demonstrably
creates a real double-booking — the same person in two salons at 10:00–11:00. Until that is fixed,
any salon chain running two locations with shared staff can put one person in two chairs at once by
approving a swap.

**BOOKING-F4** is the second condition. It does not corrupt data, but the salon directory
advertises appointment times the booking endpoint then refuses, which is the first thing a paying
customer sees.

---

## B. Scope and revision audited

| | |
|---|---|
| Revision | `main` @ `beb783d9c173ce94d2abcadf804869f6d6ac25ef` |
| Working branch | `claude/repo-architecture-analysis-wkrlf3`, restarted from `origin/main` |
| Runtime | Node 22.22.2, pnpm 10.33.0, PostgreSQL 16.13 |
| Audit database | `lumera_audit`, dropped and recreated before the run |
| Load database | disposable databases created by the load harness |
| Production data touched | none |

The branch was restarted from `origin/main` rather than continued, because its previous pull
request had already been merged.

---

## C. What the code actually implements

Several areas the audit brief assumed do not exist. They are reported as absent with evidence
rather than tested against an invented specification.

| Assumed | Reality |
|---|---|
| Pre / processing / post treatment segments | Do not exist. `services.duration_minutes` is one scalar (`lib/db/src/schema/core.ts:489`); the employee is blocked for the whole treatment. The nearest real structure is `appointment_treatments` (`core.ts:762`), an ordered list, not segments. |
| Capacity / group appointments | Do not exist for salon appointments. `appointments` has no capacity or participant count. `booking_groups` (`core.ts:674`) is one client with several consecutive treatments. Capacity exists only on `salon_resources.capacity`. |
| Reschedule deadline, max advance window, per-customer limit, blacklist | No columns, no code. What exists: `minimum_lead_time_minutes`, `cancellation_deadline_minutes`, `max_visit_gap_minutes`, `minimum_useful_late_treatment_minutes` (`core.ts:588`). |

**Statuses actually in the enum** (`core.ts:31`): `pending`, `confirmed`, `completed`, `cancelled`,
`no-show`. Lowercase. Transitions are gated by `canTransitionAppointmentLifecycle`
(`lib/appointment-lifecycle.ts:11`).

**Time model:** `appointment_date` (date) plus `start_time` / `end_time` stored as **TEXT**
wall-clock; lifecycle instants are `timestamptz`. There is **no per-salon timezone column** — a
single global constant `DEFAULT_SALON_TIME_ZONE = "Europe/Belgrade"`
(`availability-engine.ts:51`).

---

## D. How the booking path protects itself

`POST /api/appointments` runs, in one transaction:

1. `executeBookingCommand` takes an advisory lock on
   `(salonId, actorType, actorId, idempotencyKey)` and replays a stored receipt if one exists.
2. `lockAppointmentResources` takes advisory locks on salon, then salon-day, then
   **`lumera:appointments:employee:${date}:${employeeId}` — deliberately without the salon id**, so
   two sibling locations cannot win the same person concurrently (`appointment-locks.ts:20`).
3. `canonicalAvailability` is re-run **inside the transaction under those locks**
   (`marketplace.ts:2223`) and the requested slot must still be offered.
4. The row is inserted, resources allocated, the receipt written — all in the same transaction.

There is **no database-level exclusion constraint** on `appointments`. Correctness rests entirely
on steps 2 and 3. That held under every concurrency test in this audit, but it means any code path
that mutates `employee_id` or the time window *without* repeating steps 2–3 is unprotected. That is
exactly what BOOKING-F1 is.

---

## E. Findings

Thirteen confirmed defects. Severity reflects realistic impact on a paying salon, not how alarming
the code looks.

| ID | Severity | Title |
|---|---|---|
| BOOKING-F1 | HIGH | Shift-swap approval reassigns a salon-day without the employee lock or any revalidation |
| BOOKING-F4 | HIGH | The salon directory advertises slots from a second availability implementation that ignores opening hours |
| BOOKING-F2 | MEDIUM | No client-side occupancy check: one customer can be booked twice at the same time |
| BOOKING-F3 | MEDIUM | Customer reschedule notifies only on the first move because `updatedAt` never changes |
| BOOKING-F5 | MEDIUM | A salon with no opening hours falls back to a hard-coded 09:00–18:00 window instead of being closed |
| BOOKING-F6 | MEDIUM | An employee with no working schedule is bookable for the whole salon opening window |
| BOOKING-F7 | MEDIUM | `cancellation_deadline_minutes = 0` is silently read as `1440` |
| BOOKING-F8 | MEDIUM | `PUT /api/salon/booking-settings` deletes every date exception the request does not resend |
| BOOKING-F9 | MEDIUM | Approving employee leave neither checks nor releases the appointments already booked that day |
| BOOKING-F10 | LOW | `cancellation_deadline_minutes` never blocks a cancellation; it only files a salon notification |
| BOOKING-F11 | LOW | A booking created as `pending` gets no `appointment_status_history` row |
| BOOKING-F12 | LOW | `ensureDemoData()` inserts appointments whose `duration_minutes` contradicts their own window |
| BOOKING-F13 | UX | Quick booking does not resume after sign in; the customer is dropped into the standard wizard |

No CRITICAL finding. Full detail for each is in section F.

F1–F12 come from the audit harness (`booking-audit.test.ts`) and are reproducible over HTTP with
database verification. F13 comes from the existing browser suite and is reported separately in
section F because its history cannot be established — see there.

---

## F. Finding detail

### BOOKING-F1 — HIGH — Shift-swap approval double-books an employee across locations

**Reproduction.** Employee E works at salon A and salon B. E is booked at salon B for
2099-12-07 10:00–11:00; employee F is booked at salon A for the same hour. A shift-swap request
between F and E for that date is approved by the salon A owner.

**Result.** `POST /api/salon/shift-swaps/:id/review` returns **200**. Employee E now holds two
active appointments on 2099-12-07, `10:00-11:00` at salon B and `10:00-11:00` at salon A.

**Root cause.** `routes/phase3.ts:679` calls
`lockAppointmentResources(tx, request.salonId, [{ date: request.swapDate }])` — the resource list
carries a date but **no `employeeId`**. `appointment-locks.ts:29` derives its employee keys from
`resources.filter(r => Boolean(r.employeeId))`, so that list is empty and the global employee lock
is never taken. The handler then reassigns the whole day in a single `UPDATE ... CASE WHEN`
(`phase3.ts:704`) with no revalidation of the result.

**Database state.** `select … from appointments a join appointments b on a.employee_id =
b.employee_id and a.appointment_date = b.appointment_date and a.id < b.id and a.start_time <
b.end_time and a.end_time > b.start_time where status <> 'cancelled'` → **1 pair**.

**Realistic impact.** A chain with two locations and shared staff. The owner approves a swap; one
stylist is now committed to two customers at the same hour in two different shops. Neither customer
is told. This is the only path found in the audit that creates a genuine double-booking.

**Recommended fix.** Read the affected appointments first, then pass
`{ date, employeeId }` for **both** employees into `lockAppointmentResources`, and after the swap
re-run `canonicalAvailability` (or at minimum the overlap query above) for each moved appointment
inside the same transaction; roll back and return 409 if any employee ends up double-booked.

---

### BOOKING-F4 — HIGH — The directory advertises slots the booking endpoint refuses

**Reproduction.** A salon whose `salon_hours` are `12:00–14:00` every day.
`GET /api/salons/:id/first-available` was called, then the exact slot it advertised was booked.

**Result.** Advertised **2026-09-06 11:15**, outside the configured window.
`POST /api/appointments` for that exact slot returned **409**.

**Root cause — corrected during remediation.** My first reading blamed
`computeFirstAvailableServiceSlots` (`marketplace.ts:1732`) and its fixed
`for (let hour = 9; hour < 18; hour += 1)` grid. That function is **unreachable**: it sits after an
unconditional `return` inside a block the code itself labels a rollout reference. The live endpoint
already used `canonicalAvailability`.

The defect that actually shipped was narrower and worse-hidden: the live path passed
`now: { date: today, time: currentTime }` where `currentTime` came from `getUTCHours()`
(`marketplace.ts:1795`), while the engine's model is `Europe/Belgrade`. In summer that advertised up
to two hours of slots that had already passed, and the booking endpoint then refused them.

A second, unrelated defect contaminated the original evidence and is recorded as **BOOKING-F5**
below — the per-weekday fail-open in `locationWindows`. My probe's own fixture wrote
`salon_hours.weekday` as 0-6 while the schema is ISO 1-7, so the salon under test matched no row and
fell through to the 09:00-18:00 fallback. The fixture bug was mine; the fail-open it exposed was
real, and worse than F5 as first written.

**Database state.** No row is written — the booking is correctly refused. The damage is
presentational.

**Realistic impact.** Every salon card in the marketplace can show a first-available time the
customer then cannot book. For salons that do not happen to work 09:00–18:00 on the hour, this is
the normal case, not an edge case.

**Recommended fix.** Delete the second and third implementations and serve first-available from
`canonicalAvailability`, cached, so there is one definition of when a salon is open.

---

### BOOKING-F2 — MEDIUM — One customer can hold two overlapping appointments

**Reproduction.** One customer books two different employees at the same salon for
2099-12-08 12:00–13:00.

**Result.** `POST /api/appointments` returned **201** twice. The customer holds two overlapping
active appointments.

**Root cause.** Customer occupancy is not modelled anywhere. `canonicalAvailability` checks salon
hours, employee schedules, employee occupancy and resources — never whether *this customer* is
already booked.

**Realistic impact.** Mostly self-inflicted by the customer, and salons lose a slot to a no-show.
It is also the mechanism behind accidental duplicate bookings when a customer retries in a second
tab with a fresh idempotency key.

**Recommended fix.** Inside the booking transaction, after the employee lock, reject when the
customer already has a non-cancelled appointment overlapping the requested window. A dedicated
error code lets the UI say "you already have an appointment at this time".

---

### BOOKING-F3 — MEDIUM — Repeated reschedules stop notifying after the first one

**Reproduction.** Book an appointment, then reschedule it three times through
`PATCH /api/appointments/:id`. Count the customer's notifications.

**Result.** Three successful reschedules produced **one** customer notification.

**Root cause.** The notification event key embeds `appointments.updated_at`
(`marketplace.ts:8487`), but the reschedule `UPDATE` never sets `updatedAt`. The key is therefore
identical on every move, and the insert uses `onConflictDoNothing`, so the second and every later
move are silently swallowed.

**Realistic impact.** A salon moves a customer's appointment twice; the customer is told about the
first move and never hears about the second. They arrive at the wrong time. This is the most
customer-visible reliability defect in the list.

**Recommended fix.** Set `updatedAt` on the reschedule update (it should be set regardless), and
make the event key derive from the new date/time rather than a timestamp column, so the key changes
whenever the appointment actually moves.

---

### BOOKING-F5 — MEDIUM — A salon with no opening hours is bookable 09:00–18:00

**Reproduction.** A salon created with zero `salon_hours` rows — the state every salon is in the
moment it is created, since **there is no write API for weekly opening hours at all**. Book at
03:00, 10:00 and 23:00.

**Result.** `03:00 → 409`, `10:00 → 201`, `23:00 → 409`. The 10:00 booking persisted.

**Root cause.** `locationWindows` (`availability-engine.ts:110`) returned
`[{ startTime: "09:00", endTime: "18:00" }]` whenever no row matched **that weekday** — not only
when the salon had no hours at all.

That second reading is the serious one, and I found it only while fixing this. The seeder writes
weekdays 1-6 and the product expresses "closed on Sunday" by writing no Sunday row. So **every
seeded salon was bookable on Sunday**, a day it had explicitly declined to open, and the same held
for any salon whose hours were partially entered. The audit's original framing — new salons with
zero rows — was the narrow case.

**Realistic impact.** A salon that signs up and has not been seeded with hours silently accepts
bookings 09:00–18:00, including on days it is closed. Combined with the missing write API, an owner
has no way to correct this from the product.

**Recommended fix.** Two separate changes, both needed: add a write API for `salon_hours`, and make
the fallback explicit — either treat "no hours" as closed for new salons, or store the historical
09:00–18:00 default as real rows at salon creation so it is visible and editable.

---

### BOOKING-F6 — MEDIUM — An employee with no schedule is always available

**Reproduction.** An employee with no `employee_schedules` rows for the requested weekday. Book
them at the very start of the salon's opening window.

**Result.** **201**, row persisted.

**Root cause.** `employeeCanWork` (`availability-engine.ts:119`): `if (!rows.length) return true`.

**Realistic impact.** Part-time staff who have not had their schedule entered are offered for the
salon's entire trading day. Same fail-open shape as F5, one level down.

**Recommended fix.** Decide the semantics explicitly and document them. If "no schedule" should
mean "follows salon hours", say so in the code and surface it in the UI; if it should mean "not
bookable", return false and make schedule entry part of employee onboarding.

---

### BOOKING-F7 — MEDIUM — A stored cancellation deadline of 0 becomes 24 hours

**Reproduction.** Store `cancellation_deadline_minutes = 0` — which is also the **column default**
(`core.ts:593`) — then cancel an appointment a few hours away.

**Result.** The cancellation succeeded and raised a **"Kasno otkazivanje termina"** salon
notification, as though a 24-hour deadline had been breached.

**Root cause.** `supportedCancellationDeadline` (`marketplace.ts:9285`) accepts only
`{720, 1440, 2880}` and returns `1440` for anything else, including a deliberate `0`.

**Realistic impact.** Every salon that has never opened the booking-settings screen is running an
invisible 24-hour deadline and getting late-cancellation alerts for ordinary cancellations. The
noise trains owners to ignore the notification.

**Recommended fix.** Treat `0` as "no deadline" (`isLateCancellation` already returns `false` for
`deadlineMinutes <= 0`) and add `0` to the accepted set, or drop the whitelist and validate a range.

---

### BOOKING-F8 — MEDIUM — Saving booking settings deletes unsent date exceptions

**Reproduction.** Store a date exception (25 December, closed). Then
`PUT /api/salon/booking-settings` with `dateHours: []`.

**Result.** **200**, and zero `salon_date_hours` rows remain.

**Root cause.** The handler (`marketplace.ts:9340`) runs
`DELETE FROM salon_date_hours WHERE salon_id = …` followed by an insert of only what the request
carried, and does the same for `salon_resource_downtime`. Full-replace semantics are consistent with
the endpoint's name, but they are unforgiving: any client that renders a window of dates and posts
back what it rendered destroys everything outside that window.

**Realistic impact.** An owner opens booking settings to change the slot granularity, saves, and
loses every holiday closure they had entered.

**Recommended fix.** Either scope the delete to the date range the payload covers, or switch to
explicit per-date create/update/delete endpoints. At minimum the API contract should require the
client to send the full set knowingly.

---

### BOOKING-F9 — MEDIUM — Approving leave strands the day's appointments

**Reproduction.** Book two appointments for an employee on 2099-12-20, then approve a leave request
covering that date.

**Result.** **200**. An `employee_time_off` row is written and both appointments remain `pending`
on an employee who is now off.

**Root cause.** `PATCH /api/salon/leave-requests/:requestId` (`marketplace.ts:11561`) writes the
time-off row and nothing else — no check for existing appointments, no warning, no reassignment.
The time-off row also carries **no `salon_id`**, so the block applies at every location the employee
serves.

**Database state.** After approval: 2 active appointments overlapping approved time off. Note that
availability then hides those slots, so the appointments become invisible in the booking flow while
still existing.

**Realistic impact.** Staff member takes leave; two customers still think they have appointments and
turn up. Nobody is told.

**Recommended fix.** On approval, count the affected active appointments in the same transaction. At
minimum return them to the owner and require an explicit confirmation; better, offer reassignment or
cancellation as part of the approval flow.

---

### BOOKING-F10 — LOW — The cancellation deadline is advisory only

**Reproduction.** Set `cancellation_deadline_minutes = 2880` (48 hours) and cancel an appointment a
few hours away.

**Result.** **200**, status `cancelled`.

**Root cause.** `isLateCancellation` is used only to decide whether to file a salon notification
(`marketplace.ts:8713`); it never blocks the cancellation and there is no fee or penalty attached.

**Realistic impact.** Low as a defect, but the setting is presented to owners as a deadline and
enforces nothing. Either the enforcement or the label needs to change.

**Recommended fix.** Decide the product intent. If it is advisory, rename it in the UI. If it should
bite, block the customer-initiated cancellation past the deadline (leaving the salon able to cancel)
or attach the intended consequence.

---

### BOOKING-F11 — LOW — A pending booking has no audit trail

**Result.** 17 appointments booked over HTTP during the audit run have zero
`appointment_status_history` rows.

**Root cause.** `insertInitializedAppointmentInTx` (`marketplace.ts:2129`) writes a history row only
when the initial status is `confirmed`.

**Realistic impact.** For a salon that reviews requests, there is no record of when a booking entered
`pending` or who created it until somebody changes its status. That is the exact record needed in a
dispute about a request the salon says it never received.

**Recommended fix.** Write a `pending` / `create` history row for every initial status.

---

### BOOKING-F12 — LOW — The demo seeder writes self-contradictory appointments

**Result.** 1800 seeded rows carry windows such as `09:00–10:00` with `duration_minutes = 45`.

**Root cause.** `ensureDemoData()` inserts appointments directly into the table, bypassing the
booking path and its consistency rules.

**Realistic impact.** Not a booking-path defect — no API-created row has this problem. It matters
because `ensureDemoData()` runs against whatever database it is pointed at, and any duration-based
reporting over seeded data is wrong.

**Recommended fix.** Derive `duration_minutes` from the window (or the window from the duration) in
the seeder, and add the consistency check from section U to the schema as a `CHECK` constraint so
neither the seeder nor a future code path can write a contradictory row.

### BOOKING-F13 — UX — Quick booking does not resume after sign in

**Reproduction.** `scripts/browser/booking-journey.spec.ts:798`, "quick booking resumes after sign
in and requires a second confirmation". As a guest, click "Brzo zakaži" on a service, follow the
login prompt, sign in, and land back on the salon page.

**Result.** The test fails at
`await expect.poll(() => availabilityCalls).toBeGreaterThan(callsBeforeSignIn)`. No
`POST /api/salons/:id/grouped-availability` call is made in the 30 seconds after the redirect back.

The page snapshot at failure shows why: the widget **does** reopen and the chosen service **is**
restored to the cart, but the customer lands on the standard wizard step
("Nastavi na izbor zaposlenog") rather than on the quick-book confirmation. No availability is
fetched because the wizard has not reached the time step.

**Not a timeout.** The test ran for 56.7 s with a 120 s budget and a 30 s `expect` budget, and every
one of the other 18 specs passed in the same run. This is a behavioural difference, not sandbox
slowness.

**Impact.** The customer picked a specific slot, was asked to log in, and after logging in has to
walk the full wizard again. Their slot selection is lost. No data risk: the server-side
revalidation is intact, and the adjacent spec covering a stale slot (`409` → refresh → fall back to
datetime selection) passes.

**Caveat, stated deliberately.** I cannot say whether this is a regression. `test:booking-journey`
is in **no** CI workflow and **no** `validate:release` phase, and the repository squash-merges, so
there is no history showing this spec green. Either the app lost the resume behaviour, or the spec
encodes an intent that was never shipped. Both are worth someone's five minutes; neither can be
settled from this branch.

**Recommended fix.** Decide which of the two it is first. If quick-book resume is the intended
behaviour, carry the selected slot through the login round-trip and re-open on the confirmation step
with a fresh availability call. If it is not, delete the assertion and rename the spec. Then wire
the booking-journey suite into a release phase so the answer stays known — see section S.

---

## G. What was attacked and held

These are as much a part of the result as the findings. Each was driven over HTTP and then verified
against the database, not against the response status.

| Attack | Outcome |
|---|---|
| Another customer reads / moves / cancels someone else's appointment | `PATCH=404`, `CANCEL=404`; row byte-identical afterwards |
| A rival salon owner patches an appointment in another tenant's salon | `404`; row unchanged |
| Mass assignment: `price`, `durationMinutes`, `duration`, `status`, `customerId`, `travelFee`, `createdAt` | All ignored. Persisted `price=2000` (service price), `duration=60` (service duration), `status=pending`, customer taken from the session, `travelFee=0` |
| Same idempotency key, different payload | First `201`, second `409 IDEMPOTENCY_KEY_REUSED`; exactly 1 row |
| One raw idempotency key used by two different customers | `201` / `201`; each customer got their own appointment. Receipts are scoped by `(salonId, actorType, actorId, key)` |
| Minimum lead time of 1440 minutes vs a booking 4 hours out | `409`; no row |
| Service duration and price changed to 180 min / 99000 after booking | Booked row unchanged: `price=2000`, `duration=60`, window `12:00–13:00` |
| Every slot the availability API offered, then booked | 14 slots offered; first, middle and last all booked successfully |
| Employee named in the availability preview vs the one actually assigned | Same employee |
| 200 simultaneous requests for one slot, from 2 independent API processes | `{201: 1, 409: 199}`; exactly 1 active row |

Price and duration authority, tenant isolation, cross-customer isolation and idempotency scoping are
all correct. That is worth stating plainly: the parts of this system that handle money and ownership
were not broken by any attack in this audit.

---

## H. Concurrency — real multi-process

Every pre-existing "concurrency" test in the repository is `Promise.all` inside **one** process. The
only true multi-process harness is `scripts/src/run-booking-load.ts`, which starts N independent API
processes against one disposable database. It was run in full.

| Scenario | Requests | Statuses | Result |
|---|---|---|---|
| same-slot | 200 | `{201: 1, 409: 199}` | exactly one winner |
| 1000-distinct | 1000 | `{201: 1000}` | no false conflicts |
| 250-groups | 250 | `{201: 125, 409: 125}` | no partial groups |
| mixed-1000 | 1000 | `{200: 500, 201: 255, 409: 245}` | no cross-customer rows |

Harness integrity counters after the run: `sameSlotActive: 1`, `activeOverlaps: 0`,
`crossCustomerRows: 0`, `partialGroups: 0`, `distinctAppointments: 1000`, `distinctCustomers: 1000`.

---

## I. Performance

Correctness and latency reported separately, as they should be.

| Scenario | p50 | p95 | p99 | req/s | Objective |
|---|---|---|---|---|---|
| same-slot | 1392 ms | 3193 ms | 3238 ms | 60.8 | PASS (p95/p99 ≤ 5000) |
| 1000-distinct | 4073 ms | 5678 ms | 5841 ms | 166.4 | PASS (p95/p99 ≤ 10000) |
| 250-groups | 1845 ms | 2054 ms | 2056 ms | 117.3 | PASS (p95/p99 ≤ 5000) |
| mixed-1000 | 3491 ms | 4965 ms | 5072 ms | 192.1 | PASS (p95/p99 ≤ 10000) |

All customer and operational objectives passed, with zero unexpected errors and zero timeouts.

**This is an improvement over the committed baseline.** `reports/booking-load/latest.json` records
`1000-distinct` **failing** its p95 objective at 10 343 ms against a 10 000 ms target. The same
scenario now runs at 5 678 ms. Full data: `reports/booking-load/audit-final.json`.

**Caveat.** These numbers measure this sandbox — 2 API processes, pool max 10 each, a 35-connection
budget against a local PostgreSQL. They are not a production capacity statement. What transfers is
the *shape*: pool waiting peaked at 454 per process on 1000-distinct without a single timeout, and
lock counts stayed inside the operational ceilings.

---

## J. Availability vs booking

Three independent availability implementations exist. Their agreement with the booking endpoint was
tested directly.

| Implementation | Used by | Agrees with booking? |
|---|---|---|
| `canonicalAvailability` (`availability-store.ts`) | `GET /salons/:id/availability`, and the in-transaction revalidation | **Yes.** 14 offered slots, sampled first/middle/last, all booked |
| `computeFirstAvailableServiceSlots` (`marketplace.ts:1732`) | `GET /salons/:id/first-available` | **No** — BOOKING-F4 |
| `earliestAvailabilityExpr` (`marketplace.ts:6376`) | salon directory listing SQL | Not exercised over HTTP in this audit; shares F4's root cause by inspection |

The canonical engine is trustworthy. The two shortcuts around it are not.

---

## K. Idempotency

`booking_command_receipts` is scoped by `(salon_id, actor_type, actor_id, idempotency_key)` with a
payload fingerprint (`booking-command.ts:96`). Verified behaviour:

- Same key, same payload → replay of the stored response, `Idempotency-Replayed: true`.
- Same key, **different** payload → `409 IDEMPOTENCY_KEY_REUSED`. No second row.
- Same raw key from two different customers → no collision; each got their own appointment.
- Duplicate receipts per scope in the whole database: **0**.

**Gap, not a finding in this audit:** reschedule, cancel and lifecycle transitions have **no**
idempotency receipts. A retried cancel or reschedule is not protected the way a create is. This was
not exploited into an invalid state here, but it is the obvious next place to look.

---

## L. Snapshot semantics

Editing a service after a booking does not rewrite the booking. Service changed to 180 minutes and
99 000; the booked row kept `price=2000`, `duration=60`, window `12:00–13:00`. Correct.

The inverse — BOOKING-F8 — is where configuration changes *do* destroy data.

---

## M. Security and authority

No finding. See section G. Cross-customer, cross-tenant, mass assignment, price authority and
duration authority were all attacked and all held, verified against database rows rather than
response codes.

---

## N. Transaction integrity

`createAllocatedAppointment` performs the insert, resource allocation, receipt write and
`afterCreate` side effects in one transaction (`marketplace.ts:2223` onwards). The integrity scan
in section U found no orphan resource allocations and no duplicate receipts.

**Not covered by this audit:** failure injection at each commit point via the `test-server.ts` IPC
hooks, and process-restart replay of a lost response. Listed honestly as a coverage gap in
section W, not as a pass.

---

## O. Notifications and outbox

BOOKING-F3 is the confirmed defect. Two related weaknesses were found by reading the code and are
**not** claimed as verified findings:

- Reschedule and cancel emails are enqueued **after** commit against `db` rather than `tx`
  (`marketplace.ts:8522`, `:8749`). A crash between commit and enqueue loses the notification
  permanently. Booking *creation* does this correctly, inside the transaction.
- `booking_command_receipts` has no retention policy and stores the full response body as `jsonb`.
  It grows without bound.

---

## P. Timezone

The model is wall-clock text plus a single global `Europe/Belgrade` constant. There is no per-salon
timezone column, so a salon outside that zone cannot be represented correctly today. Within the
audit, the one concrete timezone defect found is the UTC/Belgrade mix inside
`computeFirstAvailableServiceSlots` (part of BOOKING-F4). DST boundary testing is a coverage gap —
section W.

---

## Q. Multi-location

Employee occupancy locks are correctly **global**, not per-salon (`appointment-locks.ts:36`), and
the comment there says exactly why. That design is right, and it is what makes BOOKING-F1 a bug
rather than a design gap: the shift-swap path simply fails to use it.

`employee_time_off` rows carry no `salon_id`, so leave blocks every location. That is arguably
correct for leave, and is noted inside BOOKING-F9 rather than raised separately.

---

## R. Browser

Attempted, per the agreed approach of trying and reporting what could not be done. It ran.

`pnpm run test:booking-journey` cannot run unattended: its pre-flight requires the shared dev
workflows already listening on `:80`. A disposable-infrastructure entry point was added
(`scripts/src/run-booking-journey-browser.ts`) following the pattern of the wired browser suites,
which starts its own database, API and web processes on random ports.

**The 19 booking-journey specs were driven against a real browser and a real stack.**

| Run | Per-test budget | Result |
|---|---|---|
| 1 | 30 s (Playwright default) | 11 passed, **8 failed** |
| 2 | 120 s | **18 passed, 1 failed** |

Seven of the eight first-run failures were the 30-second budget and nothing else. The passing tests
in run 1 took **25.4–29.7 s each** against a 30 s ceiling, and every one of those seven failed on
`page.goto`, `page.reload` or `locator.click` timing out rather than on an assertion. Raising the
budget turned all seven green with no other change. That is a **sandbox coverage limit, not a
finding** — but it also means the booking journey suite has almost no headroom on a slow CI runner.

The eighth is **BOOKING-F13**. It fails on an assertion rather than a timeout, survives a 120 s test
budget and a 30 s `expect` budget, and is the one browser result that says something about the
product rather than about this sandbox.

Known sandbox constraints that are **coverage gaps, never findings**: outbound TLS is blocked, so
`fonts.googleapis.com` fails and any spec that counts browser console errors fails with it; the
bundled Chromium requires `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

The config change enabling this (`scripts/playwright.config.ts`) adds two opt-in environment
overrides, `LUMERA_PLAYWRIGHT_TIMEOUT_MS` and `LUMERA_PLAYWRIGHT_EXPECT_TIMEOUT_MS`, both unset
everywhere including CI, so the default budgets are unchanged. It exists so a run can tell
"this environment is too slow" apart from "the page is broken".

---

## S. Test suite health

- `booking-audit.test.ts` (new) — 21 probes, exit 0 by design so one run produces the whole picture.
- Existing booking suites were reused, not rewritten.
- **`final-booking-hardening.test.ts` — idempotency replay, durable receipts, rollback, and the
  cancel-vs-reschedule race — is in no `validate:release` phase.** The strongest existing booking
  test is not part of any gate.
- **`booking-journey.spec.ts` — 19 browser specs covering the entire customer booking flow — is in
  no CI workflow and no release phase either**, and cannot even run unattended (see section R).
  That is how BOOKING-F13 stayed invisible. Both of these cost nothing to fix and are the highest
  value-per-effort items in this report.
- The booking suites are not independently runnable on a fresh database: they depend on the demo
  seed being present, and `booking-p1-regressions.test.ts` creates a user early enough that
  `seed()` takes its maintenance branch and never creates the demo salons.

---

## T. Reproduction

```bash
service postgresql start
export PGPASSWORD=postgres
psql -U postgres -h localhost -d postgres -c "drop database if exists lumera_audit;" \
                                            -c "create database lumera_audit;"
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lumera_audit"
export SESSION_SECRET="lumera-ci-database-only-session-secret"
export NODE_ENV=test

pnpm --filter @workspace/db run push-force
pnpm --filter @workspace/scripts exec tsx \
  ../artifacts/api-server/src/lib/booking-audit.test.ts

# multi-process load, all four scenarios
LUMERA_BOOKING_LOAD=1 LUMERA_BOOKING_LOAD_REPORT_NAME=audit-final \
  pnpm run test:booking-load
```

The audit suite prints one line per probe, a summary, and a
`BOOKING_AUDIT_FINDINGS_JSON=` line for machine consumption.

---

## U. Database integrity scan

Every query answers "how many rows are in a state the booking rules should make impossible". Run
against the audit database after the full probe run.

**Scope that matters — rows actually written by the booking path** (`created_by_user_id` is set only
by `insertInitializedAppointmentInTx`, which excludes both the demo seeder and the probes' own
direct inserts):

| Impossible state | Count |
|---|---|
| `end_time <= start_time` | 0 |
| `duration_minutes` disagrees with the booked window | 0 |
| negative price or travel fee | 0 |
| appointment whose service belongs to another salon | 0 |
| appointment on an employee not assigned to that location | 0 |
| orphan resource allocation with no appointment | 0 |
| duplicate booking-command receipt for one scope | 0 |

**Every count is zero.** No appointment created through the API is in an impossible state.

Two counts are non-zero and both are attributed rather than raised as separate findings:

| Count | Attribution |
|---|---|
| 2 active appointments overlapping approved time off | Created deliberately by probe E1 to demonstrate BOOKING-F9 |
| 1800 rows whose duration disagrees with their window | `ensureDemoData()`, which bypasses the booking path — BOOKING-F12 |

The whole-database employee-overlap scan returns **1 pair**: the one BOOKING-F1 creates.

---

## V. What would change the decision

**To BOOKING GO:** fix BOOKING-F1 and BOOKING-F4, and re-run this suite until both probes report
clean. F1 is the double-booking; F4 is what the customer sees first.

**To BOOKING NO-GO:** any of the following, none of which was observed — a double-booking through
`POST /api/appointments` under concurrency, a cross-tenant appointment mutation, a duplicate
financial mutation, or a partial-state transaction defect.

---

## W. Coverage gaps

Stated as gaps, not as passes. Nothing here was tested and cleared; it was not tested.

1. **Transaction failure injection.** The `test-server.ts` IPC hooks were not exercised. Crash
   points after insert, after snapshot, around the receipt and around the outbox are untested.
2. **Process-restart replay.** A lost response retried against a *newly started* API process was not
   tested. In-process replay was.
3. **DST boundaries.** The spring skipped hour and the autumn repeated hour in `Europe/Belgrade`
   were not driven through the booking path.
4. **Outbox workers.** Two real worker processes competing on `FOR UPDATE SKIP LOCKED`, and provider
   failure, were not tested.
5. **Widget guest path.** `widget.ts` keys guest idempotency on the phone number from the request
   body (`widget.ts:141`), and its replay path runs before the rate limiter (`widget.ts:120` vs
   `:238`). Read but not attacked.
6. **Reschedule / cancel idempotency.** No receipts on those paths — see section K.
7. **Mutation testing.** Deliberately breaking the overlap revalidation to confirm the probes catch
   it was not done.
8. **Browser.** Ran: 18 of 19 booking-journey specs pass at an adequate time budget; the
   nineteenth is BOOKING-F13. Not covered: the double-click and two-context stale-slot scenarios
   beyond what the existing specs already assert, and any browser testing in a non-Belgrade
   timezone.

---

## X. Recommended remediation order

1. **BOOKING-F1** — the only real double-booking. One task, small diff, high value.
2. **BOOKING-F4** — collapse the three availability implementations into one.
3. **BOOKING-F3** — customers being told about the wrong appointment time is a support cost.
4. **BOOKING-F9**, **BOOKING-F8** — both destroy or strand data an owner entered.
5. **BOOKING-F5**, **BOOKING-F6**, **BOOKING-F7** — the fail-open defaults, best done together with
   a write API for `salon_hours`.
6. **BOOKING-F2**, **BOOKING-F10**, **BOOKING-F11**, **BOOKING-F12**.
7. **BOOKING-F13** — first decide whether quick-book resume is intended behaviour.
8. Separately, and cheaply: wire `final-booking-hardening.test.ts` and `booking-journey.spec.ts`
   into a release phase, and add a `CHECK` constraint tying `duration_minutes` to the booked
   window.

Longer term, and outside any single finding: `appointments` has no exclusion constraint. Advisory
locks plus in-transaction revalidation are doing all the work. A PostgreSQL exclusion constraint on
`(employee_id, appointment_date, time range)` for non-cancelled rows would have made BOOKING-F1
impossible to write in the first place, and would catch the next path that forgets to take the lock.

---

## Y. Sign-off

**Would I personally approve this exact booking implementation for real paying salons and customers
today?**

**Yes, with BOOKING-F1 fixed first — and not before.**

The core of this system is better than I expected going in. I tried to break it under real
multi-process concurrency, with hostile payloads, with replayed keys, across tenants, and against
configuration changed underneath a live booking. The guarded path did not yield: 200 simultaneous
requests for one slot produced one row, price and duration could not be dictated by the client, no
customer could touch another's appointment, and no appointment written through the API is in an
impossible state. That is a real result and it is the hard part.

What I would not ship today is BOOKING-F1. It is a small omission — a missing `employeeId` in one
lock argument — but its consequence is a stylist standing in front of two customers at the same hour
in two different shops, with nobody warned. A salon owner would rightly call that broken, and it is
reachable through a feature they are meant to use.

BOOKING-F4 I would fix in the same week, though I would not block on it. It costs bookings and
credibility rather than data. BOOKING-F13 sits alongside it: a customer who picks a slot, logs in,
and finds their choice gone will not try a third time.

The rest I would ship and schedule. The fail-open defaults (F5, F6) deserve attention before the
platform has many self-service salons, because today they are masked by seeded data; they will stop
being masked the moment a real owner signs up and nobody seeds their hours.

The thing that worries me most is not on the findings list. The two strongest booking test suites in
this repository — `final-booking-hardening.test.ts` and the 19 browser specs in
`booking-journey.spec.ts` — are wired into nothing. The browser suite cannot even run unattended.
That is how BOOKING-F13 stayed invisible, and it is why I cannot tell you whether it is a regression
or a spec that was never true. A booking system this carefully locked deserves gates that actually
run; wiring both is a smaller job than any single finding above and buys more than most of them.

One more thing on the record, because it is a gap rather than a verdict: I did not test transaction
failure injection, process restart replay, DST boundaries, or the outbox workers. The booking path
held under everything I *did* throw at it, and I have no reason to suspect those areas — but I have
not earned the right to say they are fine, and section W says so.

---

## AA. Remediation

Run after the audit, at the owner's instruction. **Production behaviour changed: YES.** Four
decisions that alter what existing salons see were put to the owner first; all four were taken the
conservative way.

### What changed

| Finding | Change | File |
|---|---|---|
| F1 | Shift-swap approval now locks **both** employees by name and revalidates the whole day across every location under those locks; a swap that would double-book anyone rolls back with `SHIFT_SWAP_DOUBLE_BOOKS_EMPLOYEE` | `routes/phase3.ts` |
| F4 | `first-available` no longer feeds the engine a UTC wall clock; the horizon is built from the salon's own day and `now` is left to `canonicalAvailability`. The unreachable 180-line pre-canonical block that misled the audit is deleted | `routes/marketplace.ts` |
| F5 | A weekday with no `salon_hours` row is **closed** once the salon has any hours at all. The 09:00-18:00 fallback survives only for salons with no hours whatsoever; new salons are given six real, editable rows at creation | `lib/availability-engine.ts`, `routes/marketplace.ts` |
| F6 | Same rule for staff: once an employee has any schedule at a location, a weekday with no row is a day off. New employees inherit the salon's hours as a real schedule | `lib/availability-engine.ts`, `routes/marketplace.ts` |
| F2 | A customer cannot hold two overlapping appointments, at any salon. Enforced inside the booking transaction under the employee lock, and on reschedule, with `CUSTOMER_ALREADY_BOOKED` | `routes/marketplace.ts` |
| F3 | Reschedule stamps `updatedAt`/`updatedByUserId`; the notification key names where the appointment now **is**, so every real move notifies; the email and notification are enqueued **inside** the transaction | `routes/marketplace.ts` |
| F7 | A stored deadline of `0` means no deadline, instead of being rewritten to 1440 | `routes/marketplace.ts` |
| F9 | Approving leave over booked appointments returns `409 LEAVE_CONFLICTS_WITH_APPOINTMENTS` listing them; the owner must choose `cancel` or `keep`, and `cancel` cancels them in the same transaction | `routes/marketplace.ts` |
| F11 | Every booking writes its opening `appointment_status_history` row, `pending` included | `routes/marketplace.ts` |
| F12 | The seeder derives `end_time` from the service duration instead of assuming one hour | `lib/seed.ts` |
| F13 | The salon page no longer consumes the quick-book slot before the salon's own "today" has loaded — the cause of the lost selection | `pages/salon-profile.tsx` |
| F8 | Left as documented replace semantics; the reachable data-loss path (submitting before settings hydrate) is refused client-side | `components/owner/booking-settings-form.tsx` |
| F10 | Left advisory by decision; the probe now asserts that contract rather than assuming enforcement | — |

### Two corrections to the audit

Stated plainly because both changed what the fix had to be.

1. **F4's root cause was wrong.** I attributed it to `computeFirstAvailableServiceSlots` and its
   hard-coded `for (hour = 9; hour < 18)` grid. That function is unreachable — it sits after an
   unconditional `return`. The live path already used the canonical engine; the real defect was the
   UTC wall clock passed into it. Section F is corrected.

2. **F4's original evidence was contaminated by my own fixture.** The audit harness wrote
   `salon_hours.weekday` as 0-6 while the schema is ISO 1-7, so the salon under test matched no row
   and fell through the fallback. Fixing the fixture surfaced something worse than the finding it
   was meant to prove: the fallback applied **per weekday**, so every seeded salon — which the
   seeder opens Monday to Saturday — was bookable on Sunday. F5 is rewritten accordingly.

### Re-measured

Audit harness, fresh database, all 22 probes:

```
findings: 0
```

Every probe that reported a defect now reports clean, including the whole-database integrity scan.

| Check | Result |
|---|---|
| `booking-audit.test.ts` (22 probes) | 0 findings |
| `test:appointment-regressions` (seeded, as CI runs it) | pass |
| `test:final-booking-qa` | pass |
| `booking-journey.spec.ts` (19 browser specs) | **19/19 pass** |
| `test:booking-load`, all four scenarios | all objectives pass |

Load integrity after the changes: `sameSlotActive: 1`, `activeOverlaps: 0`, `crossCustomerRows: 0`,
`partialGroups: 0`, `distinctAppointments: 1000`.

| Scenario | Statuses | p95 before | p95 after |
|---|---|---|---|
| same-slot | `{201: 1, 409: 199}` | 3193 ms | 3270 ms |
| 1000-distinct | `{201: 1000}` | 5678 ms | 7231 ms |
| 250-groups | `{201: 125, 409: 125}` | 2054 ms | 2863 ms |
| mixed-1000 | `{200: 500, 201: 255, 409: 245}` | 4965 ms | 6560 ms |

**The fixes cost latency** — roughly 25-40% at p95 — and that is worth saying out loud rather than
burying. Every scenario still passes its objective with room (the 1000-distinct target is 10 000 ms),
and the cost buys a customer-occupancy check plus an audit-trail row on every booking. If p95 matters
more than either, the occupancy check is the one to revisit; it is a single indexed lookup per
booking and could be narrowed.

### Test fixtures that were relying on the bugs

Two assertions in `appointment-routes.test.ts` only passed because of the defects, and were updated:

- The fixture gave its salon a **Sunday-only** `salon_hours` row and booked on a Thursday, which
  worked solely through the per-weekday fallback. It now declares the week it books across
  (09:00-18:00, the exact window the fallback used to supply).
- The resource-capacity assertion booked **the same client** into two concurrent slots to prove
  capacity 2. Capacity is about two different people; the test now uses a second CRM contact.

Both are the tests catching up with correct behaviour, not workarounds. I checked each against the
pre-change revision to be sure the failures were mine and not pre-existing.

One failure was **not** mine: `test:appointment-regressions` fails on an empty database at both the
pre-change and post-change revision, because of the seed-ordering dependency in section S. Seeded
first, as CI runs it, the chain passes.

### Wired into the release gates

Both suites the audit found unwired are now in release phase 4:

- `test:final-booking-qa` — idempotency replay, durable receipts, rollback, cancel-vs-reschedule.
- `test:booking-journey-browser` — the 19 browser specs, through a new runner that brings its own
  disposable database, API and web processes.

The browser runner carries an explicit 180 s per-test budget. That is deliberate: several specs take
45 s to 1.8 min here, and Playwright's 30 s default would fail them for being slow rather than wrong.

### Standing

**BOOKING GO**, on the evidence above — the condition in section A was F1, and F1 is fixed and
verified. Section W's coverage gaps are unchanged: transaction failure injection, process-restart
replay, DST boundaries and the outbox workers were not tested in either pass.

---

## Z. Filed issues

Every finding is filed. Issues group findings that share a root cause or a fix.

| Issue | Findings |
|---|---|
| [#10](https://github.com/lumera-rs/Platforma-Beauty/issues/10) | BOOKING-F1 — shift-swap double-booking (HIGH) |
| [#11](https://github.com/lumera-rs/Platforma-Beauty/issues/11) | BOOKING-F4 — directory advertises unbookable slots (HIGH) |
| [#12](https://github.com/lumera-rs/Platforma-Beauty/issues/12) | BOOKING-F3 — reschedule notifications lost after the first move |
| [#13](https://github.com/lumera-rs/Platforma-Beauty/issues/13) | BOOKING-F9 — leave approval strands appointments |
| [#14](https://github.com/lumera-rs/Platforma-Beauty/issues/14) | BOOKING-F8 — settings save deletes date exceptions |
| [#15](https://github.com/lumera-rs/Platforma-Beauty/issues/15) | BOOKING-F5, F6 — availability fails open |
| [#16](https://github.com/lumera-rs/Platforma-Beauty/issues/16) | BOOKING-F7, F10 — cancellation deadline |
| [#17](https://github.com/lumera-rs/Platforma-Beauty/issues/17) | BOOKING-F2 — customer double-booking |
| [#18](https://github.com/lumera-rs/Platforma-Beauty/issues/18) | BOOKING-F11, F12 — audit trail and seeder consistency |
| [#19](https://github.com/lumera-rs/Platforma-Beauty/issues/19) | BOOKING-F13 — quick-book resume, and the unwired browser suite |

## Artifacts

| Path | What it is |
|---|---|
| `artifacts/api-server/src/lib/booking-audit.test.ts` | The audit harness: 21 probes over HTTP with database verification. Exits 0 by design. Not wired into any release phase. |
| `scripts/src/run-booking-journey-browser.ts` | Runs the booking-journey browser specs against disposable infrastructure. Not wired into any release phase. |
| `scripts/playwright.config.ts` | Two opt-in timeout overrides, unset everywhere including CI. |
| `reports/booking-load/audit-final.{json,md}` | The full four-scenario load run behind section I. |

---

*Audit performed against `beb783d`. Production behavior changed: NO.*
