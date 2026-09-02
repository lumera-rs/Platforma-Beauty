---
name: Review photo privacy
description: Privacy rules for showing customer profile photos beside public salon reviews.
---

Customer profile photos are private by default. A public review may expose a reviewer’s avatar only after explicit per-review consent, and the reviewer must be able to revoke that consent even if their old visit is no longer present in the current eligibility data.

**Why:** Consent must be affirmative and reversible; a changed appointment history must not strand a customer’s public photo.

**How to apply:** Gate public review avatar fields on the persisted consent value, default new values to private, and keep the owner’s existing review editable independently from eligibility needed to create a new review.