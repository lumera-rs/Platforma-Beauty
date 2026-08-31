---
name: Mainline merge damage
description: The main branch can itself be broken by concurrent semantic auto-merges; conflict resolution must repair, not just resolve.
---

The "ours" (main) side of a task rebase is not guaranteed to compile: concurrent semantic auto-merges have shipped main with missing helper functions, duplicate import lines, missing type imports, and calls using a superseded function signature.

**Why:** Merge tooling resolves conflicts function-by-function, so one task's refactor (e.g. cutoff → window-based filtering) can land while another task's caller of the old signature also lands; typecheck is not re-run on main after every merge.

**How to apply:** After resolving conflict markers, inspect the complete working file against both index stages; a tool-reported cosmetic header conflict can leave duplicated or interleaved bodies outside the visible markers. Restore the coherent side, reapply the required sibling changes, then run the full typecheck and affected suite *before* continuing the merge. For browser specs, also run Playwright discovery (`--list`): typechecking cannot detect a dangling `finally` or duplicate test title. Treat errors located in "ours" code as damage to repair (recover deleted helpers from `git log -S`, or adopt main's newer replacement and delete the stale helper). Source-contract tests can also lag a merged helper extraction: verify the canonical helper and update the test to assert delegation plus the helper-owned invariant rather than restoring duplicated inline behavior. Expect multiple conflict rounds when sibling tasks keep merging; re-verify after every round and after post-rebase codegen. Semantics chosen for aggregates (e.g. which statuses count as "realized") must be applied consistently to every sibling surface main added meanwhile (previous-window trends, drill-down lists), or completion review will reject the merge for cross-surface disagreement.
