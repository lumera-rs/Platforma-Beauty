---
name: Published enum renames
description: Safe sequencing for renaming PostgreSQL enum labels through Replit's development-to-production Publish diff.
---

When production rows still use an obsolete PostgreSQL enum label, do not make the first Publish diff recreate the enum without that label. Use an additive compatibility phase that preserves the production labels and ordering while appending the replacement label. Remove the obsolete label only after production rows have been converted and verified.

**Why:** A drop-and-recreate diff casts existing values into the replacement enum. The cast fails before the application can start if any production row still contains the removed label.

**How to apply:** Keep both labels temporarily in the development schema source, preserve the production enum order, append the new label, and publish. After the normal application-owned reconciliation has converted legacy rows, verify production read-only, remove the old label from development, and publish the cleanup separately.