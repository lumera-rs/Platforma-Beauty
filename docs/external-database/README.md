# External database application pool

## Task 4 decision and release boundary

Task 4 selects `LUMERA_DATABASE_URL` as the application runtime override.
Selection is deterministic:

1. If `LUMERA_DATABASE_URL` is non-empty, use it.
2. Otherwise, in a non-deployment runtime only, use `DATABASE_URL`.
3. Otherwise fail before constructing the pool.

A runtime is a deployment when any of these three markers is present:
`NODE_ENV=production`, `REPLIT_DEPLOYMENT=1`, or `REPL_DEPLOYMENT=1`.
Deployment runtimes refuse to fall back to `DATABASE_URL`; they require
`LUMERA_DATABASE_URL`. This lets development and disposable test harnesses keep
their established `DATABASE_URL` contract while making the deployment target an
explicit choice.

This preparation does **not** move production. Production must remain on its
current target until Phase 8 authorizes and performs the deployment change.
Neither this document nor the Task 4 pool code authorizes a secret update,
deployment, migration, or database operation.

## Direct endpoint and safe failure policy

The selected value must be a valid `postgres:` or `postgresql:` URL. For Neon,
the effective host is checked using the driver's precedence: a non-empty
`?host=` overrides the authority hostname. Neon hosts with any `-pooler` label
are refused before pool construction. The application has long-lived
`LISTEN` clients, and `LISTEN` does not work through a Neon pooler endpoint, so
`LUMERA_DATABASE_URL` must name a direct Neon endpoint.

Configuration failures identify only the responsible variable:
`LUMERA_DATABASE_URL`, `DATABASE_URL`, or `DB_STMT_TIMEOUT_MS`. Errors never
include the selected URL, hostname, username, password, or raw driver error.
The idle-client handler likewise emits only a fixed redacted message.

## Pool initialization

`lib/db/src/index.ts` is the sole running-application `pg.Pool` constructor.
It selects and validates the URL before `new Pool`. Drizzle is then created over
that same exported pool, so direct pool queries, Drizzle queries and Drizzle
transactions share one connection boundary.

Every newly established client runs and awaits:

```sql
SELECT set_config('statement_timeout', $1, false)
```

The value is `DB_STMT_TIMEOUT_MS`, defaulting to 30,000 ms (30 seconds).
Initialization is the pool's awaited per-new-connection hook, not a PostgreSQL
startup parameter and not a one-time query. A client is unavailable to callers
until its server-side default has been applied; initialization failure rejects
that client with a credential-free error.

## Complete running-application connection census

All running connection paths converge on the singleton exported by
`lib/db/src/index.ts`:

- **Pool constructor:** `lib/db/src/index.ts` is the only application pool
  constructor and exports `pool`, `db`, lifecycle helpers, and pool statistics.
- **Drizzle:** `db = drizzle(pool, ...)` uses that pool for ordinary queries and
  transactions.
- **Startup readiness:** `artifacts/api-server/src/index.ts` passes the same
  pool to `assertDatabaseMigrationReady` before startup mutation, listeners,
  schedulers, or HTTP serving. This is a real readiness query path, not a second
  pool.
- **Catalog cache listener:** `artifacts/api-server/src/lib/catalog-cache.ts`
  checks out a dedicated client from the shared pool and issues
  `LISTEN lumera_catalog_cache_invalidation`; cache notifications use the same
  pool.
- **Salon notification listener:**
  `artifacts/api-server/src/lib/salon-notification-events.ts` checks out a
  dedicated client from the shared pool and issues
  `LISTEN lumera_salon_notification_updates`; publication and reconnect checks
  also use the same pool.
- **Sessions:** there is no `connect-pg-simple` or separate session-store pool.
  `artifacts/api-server/src/lib/auth.ts` persists application sessions through
  the shared Drizzle `db` (and accepts an existing Drizzle transaction for the
  transactional case).
- **Health route:** `artifacts/api-server/src/routes/health.ts` reports
  in-memory shared-pool counters (`total`, `idle`, `waiting`, and related
  scheduler/statement metrics). `/healthz` does **not** issue a database probe.

No running API connection point creates an independent pool.

## Drizzle Kit and migrations are separate

`lib/db/drizzle.config.ts` is standalone Drizzle Kit CLI configuration. It still
reads `DATABASE_URL`, and its `push` / `push-force` package commands are
unchanged. The application does not import this file, so it is not an
application runtime connection point and Task 4 does not alter its behavior.

The numbered migration runner also remains an explicit, separate operator
action. API startup only checks migration readiness; it does not apply or
repair migrations. The pool change must not be treated as permission to run the
migration CLI, Drizzle Kit, or any production database command.

## Verification commands

Database-free focused unit tests:

```sh
pnpm --filter @workspace/db run test:pool-runtime
```

Application-pool integration on a runner-owned disposable PostgreSQL cluster:

```sh
pnpm run test:external-database:integration
```

That root script delegates to the existing destructive runner and executes
`scripts/src/external-database-pool.integration.test.ts` inside the owned
cluster.

Existing database-only standards checks on a separate runner-owned disposable
cluster:

```sh
pnpm --filter @workspace/scripts exec tsx src/run-destructive-test.ts -- pnpm --filter @workspace/scripts exec tsx src/test-backend-standards.ts --database-only
```

Owner-authorized direct-Neon and pooler-refusal proof harnesses:

```sh
pnpm --filter @workspace/scripts exec tsx src/external-database-pool.proof.ts direct
pnpm --filter @workspace/scripts exec tsx src/external-database-pool.proof.ts pooler-refusal
```

The proof commands require their dedicated authorized test secrets. They must
not be redirected to development or production. The direct proof uses read-only
transactions and rolls them back; the pooler proof verifies refusal before a
network connection. Recorded outcomes and safe output are in `verification.md`;
mutation-test evidence is in `mutations.md`.