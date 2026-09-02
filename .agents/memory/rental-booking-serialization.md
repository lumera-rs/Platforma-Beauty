---
name: Rental booking serialization
description: Concurrency rule for editing listings and accepting concrete rental slots.
---

Derive rental type, intent, availability, and the complete resulting slot set only after rereading the listing under the per-listing lock. All request creation and acceptance paths acquire locks in listing-then-slot order and revalidate current eligibility.

**Why:** A PATCH based on stale pre-lock listing state can otherwise run after a rental conversion and erase the newly required slots. Slot-only serialization also leaves listing closure, expiry, or moderation changes outside the acceptance decision.

**How to apply:** Any mutation that can change or consume rental availability must serialize by listing first, then slot where applicable; validate active/approved/unexpired state and future timing from locked rows before writing.