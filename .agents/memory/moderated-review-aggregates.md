---
name: Moderated review aggregates
description: Keeping public salon review metrics consistent when administrators remove reviews.
---

Any moderation action that removes a review from public visibility must recompute the salon's persisted public rating and review count in the same salon-locked transaction.

**Why:** The public salon response filters hidden reviews but displays stored aggregate fields; changing only the review record can leave customers seeing counts or ratings that no longer describe the visible review list.

**How to apply:** Treat permanent deletion and visibility changes as public-review mutations. Serialize each mutation per salon, recalculate from the remaining visible reviews, and cover the customer-facing response after a moderator action.