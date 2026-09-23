# Neon target identity follow-up verification

## Scope and safety

Initial discovery and live proof were performed on 2026-09-23 using only:

- `LUMERA_NEON_TEST_URL` (first branch, direct route)
- `LUMERA_NEON_TEST_POOLER_URL` (first branch, pooled route)
- `LUMERA_NEON_TEST_BRANCH2_URL` (second-branch reference)

No development, production, `DATABASE_URL`, or publishing target was selected.
Connection strings and credentials were not printed or recorded.

## Exact identifier-bearing `pg_settings` rows

The discovery query selected every `neon.*` row whose name contains `project`,
`branch`, `tenant`, `timeline`, or `endpoint`, with columns `name`, `setting`,
`context`, and `source`.

### First branch (`LUMERA_NEON_TEST_URL`)

| name | setting | context | source |
|---|---|---|---|
| `neon.branch_id` | `br-falling-surf-b1mlfio0` | `postmaster` | `configuration file` |
| `neon.endpoint_id` | `ep-broad-shape-b1uly888` | `superuser` | `configuration file` |
| `neon.project_id` | `patient-band-58516090` | `postmaster` | `configuration file` |
| `neon.tenant_id` | `7fa011735a19e14b92eafa55755fc486` | `postmaster` | `configuration file` |
| `neon.timeline_id` | `6f9378ad07eca588dbf37ea50ccf4eb9` | `postmaster` | `configuration file` |

### Second branch (`LUMERA_NEON_TEST_BRANCH2_URL`)

| name | setting | context | source |
|---|---|---|---|
| `neon.branch_id` | `br-odd-sound-b1os4cyc` | `postmaster` | `configuration file` |
| `neon.endpoint_id` | `ep-falling-voice-b1efn0p3` | `superuser` | `configuration file` |
| `neon.project_id` | `patient-band-58516090` | `postmaster` | `configuration file` |
| `neon.tenant_id` | `7fa011735a19e14b92eafa55755fc486` | `postmaster` | `configuration file` |
| `neon.timeline_id` | `358c16d2ef318fdff776713a89f3e3f9` | `postmaster` | `configuration file` |

Both operator-verifiable identifiers are exposed directly. The branches share
`neon.project_id` and differ on `neon.branch_id`.

An exact-value scan across all other `neon.*` settings found one embedded copy:
`neon.console_url` embeds the endpoint ID.

| target | name | setting | context | source |
|---|---|---|---|---|
| first branch | `neon.console_url` | `http://neon-control-plane-api.neon-control-plane.svc.cluster.local:9096/compute/api/v2/endpoints/ep-broad-shape-b1uly888/dbs_and_roles` | `sighup` | `configuration file` |
| second branch | `neon.console_url` | `http://neon-control-plane-api.neon-control-plane.svc.cluster.local:9096/compute/api/v2/endpoints/ep-falling-voice-b1efn0p3/dbs_and_roles` | `sighup` | `configuration file` |

No other `neon.*` setting contained an exact embedded project, branch, tenant,
timeline, or endpoint value.

## Override probes and rollback proof

The inert replacement values were `spoof-project` and `br-spoof`. Results were
identical on both branches.

| mechanism | `neon.project_id` result | `neon.branch_id` result |
|---|---|---|
| URL `options` connection parameter | Connection rejected; psql exit 2; `ERROR: parameter "neon.project_id" cannot be changed without restarting the server` | Connection rejected; psql exit 2; `ERROR: parameter "neon.branch_id" cannot be changed without restarting the server` |
| `set_config(..., false)` | Statement rejected; psql exit 1; same cannot-be-changed error | Statement rejected; psql exit 1; same cannot-be-changed error |
| `ALTER ROLE ... SET` inside `BEGIN` | Statement rejected; explicit `ROLLBACK`; same cannot-be-changed error | Statement rejected; explicit `ROLLBACK`; same cannot-be-changed error |
| `ALTER DATABASE ... SET` inside `BEGIN` | Statement rejected; explicit `ROLLBACK`; same cannot-be-changed error | Statement rejected; explicit `ROLLBACK`; same cannot-be-changed error |

For every transactional SQL probe on both branches:

- saved pre-probe relevant role catalog settings: `{}`
- post-rollback relevant role catalog settings: `{}`
- exact role baseline restored: `true`
- saved pre-probe relevant database catalog settings: `{}`
- post-rollback relevant database catalog settings: `{}`
- exact database baseline restored: `true`

No persistent catalog setting was created.

## Live `assertTargetIdentity` proof

The proof ran at approximately `2026-09-23T14:49:06Z` against the frozen source.
For each direct or pooled route, one `pg.Client` was connected and held for the
entire route. The harness issued `BEGIN TRANSACTION READ ONLY`, performed all
checks on that same client, and issued `ROLLBACK` in `finally`.

