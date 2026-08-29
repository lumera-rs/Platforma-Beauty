---
name: Grouped booking mutation boundary
description: Why grouped appointments must never be changed through legacy single-appointment mutation paths.
---

Once an appointment belongs to a booking group, every reschedule or cancellation must run through the group mutation boundary and its final-layout validation. Legacy single-appointment routes must reject the operation rather than update only one member.

**Why:** A correct group endpoint is insufficient if an older appointment endpoint can still move or cancel one member without locking and validating the complete persisted treatment sequence.

**How to apply:** When adding or retaining any appointment mutation, explicitly handle `bookingGroupId`: delegate to the canonical group operation or return a stable group-mutation-required conflict before writing.