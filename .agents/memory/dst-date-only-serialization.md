---
name: DST date-only serialization
description: Why date-only browser selections need local-component serialization and a spring-forward regression
---

**Rule:** Serialize a browser-selected date-only value from its local year, month, and day components rather than its UTC ISO date. Test a positive-offset timezone near local midnight on a spring-forward date.

**Why:** In Europe/Belgrade, early local time on the 2026-03-29 spring-forward day is still on March 28 in UTC. ISO-date serialization would send the previous calendar date even though the owner selected March 29.

**How to apply:** For calendar filters and URL query parameters, keep the selected local calendar day through client serialization, then let the API construct inclusive UTC-midnight boundaries. Include at least one browser or timezone-pinned test around each DST direction.