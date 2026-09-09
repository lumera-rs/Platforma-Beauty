---
name: Release-chain merge safety
description: How to protect the shared release-chain regression suite during concurrent CI timing work.
---

Treat changes to the shared release-chain regression suite as conflict-prone when several CI timing tasks are active, and verify the rebased result rather than relying only on the pre-rebase working tree.

**Why:** Concurrent changes can preserve syntactically valid patch fragments while collapsing test boundaries or moving helpers into another test during replay.

**How to apply:** Keep additions narrowly anchored, place shared helpers at module scope, and run both the scripts typecheck and the complete release-chain suite after the final rebase.