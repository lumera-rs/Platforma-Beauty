---
name: pnpm workspace config preservation
description: Avoid project-level pnpm config commands that rewrite the workspace manifest and disturb lockfile catalogs.
---

Do not use project-level `pnpm config set` as a temporary workaround in this workspace. It can reserialize `pnpm-workspace.yaml`, remove comments, reorder overrides, and cause the next lockfile update to drop catalog metadata.

**Why:** A temporary workspace-root installation setting rewrote the manifest and produced broad unrelated diffs plus a malformed or incomplete lockfile.

**How to apply:** Preserve the checked-in workspace manifest exactly. Prefer the package-management integration; if root-workspace behavior blocks it, choose a package-local dependency or make the smallest explicit manifest change before regenerating the lockfile.