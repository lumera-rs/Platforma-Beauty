---
name: Online education entitlement boundaries
description: Durable integrity rules for paid online-course snapshots, expiry, consent, suspension, and employee transfers.
---

Every online-course issuance path must use one canonical entitlement builder that snapshots price, duration, access days, extension prices, and server-owned digital-content consent evidence. Expiry begins only when access is granted or payment settles.

**Why:** Protecting only the primary purchase or LMS read path leaves alternate issuance paths, lesson mutations, certificates, bundles, and vouchers able to bypass immutable terms or expiry.

**How to apply:** When adding an enrollment source or LMS operation, reuse the canonical issuance and current-entitlement checks. Validate explicit consent and policy against the exact locked terms before any issuance write. Pure-online courses do not use session/operational-booking flows. After issuance, classify online access from the immutable enrollment snapshot, never the mutable course format. Enforce expiry with database time under the enrollment lock for reads, writes, transfers, certificates, and destructive content checks. Physical content deletion and center shutdown must serialize with ownership and paid issuance, then reject while any paid active/completed entitlement is current; archive, unpublish, and ordinary suspension remain non-destructive.