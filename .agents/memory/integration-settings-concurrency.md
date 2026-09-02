---
name: Integration settings concurrency
description: Optimistic concurrency rules for global provider configuration edited by multiple administrators
---
Integration configuration must expose an opaque provider version with the values
that version represents, from the same database snapshot. Every browser save
must send that version, and the server must serialize saves per provider before
comparing it and advancing it atomically.

**Why:** A token fetched separately from the displayed rows can represent a newer
save than the form itself, allowing a stale page to pass its precondition and
overwrite the newer configuration. Row locks alone also do not protect two
first saves when no provider rows exist yet.

**How to apply:** Keep provider metadata out of client-facing configuration
values. When changing provider save behavior, preserve the all-rows snapshot,
provider-scoped transaction lock, pre-write conflict check, and structured 409
response; do not update webhook-health metadata on a rejected configuration
save.