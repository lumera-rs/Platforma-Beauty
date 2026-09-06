# Seven booking features — implementation record

Companion to `final-v2.md`. That report is an audit of `06eb22f` and changed no production
behaviour; section C-bis of it lists seven features the brief assumed and the code did not have.
This document records building them, which was a separate, later task.

The governing constraint was **no parallel booking system**. Every feature here reaches the database
through the same guarded path that already existed:

```
POST /api/appointments (or the owner / widget / group surface)
  → executeBookingCommand      advisory lock on (salonId, actorType, actorId, idempotencyKey)
                               + receipt replay
  → lockAppointmentResources   salon → day → employee (global) → resource
  → canonicalAvailability      revalidated inside the transaction
  → insert
```

Nothing bypasses it, and no second scheduling engine was introduced. Where a feature needed a
different notion of "busy", that notion was added to the one availability engine rather than
alongside it.

---

## 1. Segmented treatments — pre / processing / post

`services` and `appointments` both carry `preProcessingMinutes`, `processingMinutes`,
`postProcessingMinutes`, guarded by `services_segments_check`: the three are either all zero or they
sum to `durationMinutes`. A booked appointment snapshots its own segments, so editing the service
later cannot move a row already in the calendar.

The engine gained one definition of occupancy that every caller now shares:

```ts
treatmentOccupancy(shape, startTime) -> { employee: Interval[], client, resource, end }
```

An unsegmented treatment returns a single employee interval — the previous behaviour, unchanged. A
segmented one returns the pre and post intervals only, leaving the processing gap free for the
employee while the client and the chair stay occupied. `busyEmployeeIntervals()` reads existing rows
through the same function, so a booked colour treatment releases its own gap.

**Verified live:** a 60-minute treatment is refused from a 30-minute processing gap; a 30-minute one
is accepted into it.

## 2. Multi-employee crews

`services.requiredEmployeeCount` and the `appointment_employees` join table. `generateAvailability`
selects N free employees for a slot and returns `employeeIds` / `employeeNames`;
`createAllocatedAppointment` locks **every** participant and then revalidates each one individually
with `requiredEmployeeCount: 1`, so the in-transaction question is "is this specific person still
free" rather than "are N people free somewhere".

**Verified live:** a crew of two commits two participant rows; with only two employees in the salon,
the next overlapping crew booking is refused.

## 3. Shared seats

`services.seatCapacity`, snapshotted onto the appointment as `seatCount`. The engine treats a
shareable slot as a group: overlapping bookings of the same service at the same start with the same
employee count against capacity instead of blocking each other.

**Verified live:** three different clients share a three-seat slot; the fourth is refused. A client
trying to take a second seat in a slot they already hold is refused by the customer-busy check
(BOOKING-F2's fix), not by capacity.

## 4. Add-ons and 5. Deposits

`service_add_ons` with their own duration, price and optional resource requirements;
`appointment_add_ons` snapshots what was actually booked. Add-on minutes extend the occupancy through
`treatmentOccupancy`'s `addOnMinutes`, and add-on resource requirements are merged into the parent's
before locking, so an add-on that needs the wash basin blocks on the wash basin.

`services.depositAmount` writes an `appointment_deposits` row inside the booking transaction. It
records the obligation; it does not take money — there is no payment provider in this codebase.

**Verified live:** a 60-minute / 6000-dinar service with a 15-minute / 800-dinar add-on books as
75 minutes and 6800 dinars, with a 1500-dinar deposit row.

## 6. Waitlist

`appointment_waitlist`, with a unique index preventing one customer from joining the same salon /
service / date twice while a request is live.

- `GET`/`POST` `/api/customer/waitlist`, `DELETE /api/customer/waitlist/:id`
- `GET /api/salon/waitlist` for the owner

When a slot is released — `cancelAppointmentInTx` or a reschedule away from the slot —
`notifyWaitlistForReleasedSlotInTx` runs **inside the same transaction** and notifies matching
entries. It deliberately does **not** auto-book: the notified customer books through the normal
guarded path like anyone else, which is what keeps this from becoming a second booking system. Two
waitlisted customers racing for one freed slot is therefore the ordinary same-slot race, already
proven to yield exactly one row.

**Verified live:** join returns 201, a duplicate returns 409, cancelling the appointment marks the
entry notified, and **zero** appointments are created automatically.

## 7. Recurring appointments

`appointment_series.recurrenceFrequency` / `recurrenceInterval`. `expandRecurrence()` turns a rule
into concrete dates — weekly, biweekly and monthly, month-end clamped (31 January → 28 February),
capped at 26 occurrences — and hands them to the **existing** series booking path, which books each
occurrence through the guarded path and reports per-date conflicts rather than silently skipping
them.

**Verified live:** weekly expansion lands on the right dates, the January 31 → February 28 clamp
holds, and a malformed rule is rejected.

## 8. Drag-and-drop calendar reschedule

`rescheduleAppointmentInTx()` is now the single reschedule implementation. It locks both the old and
the new slot, re-runs `canonicalAvailability` with the appointment excluded from its own conflict
check, applies the customer-busy check, rebuilds `appointment_employees` and the resource
allocations, and notifies the waitlist for the slot it just freed.

Both surfaces call it: the customer `PATCH /api/appointments/:id` and the owner
`PATCH /api/salon/appointments/:id`, the latter having gained a `date` / `startTime` branch — added
to `SalonAppointmentUpdate` in `lib/api-spec/openapi.yaml` and regenerated, not hand-written into
the client.

In the owner calendar, an appointment card is draggable when it is `pending` or `confirmed`, and each
calendar day is a drop target. Dropping moves the appointment to the same time on that day through
the ordinary update mutation — the same request a typed reschedule sends. There is no drag-specific
endpoint. A conflict surfaces as the server's own message
(*"Termin nije slobodan u izabrano vreme."*); an appointment in a booking group is refused client-side
with an explanation, matching the server's `BOOKING_GROUP_MUTATION_REQUIRED`.

The visual treatment follows what the page already used: `cn()` with Tailwind tokens,
`cursor-grab active:cursor-grabbing`, `opacity-50 ring-2 ring-primary/40` on the row being dragged,
`border-primary bg-primary/10 shadow-sm` on the hovered day, existing `toast` calls, Serbian labels.
No new UI dependency.

**Verified live:** dropping onto a free day returns 200 and moves the row; dropping onto an occupied
slot returns 409 and leaves the row exactly where it was; a notes-only update still takes the old
path; the employee- and customer-overlap scans both return 0.

---

## Verification

| Check | Result |
|---|---|
| `test:api-server-typecheck` | pass |
| `test:beauty-marketplace-typecheck` | pass |
| Audit harness v1 (`booking-audit.test.ts`) | **0 findings** |
| Audit harness v2 (`booking-audit-v2.test.ts`) | only the known open F15 / F16; no new findings |
| `test:appointment-regressions` | pass |
| `test:final-booking-qa` | pass |
| `validate:publish` | pass |
| Employee overlap scan | 0 |
| Customer overlap scan (booked over HTTP) | 0 |

V1 of the v2 harness reports `skipped` rather than a result when the run happens late in the salon
day — its late-start window needs the Belgrade wall clock to leave room before 18:45. BOOKING-F14
stands as filed.

---

*The three findings open at the end of the v2 audit — F14 (HIGH), F15 (MEDIUM), F16 (RELIABILITY) —
are untouched by this work and remain open as issues #20–#22.*
