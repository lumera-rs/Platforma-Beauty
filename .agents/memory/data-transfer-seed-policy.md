---
name: Data transfer seed reconciliation
description: Owner authorization and interpretation of migration-seeded transfer conflicts.
---

Do not automatically replace, remap, or exclude migration-seeded rows when transferring the preserved snapshot. Reconciliation requires an explicit owner-approved policy.

**Why:** Independently generated seed identifiers differ between the snapshot and a fresh migration-built target. Keeping target seeds while transferring dependent source rows can produce foreign-key failures; those failures do not alone establish source corruption. The owner requested blockers rather than silent repairs.

**How to apply:** Distinguish prospective-target violations from source-integrity findings. Keep default transfer fail-closed and preserve the original snapshot. Obtain approval before implementing seed reconciliation for the eventual cutover.