---
name: Active salon media publishing
description: Conditions for making managed salon cover and gallery assets publicly readable.
---

Managed salon media becomes public only when the salon is active and the referenced asset is owner-uploaded, has the exact salon-profile or salon-gallery scope, is unreserved, and is unclaimed or already bound to that salon.

**Why:** Public discovery can begin immediately when an administrator activates a salon, so waiting for a later startup audit can expose broken 403 image references.

**How to apply:** Run the guarded reconciliation in the same transaction as both salon-owner attachment and admin activation. Never broaden the rule to arbitrary managed URLs or treatment/customer media.