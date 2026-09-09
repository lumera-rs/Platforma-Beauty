---
name: Post-merge semantic integrity
description: Verification needed when task merges splice valid fragments into invalid TypeScript structures
---

After a suspicious task merge, treat the post-merge schema script and workflow reconciliation as necessary but insufficient. Run the affected package typecheck and build before trusting the workspace.

**Why:** A merge can duplicate declarations or place valid handler fragments in the wrong scope while dependency installation and schema checks still pass.

**How to apply:** When post-merge setup or a workflow fails immediately after a merge, inspect the first compiler error, compare affected files with the last known clean revision, repair only corrupted blocks, then verify typecheck, build, focused regressions, and workflow startup.