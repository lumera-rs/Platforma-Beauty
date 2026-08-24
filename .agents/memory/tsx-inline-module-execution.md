---
name: tsx inline module execution
description: Reliable execution mode for generated TypeScript snippets that use top-level await.
---

Run generated TypeScript with top-level await through `tsx` stdin rather than eval. Avoid adding `--input-type=module` to `tsx -e` as a workaround.

**Why:** `tsx -e` transforms eval input as CommonJS in this workspace. Although `--input-type=module` fixes that transform, the flag can be inherited by imported loader contexts and fail with `ERR_INPUT_TYPE_NOT_ALLOWED`.

**How to apply:** For shell-generated TypeScript, pipe or heredoc the snippet to `tsx -`. Keep `tsx -e` only for snippets that do not require top-level await.