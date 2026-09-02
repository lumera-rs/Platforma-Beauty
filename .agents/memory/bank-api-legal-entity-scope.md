---
name: Bank API legal-entity scope
description: When a bank API specification is sufficient evidence for implementing an automated statement adapter.
---

A bank API contract is valid only when official documentation ties the exact product and endpoints to the relevant local bank legal entity and customer agreement. Group marketplaces, another country’s PSD2 portal, and reverse-engineered clients are not substitutes.

**Why:** Raiffeisen Serbia publicly mentions API/H2H services, while the detailed public developer material belongs to other RBI entities and does not establish the Serbian product’s grant, endpoints, scopes, pagination, date limits, or transaction identity.

**How to apply:** Before enabling automatic statements, require the local product specification and verify auth, token and statement endpoints, scopes, pagination, time range, stable transaction ID, environments, and security requirements. Keep the adapter and sync unavailable until all are confirmed.