---
name: Appointment contact privacy
description: Public salon address policy versus booking-protected contact and coordinate data.
---

Active public salon profiles may expose the salon-entered postal address and entrance details anonymously. This is an explicit owner policy change, not permission to publish phone, email, or coordinates. Discovery cards need not gain the detail page's address fields. If an address-hiding preference is introduced, enforce it consistently in public responses, SSR and structured data.

**Why:** The owner explicitly made the full salon address public while retaining separate contact privacy. Reapplying the former blanket street-address restriction would undo that decision.

**How to apply:** Use the public profile's approved fields, not arbitrary private salon records. Google Maps queries and PostalAddress use only street/number, postal code, city and country, never entrance/intercom/floor/apartment or coordinates. Phone requires an explicit public permission; absence of such a flag is not consent. Protected appointment contacts still require customer ownership and a `pending`, `confirmed` or `completed` appointment.

Inactive public salon API responses are deliberately limited to name and inactive state, even though their public HTML page needs a city-listing link.

**Why:** The owner required inactive salons to retain a noindex page without restoring the active profile's location/contact payload. Extending the public DTO with city just to simplify SSR would break that stricter boundary.

**How to apply:** Obtain only the city through a server-only read-only projection for the HTML link; never reuse a private full-profile response. Keep tests on injected data or owned disposable clusters, and treat an unavailable city lookup as unavailable evidence rather than a missing salon.