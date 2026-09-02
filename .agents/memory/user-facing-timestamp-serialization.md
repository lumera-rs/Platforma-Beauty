---
name: User-facing timestamp serialization
description: Safe handling of malformed database timestamps across user-facing serializers and generated response contracts.
---

Every public, owner, and end-user DTO must serialize database timestamps through the shared safe normalizer, including nested rows. Its authoritative response contract must also declare the field nullable before code generation.

**Why:** Parallel list and detail serializers can drift. Protecting one path leaves another able to throw on `Invalid Date`; additionally, a generated `z.coerce.date()` that is not nullable converts `null` to the Unix epoch instead of preserving the degraded field.

**How to apply:** Review every selected timestamp in list, detail, and mutation responses. Regenerate API clients after nullable contract changes, and test the generated response parser to prove `null` survives while sibling fields and later rows remain available.