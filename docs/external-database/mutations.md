# External database pool mutation verification

Verified against `lib/db/src/pool-runtime.ts` and
`lib/db/src/pool-runtime.test.ts`. Each mutant used an independent copy under
`/tmp/external-database-mutations`; no workspace source file was mutated.

Every child test process explicitly removed these ambient connection/runtime
variables:

```text
DATABASE_URL LUMERA_DATABASE_URL LUMERA_TEST_DATABASE_URL
REPLIT_DEPLOYMENT REPL_DEPLOYMENT
PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
```

The focused tests only exercise pure URL-selection/validation code or a fake
client's `query` method. They make no database connection.

## Results

| Mutant | Scratch copy | Focused test | Baseline | Mutant |
| --- | --- | --- | --- | --- |
| Deployment falls back to `DATABASE_URL` | `/tmp/external-database-mutations/deployment-fallback` | `deployment runtimes require LUMERA_DATABASE_URL` | pass 1, fail 0 | exit 1; pass 0, fail 1 |
| Accept a Neon pooler host | `/tmp/external-database-mutations/accept-neon-pooler` | `Neon pooler URLs are refused without exposing connection details` | pass 1, fail 0 | exit 1; pass 0, fail 1 |
| Drop per-new-connection server timeout | `/tmp/external-database-mutations/drop-new-client-timeout` | `new-client initializer awaits timeout setup for every client` | pass 1, fail 0 | exit 1; pass 0, fail 1 |
| Include the selected URL in an error | `/tmp/external-database-mutations/include-url-in-error` | `Neon pooler URLs are refused without exposing connection details` | pass 1, fail 0 | exit 1; pass 0, fail 1 |

From each independent scratch root, the command shape used for its baseline and
mutated copy was:

```sh
env -u DATABASE_URL -u LUMERA_DATABASE_URL -u LUMERA_TEST_DATABASE_URL \
  -u REPLIT_DEPLOYMENT -u REPL_DEPLOYMENT \
  -u PGHOST -u PGPORT -u PGDATABASE -u PGUSER -u PGPASSWORD \
  node --experimental-strip-types --test \
  --test-name-pattern="<focused test name>" lib/db/src/pool-runtime.test.ts
```

## Mutation details and failure evidence

### 1. Deployment fallback to `DATABASE_URL`

Scratch `src/pool-runtime.ts:18`:

```diff
-  if (isProductionOrDeploymentRuntime(environment)) {
+  if (false && isProductionOrDeploymentRuntime(environment)) {
```

This allows the existing `DATABASE_URL` branch to run in a deployment. The
focused test loaded and ran, then failed at `pool-runtime.test.ts:33` with
`AssertionError [ERR_ASSERTION]: Missing expected exception`; the expected
exception was `LUMERA_DATABASE_URL must be set in deployment runtimes.` This is
the intended behavioral failure, not a syntax or module-loading failure.

Evidence files:
`/tmp/external-database-mutations/deployment-fallback/baseline.txt` and
`/tmp/external-database-mutations/deployment-fallback/mutant.txt`.

### 2. Accept Neon pooler host (refreshed after final hardening)

The refreshed baseline includes authority hosts, effective `?host=` overrides,
trailing-dot normalization, the safe authority-pooler/direct-override case, and
the explicit `LISTEN` diagnostic. Scratch `src/pool-runtime.ts:48`:

```diff
-  if (neonPooler && /(?:^|\.)neon\.tech$/i.test(effectiveHost)) {
+  if (false && neonPooler && /(?:^|\.)neon\.tech$/i.test(effectiveHost)) {
```

The final-source focused baseline passed with one test and no failures. The
mutant loaded and ran, then failed at `pool-runtime.test.ts:64` with
`AssertionError [ERR_ASSERTION]: Missing expected exception` for the pooler
URL. This directly demonstrates that the test kills acceptance of a Neon
pooler host; it is not a syntax or module-loading failure. The mutant exited 1
with one failed test and no passes.

Evidence files:
`/tmp/external-database-mutations/accept-neon-pooler/baseline.txt` and
`/tmp/external-database-mutations/accept-neon-pooler/mutant.txt`.

### 3. Drop per-new-connection server timeout

Scratch `src/pool-runtime.ts:58`:

```diff
     try {
+      return;
       await client.query(
```

The early return suppresses the per-client `set_config` query while preserving
a valid, loadable module. The focused test loaded and ran, then failed at
`pool-runtime.test.ts:91` because completion remained `false` rather than the
expected `true`. This shows that every new client must await the server timeout
setup used by the pool's `onConnect` hook.

Evidence files:
`/tmp/external-database-mutations/drop-new-client-timeout/baseline.txt` and
`/tmp/external-database-mutations/drop-new-client-timeout/mutant.txt`.

### 4. Include chosen URL in an error

Original workspace `src/pool-runtime.ts:35` was replaced in the scratch copy by
the interpolating expression at scratch line 36:

```diff
-    throw new Error(`${selection.variable} must be a valid PostgreSQL URL.`);
+    throw new Error(
+      `${selection.variable} ${selection.connectionString} must be a valid PostgreSQL URL.`,
+    );
```

The focused test loaded and ran, then failed at `pool-runtime.test.ts:64` with
`AssertionError [ERR_ASSERTION]` because the resulting error text contained the
sentinel connection details matched by
`/fakepassword|secret-host|ep-name/i`. The failure therefore proves URL
redaction specifically, rather than reflecting a syntax or module-loading
problem.

Evidence files:
`/tmp/external-database-mutations/include-url-in-error/baseline.txt` and
`/tmp/external-database-mutations/include-url-in-error/mutant.txt`.