The client passed to each `assertTargetIdentity` call counted its queries,
rejected anything not beginning with `SELECT`, and required exactly one query.
Every check reported `identityQueries: 1`. The transaction itself reported
`transaction_read_only: on`.

### Exact proof code

The harness used the three authorized environment variables by name; it did not
print their values. This is the exact code executed:

```ts
import pg from "/home/runner/workspace/scripts/node_modules/pg/lib/index.js";
import { assertTargetIdentity } from "/home/runner/workspace/scripts/src/migrations/target-identity.ts";

const { Client } = pg;
const projectId = "patient-band-58516090";
const branchId = "br-falling-surf-b1mlfio0";
const branch2Id = "br-odd-sound-b1os4cyc";
const timelineId = "6f9378ad07eca588dbf37ea50ccf4eb9";
const wrongTimelineId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function readIdentity(client: InstanceType<typeof Client>) {
  const result = await client.query(`
    SELECT pg_catalog.current_database() AS database_name,
           control.system_identifier::text AS system_identifier,
           ssl.ssl AS encrypted,
           pg_catalog.current_setting('neon.project_id', true) AS neon_project_id,
           pg_catalog.current_setting('neon.branch_id', true) AS neon_branch_id,
           pg_catalog.current_setting('neon.timeline_id', true) AS neon_timeline_id,
           pg_catalog.current_setting('transaction_read_only') AS transaction_read_only
    FROM pg_catalog.pg_control_system() AS control
    JOIN pg_catalog.pg_stat_ssl AS ssl ON ssl.pid = pg_catalog.pg_backend_pid()
  `);
  if (result.rows.length !== 1) throw new Error("identity metadata was not singular");
  return result.rows[0];
}

async function main() {
  const routes = [
    ["direct", process.env.LUMERA_NEON_TEST_URL],
    ["pooled", process.env.LUMERA_NEON_TEST_POOLER_URL],
  ] as const;

  for (const [route, connectionString] of routes) {
    if (!connectionString) throw new Error(`missing authorized ${route} test URL`);
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      const actual = await readIdentity(client);
      const core = {
        databaseName: actual.database_name,
        systemIdentifier: actual.system_identifier,
        transport: actual.encrypted ? "encrypted" as const : "unencrypted" as const,
      };
      console.log(JSON.stringify({ route, heldTransaction: actual.transaction_read_only, actual }));

      const cases = [
        ["own project+branch", { ...core, neon: { projectId, branchId } }, "pass"],
        ["branch 2 branch id", { ...core, neon: { projectId, branchId: branch2Id } }, "Target identity mismatch: neon.branchId"],
        ["no Neon discriminator", core, "Target identity mismatch: neon.projectId expected value is required"],
        ["matching optional timeline", { ...core, neon: { projectId, branchId, timelineId } }, "pass"],
        ["mismatching optional timeline", { ...core, neon: { projectId, branchId, timelineId: wrongTimelineId } }, "Target identity mismatch: neon.timelineId"],
      ] as const;

      for (const [name, expected, wanted] of cases) {
        let identityQueries = 0;
        const heldClient = {
          async query(sql: string) {
            identityQueries += 1;
            if (!/^\s*SELECT\b/u.test(sql)) throw new Error("identity check was not read-only SELECT");
            return client.query(sql);
          },
        };
        let outcome = "pass";
        try {
          await assertTargetIdentity(heldClient, expected);
        } catch (error) {
          outcome = error instanceof Error ? error.message : String(error);
        }
        if (identityQueries !== 1) throw new Error(`${route}/${name}: expected one identity query, got ${identityQueries}`);
        if (outcome !== wanted) throw new Error(`${route}/${name}: expected ${wanted}, got ${outcome}`);
        console.log(JSON.stringify({ route, check: name, identityQueries, outcome }));
      }
    } finally {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ route, rollback: "complete" }));
      await client.end();
    }
  }

  const branch2Url = process.env.LUMERA_NEON_TEST_BRANCH2_URL;
  if (!branch2Url) throw new Error("missing authorized branch 2 test URL");
  const branch2 = new Client({ connectionString: branch2Url });
  await branch2.connect();
  try {
    await branch2.query("BEGIN TRANSACTION READ ONLY");
    const actual = await readIdentity(branch2);
    console.log(JSON.stringify({ route: "branch2-reference", heldTransaction: actual.transaction_read_only, actual }));
  } finally {
    await branch2.query("ROLLBACK");
    console.log(JSON.stringify({ route: "branch2-reference", rollback: "complete" }));
    await branch2.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

### Exact observed identities

| route | database | system identifier | transport from `pg_stat_ssl` | project ID | branch ID | timeline ID | read only |
|---|---|---|---|---|---|---|---|
| direct | `neondb` | `7688718332222926027` | `unencrypted` | `patient-band-58516090` | `br-falling-surf-b1mlfio0` | `6f9378ad07eca588dbf37ea50ccf4eb9` | `on` |
| pooled | `neondb` | `7688718332222926027` | `unencrypted` | `patient-band-58516090` | `br-falling-surf-b1mlfio0` | `6f9378ad07eca588dbf37ea50ccf4eb9` | `on` |
| second-branch reference | `neondb` | `7688718332222926027` | `unencrypted` | `patient-band-58516090` | `br-odd-sound-b1os4cyc` | `358c16d2ef318fdff776713a89f3e3f9` | `on` |

This demonstrates the collision: database name, system identifier, backend
transport evidence, and project ID are identical on both branches. The branch
ID distinguishes them. Direct and pooled routes expose the same first-branch
identity.

### Exact check outcomes

The direct and pooled routes produced the same results:

| expected identity supplied | direct | pooled | identity queries per route/check |
|---|---|---|---|
| first branch project + branch, timeline omitted | `pass` | `pass` | 1 |
| first project + second branch ID | `Target identity mismatch: neon.branchId` | same | 1 |
| no Neon discriminator | `Target identity mismatch: neon.projectId expected value is required` | same | 1 |
| first project + branch + matching optional timeline | `pass` | `pass` | 1 |
| first project + branch + `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` timeline | `Target identity mismatch: neon.timelineId` | same | 1 |

Exact terminal completion records were:

```text
{"route":"direct","rollback":"complete"}
{"route":"pooled","rollback":"complete"}
{"route":"branch2-reference","rollback":"complete"}
```

The process exited successfully. Every database session used for this proof was
read only and explicitly rolled back. No source, test, runbook, or protected
manifest file was modified by this investigation.

## Implemented contract and operator guidance

```ts
{
  databaseName: string;
  systemIdentifier: string;
  transport: "encrypted" | "unencrypted";
  neon?: { projectId: string; branchId: string; timelineId?: string };
}
```

CLI declarations are `--expected-neon-project-id=...` and
`--expected-neon-branch-id=...`, with optional
`--expected-neon-timeline-id=...`. An incomplete required pair, timeline without
the pair, duplicate/bare flags, and the retired tenant flag are rejected.
Read-only status rejects Neon declarations instead of silently ignoring them.

The runbook now documents independent acquisition from the console URL and
branch page, authenticated project/branch API listings, and neonctl (or the
current `neon` executable). Existing-branch PITR preserves the branch ID; the
backup branch has a different ID and is rejected. An optional timeline pin can
be invalidated by restore. These restore semantics are documentation guidance,
not a claim that a restore was performed during this verification.

Custom `neon.*` values on an ordinary PostgreSQL server can be set by its owner
and do not authenticate a Neon server. Verified transport and independent
provisioning approval remain required. This change does not authorize Neon
production use.

## Follow-up local verification

- TypeScript check: passed.
- Focused identity unit suite: 10 passed, no failures or skips.
- Full Phase 5 unit command: 87 passed, no failures, one intentional
  disposable-only characterization skip.
- Full normal `test:migrations:phase5:integration` runner for this follow-up:
  **101/101 passed**, all 11 suites (12 files), zero skips. This includes the
  characterization skipped in the database-free unit command. Existing non-Neon
  tests passed without a Neon discriminator; no integration inventory or
  assertions were weakened. Only query-result stubs gained the new NULL columns.
  The PostgreSQL 16 cluster used loopback and a non-default port; the manifest
  records `status: passed`, `ownedClusterRemoved: true`, `error: null`, and
  `cleanupErrors: []`.
- Documentation: 13 tests passed, plus 114 diagnostic negative cases and 65
  execution negative fixtures.

### Protected hashes

The complete current-tier census covered 158 entries (73 diagnostic and 85
execution). Six entries needed updated hashes for three branch-changed files:
the runbook, CLI, and migrations unit test. The nested diagnostic-manifest entry
required the seventh amendment. All old/new values are appended in
[provenance](../production-evidence-execution-plan/provenance.md).

Final diagnostic manifest SHA-256:
`4736bc587d191649bfccfa22833571a80ed87d398241c91418b2d54ebe77ca1b`.
Final execution manifest SHA-256:
`6c697edfcd8029d499c2340713d86b3c5f4d9acbe0a2a99e3d6361524616888d`.
Final current-tier drift is zero; both historical tiers are raw-byte-identical
to `origin/main`.