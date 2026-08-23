---
name: Rebase and generated codegen output
description: Generated OpenAPI client/Zod files must be regenerated after a rebase fully completes, not only during conflict resolution.
---

Git auto-merges the Orval-generated files (lib/api-zod, lib/api-client-react) during task rebases without raising conflicts, but the merged output can be internally scrambled — e.g. Zod min/max/multipleOf consts referenced before their declarations (TS2448 + a real temporal-dead-zone crash at module load). Regenerating while the rebase is still stopped on conflicts is not sufficient: the finished rebase can still end up with the scrambled version committed.

**Why:** A completion validation run failed with 20 TDZ typecheck errors in generated Zod output even though codegen + typecheck had passed mid-rebase, immediately before continuing the rebase.

**How to apply:** After any rebase or merge that touched `lib/api-spec/openapi.yaml` or generated client files, once the rebase is fully complete re-run `pnpm --filter @workspace/api-spec run codegen` and the full `pnpm run typecheck` before marking work done. Never hand-merge the generated files.
