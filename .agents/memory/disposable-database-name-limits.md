---
name: Disposable database name limits
description: PostgreSQL identifier truncation and safe naming for dynamically created test databases.
---

Keep every dynamically generated disposable PostgreSQL database name at or below PostgreSQL's 63-character identifier limit, including its per-run suffix.

**Why:** PostgreSQL truncates overlong identifiers without making the caller's intended uniqueness part of the stored name, so two test databases can collide even when their full generated strings differ.

**How to apply:** Budget the prefix together with process and random suffixes before creating lifecycle fixtures or isolated harness databases; retain enough unique suffix after shortening the prefix.