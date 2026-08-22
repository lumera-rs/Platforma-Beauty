## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run bundle:check` — production frontend build plus manifest-based bundle budget validation
- `pnpm run test:monitoring` — slow-API sanitization/threshold and safe-error response regressions
- `pnpm run validate:release` — full release gate, including bundle, monitoring, DB/query/cache/archive/admin regressions
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
- Every new foreign key needs an index whose leading columns cover that key. Frequently used filter, join, ordering, and retention combinations need a deliberate composite or partial index; avoid speculative indexes that only increase write cost.
- List handlers must filter, sort, aggregate, and paginate in PostgreSQL. Do not issue database reads inside item loops or load an unbounded table merely to filter or slice it in application memory. Add or extend a fixed SQL query-budget regression for critical list paths.
- Stable shared catalogs use the typed server cache with a 5–15 minute TTL and request coalescing. Invalidate matching tags locally and through PostgreSQL only after a successful write/commit. Never cache personalized responses, carts, notifications, or live appointment availability.
- API processes use the single exported PostgreSQL pool. New modules must not construct their own pool.
- Admin mutations require strict generated request validation plus business-invariant checks, transactions for multi-write changes, and structured expected 4xx/409 errors. Admin numeric fields keep raw text until explicit validation and must remain editable after a failed request.
- Retention jobs archive eligible read/terminal records before deleting live rows, using bounded batches, an advisory lock, row locking, and one transaction per batch.
- Frontend route pages stay behind `React.lazy` + `Suspense`; keep only global providers, the router, guards, and the route fallback in the eager entry graph.
- Text inputs that trigger server requests or expensive filtering use the shared 300 ms debounce. Reset pagination when a debounced criterion changes; selects, checkboxes, and other discrete filters remain immediate.
- Favorites, B2B cart changes, and read-notification actions use TanStack Query optimistic updates: cancel matching reads, snapshot and patch every affected cache, roll back on error, then reconcile with precise invalidation. Checkout, payment, escrow, and other financial actions remain server-authoritative.
- Slow API events contain only request ID, method, query-free pathname, status, and duration. Process-level failures use the shared logger without request bodies, query values, auth/cookies, raw provider responses, database details, or arbitrary error payloads.
- Frontend bundle budgets are enforced from the Vite manifest: entry ≤200 KB gzip, largest lazy chunk ≤100 KB gzip, total JS ≤750 KB gzip, and at least 25 chunks. Deliberate budget changes require a measured review.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Keep generated API schemas compatible with Zod v3: represent whole numbers as `type: number` plus `multipleOf: 1`, then run codegen and its duplicate-export/EOF normalization checks.
- Catalog mutations must invalidate every affected cache namespace; PostgreSQL notifications are cross-process wakeups, while the database remains the source of truth.
- Any schema/query/cache/admin mutation change must keep `pnpm run test:backend-standards` and `pnpm run validate:release` passing.
- New frontend routes, text filters, optimistic mutations, or monitoring changes must keep `pnpm run bundle:check`, `pnpm run test:monitoring`, and `pnpm run validate:release` passing.
## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

# LUMERA

Marketplace for beauty and wellness customers, salons, employees, B2B commerce, and education providers.
