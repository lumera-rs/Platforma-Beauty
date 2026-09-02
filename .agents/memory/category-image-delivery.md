---
name: Category image delivery
description: Stable public delivery pattern for admin-managed service category images.
---

Category-image records must store a stable application URL rather than a signed object-storage URL. Uploads may use short-lived signed PUT URLs, and the stable application endpoint may in turn obtain fresh signed read access.

**Why:** Signed storage URLs expire; persisting them would silently break the category cards after their validity window.

**How to apply:** Keep the order of public discovery imagery as a qualifying salon gallery image, then the admin fallback image, then the neutral general fallback. Treat demo placeholders as non-gallery imagery.