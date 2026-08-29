---
name: Paginated fixture assertions
description: How to keep strict public-list filter regressions reliable after directory growth or pagination changes.
---

When a regression test asserts that a particular fixture appears in a paginated public list, isolate the fixture through supported query inputs or explicitly request a page size that is guaranteed to include the controlled dataset. Keep separate assertions that every returned row satisfies the requested filter.

**Why:** The default page can fill with unrelated valid rows as seeded data grows, making a correct filter fail a fixture-membership assertion. Removing the membership assertion or loosening the filter check would hide real regressions instead.

**How to apply:** Use this rule for public directory and search tests that combine universal result assertions with positive and negative fixture membership checks. Match result caps before comparing two paginated or capped endpoints for exact parity. Query-count comparisons must also keep feature topology equivalent on both sides so conditional resource or relation loads are not mistaken for scale-dependent growth.