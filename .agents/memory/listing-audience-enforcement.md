---
name: Listing audience enforcement
description: Cross-endpoint rule for hiding public marketplace listings from a restricted audience.
---

An audience restriction on a public listing must be enforced consistently across catalog searches, direct detail reads, saved-listing writes and retrieval, reports, contacts, historical inbox/notification reads, and every other action that accepts a listing or linked subresource ID.

**Why:** Filtering only catalog and detail routes leaves broken-access-control paths: a caller who knows an ID can bookmark, retrieve, interact with, or reopen historical linked data for a listing that should appear nonexistent to that audience.

**How to apply:** Centralize the visibility predicate and reuse it in every public lifecycle and linked-subresource query. Regression fixtures should use known IDs and include both a forbidden competing listing and a visible control listing.