# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm run test:query-budgets` — guard set-based marketplace list endpoints against N+1 regressions
- `pnpm run test:catalog-cache && pnpm run test:data-retention` — verify catalog invalidation and archival retention
- `pnpm run test:admin-input-validation` — run the negative admin-input matrix against the active development API
- `scripts/post-merge.sh` — automatically installs dependencies and applies the Drizzle schema to the development database after task merges
- Replit Publish applies the development-to-production schema diff; never run database DDL from API startup or deployment commands
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- `ADMIN` can read the full admin workspace and perform day-to-day salon/review moderation. Only `SUPER_ADMIN` can change user roles/statuses, loyalty rules, or subscription-plan definitions.
- Add database indexes for demonstrated filter, join, ordering, and retention paths; avoid speculative indexes that only increase write cost.
- List endpoints must load related records with set-based queries. Add or extend a fixed SQL query-budget regression whenever optimizing a list path so N+1 behavior cannot silently return.
- Stable public catalogs use a 10-minute process-local cache-aside layer with PostgreSQL `LISTEN/NOTIFY` invalidation and request coalescing. Do not cache user-specific or authorization-sensitive responses.
- Admin writes are validated at the OpenAPI/Zod boundary, in route-level business rules, and in the form before submission. Reject empty PATCH payloads and return structured `400`/`409` errors.
- Retention jobs archive eligible read/terminal records before deleting live rows, using bounded batches, an advisory lock, row locking, and one transaction per batch.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Keep generated API schemas compatible with Zod v3: represent whole numbers as `type: number` plus `multipleOf: 1`, then run codegen and its duplicate-export/EOF normalization checks.
- Catalog mutations must invalidate every affected cache namespace; PostgreSQL notifications are cross-process wakeups, while the database remains the source of truth.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
