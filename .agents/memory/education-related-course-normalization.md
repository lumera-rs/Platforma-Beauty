---
name: Education related-course normalization
description: Keeps related-course matching consistent across domain ranking and endpoint candidate selection.
---

Related-course matching must use one canonical Unicode-aware taxonomy normalizer from domain tiering through endpoint filtering. Apply the requested result limit only after normalized matching and global tier/order comparison.

**Why:** Exact JSON or SQL tag comparisons can silently disagree with domain semantics for case, repeated whitespace, and Unicode-equivalent text. Limiting the candidate query first can also hide a valid tag match on a later page.

**How to apply:** When related-course matching or ranking changes, reuse the canonical normalizer, preserve cross-subcategory tag matches, scan candidates in bounded batches, and retain only the globally best requested results.