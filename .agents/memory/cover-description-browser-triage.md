---
name: Cover-description browser triage
description: Browser regression fixtures should reproduce visible prerequisites and publication lifecycle before judging metadata failures.
---

For image-description editor regressions, first inspect the browser’s visible validation messages and actual request/response before changing application rules or test expectations. A successful first save does not prove the reload-and-clear path: the read response may omit saved fields and leave the reopened form invalid. Public metadata checks must also respect moderation after an owner edit; an owner-visible listing need not be publicly visible until reapproved.

**Why:** Multiple superficially similar failures came from different layers: invalid fixture media, missing visible required values, blank optional numeric inputs, incomplete read responses, and a legitimate moderation transition. Treating them as one timeout or bypassing the form would have hidden actual user-facing defects.

**How to apply:** Reproduce both saves through the visible UI, use real managed media where the public image is asserted, and perform the normal moderation step before checking public metadata. Keep precise fallback expectations for content that intentionally has no city or image.