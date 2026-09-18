---
name: Lifecycle verification evidence
description: Preserve phase evidence and distinguish interrupted runs from completed validation.
---

An interrupted lifecycle run cannot establish full-suite success, even when the changed guard subtest has already passed.

**Why:** A workspace restart terminated a disposable PostgreSQL lifecycle run and erased its /tmp logs. A separate intermittent phase timeout also lost its detailed trace during fixture cleanup, preventing a defensible causal attribution.

**How to apply:** Retain sanitized phase diagnostics before fixture cleanup and preserve long-run evidence outside temporary storage when needed. Report observed subtest results separately from missing full-suite results; do not attribute an unexplained timeout to concurrent load without timing evidence.

Registered Git worktree metadata is not evidence that its working files or unstaged changes still exist.

**Why:** An external worktree directory disappeared while its branch, index, and registration survived. The index could recover committed files, but not the previously verified unstaged patch.

**How to apply:** Check the actual worktree before editing. Distinguish user-authorized reconstruction from preservation of original files; use a retained exact patch and hash the reconstructed protected files before further changes.