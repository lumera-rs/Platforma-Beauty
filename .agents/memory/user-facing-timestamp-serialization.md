---
name: User-facing timestamp serialization
description: Safe handling of malformed database timestamps across duplicated list serializers.
---

Every public, owner, and end-user list DTO must serialize database timestamps through the shared safe normalizer, including nested rows. Audit both single-record assemblers and separate batch assemblers.

**Why:** Parallel list and detail serializers can drift. Protecting one path leaves another able to throw on `Invalid Date`, causing one damaged field to abort an otherwise usable multi-row response.

**How to apply:** When adding or changing a list, review every selected timestamp in the top-level row and nested arrays. Regression coverage should prove the damaged field becomes `null`, sibling fields survive, and later rows remain available.