---
name: Browser fixture failure classification
description: Distinguishing invalid intercepted API fixtures from application routing or authorization failures.
---

Classify the earliest API-fixture validation error before interpreting subsequent browser URL, role, or timeout assertions.

**Why:** A response validator can throw inside a browser route handler before the mocked identity reaches the application. Later attempts may show only a redirect timeout or an unchanged URL, making a fixture defect look like an authorization regression.

**How to apply:** Preserve the first failure output, compare the fixture with the canonical response contract, and correct only a demonstrably invalid fixture. Keep response validation and all interaction assertions intact; rerun the affected journey before attributing remaining failures to application behavior.