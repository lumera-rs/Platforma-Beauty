---
name: Generated client declarations
description: Workspace typecheck behavior when generated API client source and emitted declarations drift apart.
---

When a leaf artifact reports that generated API hooks are missing even though the hooks exist in the API client source, rebuild the composite API client declarations before changing application imports.

**Why:** Leaf project references can resolve emitted declaration output that is older than the generated TypeScript source, producing misleading missing-export errors.

**How to apply:** Run the API client composite build (or the repository’s canonical library typecheck) and then rerun the affected artifact typecheck; do not duplicate generated hooks manually. When a leaf check must run independently, force-build its referenced composite client first: incremental `.tsbuildinfo` can otherwise report a project current even when ignored declarations are missing.
Additionally: when a task rebase merges another task's OpenAPI spec changes, git may textually merge the generated client files into an inconsistent state (typecheck errors in pages untouched by either task). Rerun the spec codegen from the merged openapi.yaml instead of hand-fixing generated output, then rerun leaf typechecks.
The same declaration drift can affect the generated Zod package: rebuild the referenced composite schema package before treating a source-visible response schema as missing from a leaf artifact.
