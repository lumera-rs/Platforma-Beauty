## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm run validate:release` — full release gate: build + bundle budget + DB/query/cache/archive/admin validation regressions
- `pnpm run bundle:check` — compatibility command for a production frontend build plus the legacy manifest report
- `pnpm run test:bundle-budget` — run the frontend bundle budget gate in isolation (requires a prior build)
- `pnpm run test:frontend-standards && pnpm run test:frontend-interactions` — enforce lazy routes, shared debounce, serialized optimistic updates, and rollback behavior
- `pnpm run test:monitoring` — verify slow-request privacy, safe 500 responses, and fatal-process shutdown handling
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
- Reversible favorites, B2B cart changes, and read-notification actions use serialized optimistic cache updates with exact rollback and server reconciliation. Checkout, payment, escrow, and other financial actions remain server-authoritative.
- Slow API events contain only request ID, method, query-free pathname, status, and duration. Process-level failures use the shared logger without request bodies, query values, auth/cookies, raw provider responses, database details, or arbitrary error payloads.

## Public SEO and discoverability

Every new public-facing page or feature — including marketplace sections, salon pages, shop pages, and category pages — must follow these rules from the start:

- Give each indexable page a unique, useful meta title and description, plus Open Graph tags. Never ship generic placeholder SEO text.
- Use real `<a href>` links for public navigation so crawlers and users can follow the site structure without JavaScript. JavaScript-only navigation remains appropriate for actions, filters, auth redirects, and booking operations.
- Add every eligible public URL to the dynamic `sitemap.xml`. Keep protected, private, query-only, and otherwise non-indexable routes out of the sitemap and mark them `noindex, follow`.
- Serve meaningful server-rendered or prerendered HTML for public pages before the client mounts; do not expose an empty `div#root` shell as the crawler-facing response.
- Keep the production SEO server's public origin and API origin explicitly configured and validated. Do not derive canonical, Open Graph, JSON-LD, or sitemap origins from untrusted host headers in production.

## Frontend performance rules

These rules are enforced by `pnpm run test:bundle-budget` (part of `validate:release`).  Any change that breaks them is a release blocker.

### Bundle budget
- **Initial-entry JS (gzip) ≤ 150 kB.** The pre-split monolith was ~1.52 MB raw; with full route lazy-loading the current baseline is ~120 kB gzip. Budgets were set from an actual production build; do not lower them speculatively.
- **No single JS chunk may exceed 300 kB gzip.** Route lazy-loading distributes the load: the largest lazy chunk today is `salon-profile` at ~62 kB gzip.
- Vite emits a manifest (`dist/public/.vite/manifest.json`) so tooling can identify entry chunks by logical name rather than content hash. Do not disable `build.manifest`.
- `resolve.dedupe: ['react', 'react-dom']` is required in `vite.config.ts`. The budget gate detects React runtime duplication and fails if more than one chunk contains the React internals sentinel.

### New routes
- Every new page added to `App.tsx` **must** use `React.lazy(() => import('./pages/…'))`. Never import a page module eagerly from App.tsx. Route-level code splitting is what keeps the initial entry budget viable.

### Search / filter debounce
- Any text-input that triggers a server query (search boxes, filter fields) **must** debounce at **300 ms** before firing the API call. Do not call live search on every keystroke.

### Optimistic mutations
- Reversible fast actions must update the React Query cache in `onMutate`, retain the exact prior snapshot, restore it in `onError`, and reconcile affected query keys in `onSettled`. Do not optimistically apply financial or otherwise irreversible actions.
- Mutations that can touch the same cache must acquire their shared FIFO mutation queue before taking a snapshot and release it only after reconciliation. Use a shared mutation key to disable related controls while an operation is pending.

### Pino / structured logging
- Slow-path Pino log calls (`logger.warn`, `logger.error`) that include user-provided or row-level data **must** omit sensitive fields (passwords, tokens, PII). Use `redact` in the Pino config or destructure to an explicit allowlist before logging. Never log raw request bodies or full DB row objects at warn/error level.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Keep generated API schemas compatible with Zod v3: represent whole numbers as `type: number` plus `multipleOf: 1`, then run codegen and its duplicate-export/EOF normalization checks.
- Catalog mutations must invalidate every affected cache namespace; PostgreSQL notifications are cross-process wakeups, while the database remains the source of truth.
- Any schema/query/cache/admin mutation change must keep `pnpm run test:backend-standards` and `pnpm run validate:release` passing.
- New frontend routes, text filters, optimistic mutations, or monitoring changes must keep `pnpm run test:frontend-standards`, `pnpm run test:frontend-interactions`, `pnpm run test:monitoring`, and `pnpm run validate:release` passing.
## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

# LUMERA

Marketplace for beauty and wellness customers, salons, employees, B2B commerce, and education providers.
