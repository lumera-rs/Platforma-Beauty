---
name: Education course review aggregates
description: Prevents single-course and list responses from drifting on required review aggregate fields.
---

Every Education course response serializer must receive the same published-review aggregate enrichment before generated response-contract parsing. Missing aggregates resolve explicitly to numeric zero values.

**Why:** List responses can appear correct while single-course routes fail at runtime when required `rating` and `reviewCount` fields are added only by batch enrichment. Stored legacy ratings also do not represent the moderated published-review set.

**How to apply:** Reuse one aggregate projection for public, private, list, wishlist, featured, and related course views; test single-course routes through generated response schemas with zero, published, and non-published reviews.