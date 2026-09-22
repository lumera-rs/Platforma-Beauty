---
name: SSR robots authority
description: Why missing client data must not tighten a server-indexed page, and how tests must distinguish SSR from SPA navigation.
---

Preserve the server's exact robots decision on its normalized original URL while client data is loading, missing, or failed. Only a definitive successful response may tighten it; never loosen server noindex. Other SPA URLs have no server decision.

**Why:** Crawlers render fresh URLs and may capture the temporary client state. A failed refetch is not evidence against data the server already used to permit indexing. An earlier requirement incorrectly treated tightening during loading as safe; the owner explicitly corrected it.

**How to apply:** Separate successful response evidence from mere absence of results. Test actual DOM metadata wiring with distinct staging and server-indexed fake documents, and mutation-test omitted or swapped server/previous decisions; pure helper tests and staging-only assertions can mask broken wiring.