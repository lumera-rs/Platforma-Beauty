---
name: URL numeric filter absence
description: Missing numeric query parameters must remain absent instead of becoming zero.
---

Treat a missing or blank numeric URL parameter as `undefined`; only parse it after checking the raw string.

**Why:** `Number(URLSearchParams.get(key))` turns a missing parameter (`null`) into `0`. That can silently activate an exact-zero filter and hide records whose value is null or nonzero while the UI appears unfiltered.

**How to apply:** For every query-backed numeric filter, check `raw === null || raw.trim() === ""` first, then parse and validate the number. Include a browser fixture whose numeric field is null in the default-list regression test.