# Local destructive database suite

Run a database-destructive command from the repository root with:

```sh
pnpm --filter @workspace/scripts exec tsx src/run-destructive-test.ts -- <command...>
```

The command after `--` runs with the repository root as its working directory.
For example:

```sh
pnpm --filter @workspace/scripts exec tsx src/run-destructive-test.ts -- \
  pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/src/lib/seed.test.ts
```

The runner does not read or connect to an ambient `DATABASE_URL`. It creates and
owns a temporary PostgreSQL 16 cluster, obtains that cluster's system identity,
and applies the complete migration manifest through the migration runner with
the identity declared. Only then does it start the requested command.
Production and deployment runtime indicators are checked and refused before
the runner sanitizes its local test environment or invokes `initdb`.

For the child command, `DATABASE_URL`, `LUMERA_DISPOSABLE_DATABASE`, and
`LUMERA_TEST_DATABASE_URL` are the same exact disposable URL. The database name,
system identifier, and transport are also available as
`LUMERA_TEST_DATABASE_NAME`, `LUMERA_TEST_DATABASE_SYSTEM_IDENTIFIER`, and
`LUMERA_TEST_DATABASE_TRANSPORT` for suites that independently verify target
identity.

The temporary server and data directory are removed after success, command
failure, startup failure, `SIGINT`, `SIGTERM`, or `SIGHUP`. This command is for
local tests only and grants no authorization to use a development, staging, or
production database.