---
name: Campaign attribution buckets
description: Attributed-revenue splits must classify every appointment status explicitly — no complement buckets.
---

Campaign/attribution revenue splits (earned vs upcoming) must assign every appointment status to an explicit bucket. Attribution excludes both terminal-without-money statuses: cancelled AND no-show. "Upcoming" means only pending/confirmed.

**Why:** an earlier split defined "upcoming" as the complement (attributed but not completed), which silently absorbed no-show appointments and presented money that will never arrive as future booked revenue. Completion review rejected it.

**How to apply:** whenever bucketing rows by status enum, enumerate the statuses per bucket and decide each terminal status deliberately; a complement bucket is only safe after the join/filter already restricts rows to exactly the statuses the complement should mean. Keep the "buckets sum to the total" invariant by construction and assert it in tests with one row per status.

Related rule for segment-count labels (e.g. new/returning client split on filter buttons): compute the split in ONE aggregate over the *unfiltered* period scope, ignoring the active segment filter, and derive the filtered list's `total` from the matching bucket of that same aggregate. This keeps labels stable while switching segments and makes it impossible for a filtered list total to disagree with the count printed on its own button. Include the tri-state "unknown" bucket (rows matching neither segment) so buckets still sum to the "all" total.
