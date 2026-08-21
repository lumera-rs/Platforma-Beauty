---
name: Generated client declarations
description: Workspace typecheck behavior when generated API client source and emitted declarations drift apart.
---

When a leaf artifact reports that generated API hooks are missing even though the hooks exist in the API client source, rebuild the composite API client declarations before changing application imports.

**Why:** Leaf project references can resolve emitted declaration output that is older than the generated TypeScript source, producing misleading missing-export errors.

**How to apply:** Run the API client composite build (or the repository’s canonical library typecheck) and then rerun the affected artifact typecheck; do not duplicate generated hooks manually.