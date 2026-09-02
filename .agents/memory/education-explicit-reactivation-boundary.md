---
name: Education explicit reactivation boundary
description: Payment and contract changes must not silently reactivate a deactivated Education center.
---

A deactivated Education center remains suspended when a renewal payment is settled or a custom contract is configured. Reactivation is a separate, explicit transition: a valid paid period must exist, the center must first choose which suspended courses remain active when the frozen limit requires a choice, and a super administrator must supply an audited reason.

**Why:** Allowing payment settlement or contract replacement to set the subscription active would bypass the center's course choice, republish arbitrary courses, and omit the dedicated reactivation audit.

**How to apply:** Any path that changes Education subscription terms or settles a subscription obligation must preserve suspended/deactivated state. Keep subscription-before-obligation lock ordering, and publish courses only inside the guarded reactivation transaction.