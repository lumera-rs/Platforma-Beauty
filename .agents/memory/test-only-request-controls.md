---
name: Test-only request controls
description: Durable enforcement rules for HTTP inputs used only by test and diagnostic harnesses.
---

Every test-only HTTP input must use a transport-neutral declaration and shared reader. Static repository checks must understand guarded scopes and request-derived aliases; proximity regexes are formatting-sensitive and are not a release boundary.

**Why:** Headers are visible before parsing, but cookies and bodies appear only after their parsers, while route parameters appear only after route matching. A single early middleware silently misses those transports.

**How to apply:** Deny observable controls both before and after parsers, and make the shared reader trigger the centralized denial path for route-bound values. Test all transports through a real Express pipeline, including separated guards, aliases, and destructuring.