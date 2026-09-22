---
name: Appointment contact privacy
description: Public salon address policy versus booking-protected contact and coordinate data.
---

Active public salon profiles may expose the salon-entered postal address and entrance details anonymously. This is an explicit owner policy change, not permission to publish phone, email, or coordinates. Discovery cards need not gain the detail page's address fields. If an address-hiding preference is introduced, enforce it consistently in public responses, SSR and structured data.

**Why:** The owner explicitly made the full salon address public while retaining separate contact privacy. Reapplying the former blanket street-address restriction would undo that decision.

**How to apply:** Use the public profile's approved fields, not arbitrary private salon records. Google Maps queries and PostalAddress use only street/number, postal code, city and country, never entrance/intercom/floor/apartment or coordinates. Phone requires an explicit public permission; absence of such a flag is not consent. Protected appointment contacts still require customer ownership and a `pending`, `confirmed` or `completed` appointment.