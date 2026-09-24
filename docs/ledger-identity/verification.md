# Ledger identity verification

## Scope and evidence

This report records the evidence that exists; it does not turn test access into
production authorization. No database, source, migration checksum, or manifest
hash was changed to prepare this report.

The evidence inputs are:

- `.local/ledger-identity/focused-unit-final.log`
- `.local/ledger-identity/static-final.log`
- `.local/ledger-identity/disposable-final-runner.log`
- `.local/ledger-identity/disposable-final/phase4-migrations-migrations.integration.test.log`
- `.local/ledger-identity/disposable-final/phase5-integration-manifest.json`
- `.local/ledger-identity/disposable-messages.log`
- `.local/ledger-identity/disposable-messages-run/phase5-integration-manifest.json`
- `.local/ledger-identity/mutation-1-accept-foreign-row.log`
- `.local/ledger-identity/mutation-2-accept-unbound-deployed.log`
- `.local/ledger-identity/mutation-3-allow-rebind.log`
- `.local/ledger-identity/mutation-3-runtime-rebind.log`
- `.local/ledger-identity/mutation-4-omit-neon-branch.log`
- `.local/ledger-identity/neon-proof-initial.log`
- `.local/ledger-identity/neon-proof.log`
- `.local/ledger-identity/full-runner.exit`
- `.local/ledger-identity/full-runner/phase5-integration-manifest.json`
- `.local/ledger-identity/release-chain.log`
- `.local/ledger-identity/hashes/`
- `docs/ledger-identity/registry-evidence.md`
- `docs/ledger-identity/ci-job-verification.md`

## Contract being verified

The runner-owned ledger has four nullable identity columns:
`database_name`, `system_identifier`, `neon_project_id`, and
`neon_branch_id`. The first two bind a receipt to the database and PostgreSQL
cluster. The latter two bind a Neon receipt to its project and branch; both are
null for a non-Neon target. Transport and the optional Neon timeline can be
verified target declarations, but they are deliberately not persisted in these
columns.

Existing ledgers are upgraded in place by adding the nullable columns. That
schema upgrade does not infer or assign an identity to existing receipts.
Fresh apply/adopt receipts carry the already verified target identity.
Readiness remains read-only: it neither upgrades the table nor binds rows.

The state rules are:

- a wholly bound row must match the current target, component by component;
- a partially bound row is always invalid;
- a wholly unbound legacy row is tolerated only outside deployment and is
  refused by deployment readiness;
- a mismatch is refused in every runtime;
- the explicit binding command first verifies the declared target and all
  receipts, then atomically compare-and-sets only wholly unbound rows;
- binding cannot overwrite, repair, or rebind a row that is already bound.

This distinction explains why an old ledger can be upgraded safely without
silently attesting its history, while deployment still fails closed until an
operator performs the explicit binding step.

## Focused and static results

The focused final run reports, exactly:

> `✔ readiness names the migration and component for every bound mismatch (2.685845ms)`
>
> `✔ deployment readiness refuses wholly unbound and partially bound rows (0.45156ms)`
>
> `✔ binding SQL is a one-way compare-and-set and cannot rebind (8.826399ms)`
>
> `ℹ tests 49`
>
> `ℹ pass 49`
>
> `ℹ fail 0`
>
> `ℹ skipped 0`

That same run also confirms the target-evidence boundary and ordering:

> `✔ identity is explicitly validated, never inferred from a URL or environment (2.235225ms)`
>
> `✔ identity evidence fails closed on every mismatch and unavailable backend evidence (1.0693ms)`
>
> `✔ identity verification performs exactly one read-only SELECT (0.37985ms)`
>
> `✔ apply and adoption identity refusal happens before any lock or bookkeeping (1.099653ms)`

The static final run reports:

> `✔ required evidence skip policy rejects every supported Node test skip form (8.496395ms)`
>
> `✔ Phase 5 inventory covers the complete seven-commit range and latest boot fixes (52.368364ms)`
>
> `✔ database-free and disposable commands have no orphaned Phase 5 entrypoints (1.071018ms)`
>
> `✔ the integration runner and package commands preserve the inventory wiring (1.802929ms)`
>
> `ℹ tests 4`
>
> `ℹ pass 4`
>
> `ℹ fail 0`
>
> `ℹ skipped 0`

## Disposable PostgreSQL evidence

The runner emitted:

> `Phase 5 integration manifest: /home/runner/workspace/.local/ledger-identity/disposable-final/phase5-integration-manifest.json`

The manifest records PostgreSQL major 16, a non-default port, removal of the
owned cluster, exit code 0, 38 passed, 0 skipped, status `passed`, `error:
null`, and an empty `cleanupErrors` array. The complete set of actual case
messages from the disposable test log is preserved below, including its nested
malformed-ledger cases:

> `✔ fresh apply and rerun are a no-op (23298.207115ms)`
>
> `✔ ledger identity is bound, immutable, upgradeable, and deployment-enforced (13391.592154ms)`
>
> `✔ exact adoption and second adoption are idempotent (7682.443004ms)`
>
> `✔ baseline adoption refuses when its standalone routine is missing (5157.93287ms)`
>
> `✔ baseline adoption refuses an added standalone routine (5453.201388ms)`
>
> `✔ baseline adoption refuses a mutated baseline standalone routine (5982.628396ms)`
>
> `✔ adoption mismatch leaves zero adopted state (402.636149ms)`
>
> `✔ manifest tamper is rejected before any SQL is sent (28.188684ms)`
>
> `✔ ledger checksum mismatch and unknown future migration fail closed (216.178104ms)`
>
> `✔ concurrent runners serialize without double application (379.915478ms)`
>
> `✔ transactional rollback leaves no partial object or APPLIED state (147.784362ms)`
>
> `✔ preexisting nontransactional APPLYING halts without rerun (183.20865ms)`
>
> `✔ fresh and adopted databases have equivalent structural and physical fingerprints (12470.024813ms)`
>
> `✔ status is read-only (155.177714ms)`
>
> `✔ Phase 5A preflight is READY for exact baseline and creates no object or ledger (4554.413211ms)`
>
> `✔ Phase 5A preflight recognizes the real canonical ADOPTED ledger (4507.636374ms)`
>
> `✔ Phase 5A preflight classifies an empty real ledger as inconsistent (4444.876289ms)`
>
> `✔ Phase 5A ledger exclusion preserves only the exact canonical identity (23012.665763ms)`
>
> `✔ Phase 5A transaction is PostgreSQL-enforced repeatable-read read-only (124.119052ms)`
>
> `✔ Phase 5A preflight blocks routine and trigger drift (4647.497903ms)`
>
> `✔ Phase 5A preflight blocks unknown migration without repair (4366.683846ms)`
>
> `✔ Phase 5A preflight blocks failed migration without repair (4249.360208ms)`
>
> `✔ Phase 5A preflight blocks applying migration without repair (4595.324662ms)`
>
> `✔ Phase 5A preflight blocks checksum mismatch without repair (4691.556894ms)`
>
> `▶ Phase 5A preflight rejects every malformed ledger shape`
>
> `  ✔ extra column (4595.551639ms)`
>
> `  ✔ missing column (4516.716961ms)`
>
> `  ✔ wrong data type (4475.677125ms)`
>
> `  ✔ wrong nullability (4691.961002ms)`
>
> `  ✔ wrong default (4396.23406ms)`
>
> `  ✔ missing primary key (4275.998716ms)`
>
> `  ✔ wrong primary key (4298.431986ms)`
>
> `  ✔ weakened mode check (4350.21338ms)`
>
> `  ✔ weakened state check (4466.545884ms)`
>
> `  ✔ extra allowed state (4496.647306ms)`
>
> `  ✔ view (4619.005114ms)`
>
> `✔ Phase 5A preflight rejects every malformed ledger shape (49185.980013ms)`
>
> `✔ Phase 5A preflight blocks unsupported version contract and missing extension (4562.430921ms)`
>
> `✔ production startup cannot reach migration runner (4497.522071ms)`
>
> `ℹ tests 38`
>
> `ℹ pass 38`
>
> `ℹ fail 0`
>
> `ℹ skipped 0`

The identity integration case covers fresh bound receipts, refusal of a foreign
bound database name by both apply and bind, preservation of receipts after the
refused bind, deployment refusal of wholly unbound legacy rows, explicit
one-way binding, and refusal of a partial Neon identity. “Upgradeable” here
means adding the nullable identity columns to an old ledger and then requiring
an explicit attestation; it does not mean that startup or binding may rewrite a
foreign identity.

### Supplemental returned results

The supplemental owned PostgreSQL run captures the returned values and actual
refusal messages that the case-level output above intentionally summarizes.
These are the exact six result lines:

> `APPLY_ALL4_BOUND {"result":{"applied":["000001","000002","000003","000004"],"skipped":[]},"rows":[{"id":"000001","databaseName":"lumera_ledger_messages_29388_31ad1bf0cd","systemIdentifier":"7688988145007473322","neonProjectId":null,"neonBranchId":null},{"id":"000002","databaseName":"lumera_ledger_messages_29388_31ad1bf0cd","systemIdentifier":"7688988145007473322","neonProjectId":null,"neonBranchId":null},{"id":"000003","databaseName":"lumera_ledger_messages_29388_31ad1bf0cd","systemIdentifier":"7688988145007473322","neonProjectId":null,"neonBranchId":null},{"id":"000004","databaseName":"lumera_ledger_messages_29388_31ad1bf0cd","systemIdentifier":"7688988145007473322","neonProjectId":null,"neonBranchId":null}]}`
>
> `COPIED_LEDGER_READINESS_BOTH_RUNTIMES {"nondeployment":{"ready":false,"reason":"MIGRATION_READINESS_LEDGER_IDENTITY_MISMATCH:000002:databaseName","migrationIds":[],"ledger":"INVALID","catalog":"UNKNOWN"},"deployment":{"ready":false,"reason":"MIGRATION_READINESS_LEDGER_IDENTITY_MISMATCH:000002:databaseName","migrationIds":[],"ledger":"INVALID","catalog":"UNKNOWN"}}`
>
> `LEGACY_LEDGER_BOTH_RUNTIMES {"nondeployment":{"ready":true,"reason":null,"migrationIds":["000001","000002","000003","000004"],"ledger":"VALID","catalog":"CANONICAL"},"deployment":{"ready":false,"reason":"MIGRATION_READINESS_LEDGER_IDENTITY_UNBOUND:000001:databaseName","migrationIds":[],"ledger":"INVALID","catalog":"UNKNOWN"}}`
>
> `SUCCESSFUL_BIND_AND_READY {"bindResult":{"bound":["000001","000002","000003","000004"]},"deploymentReadiness":{"ready":true,"reason":null,"migrationIds":["000001","000002","000003","000004"],"ledger":"VALID","catalog":"CANONICAL"}}`
>
> `WRONG_DECLARED_IDENTITY {"message":"Target identity mismatch: databaseName"}`
>
> `FOREIGN_BOUND_BINDER_REFUSAL_UNCHANGED {"message":"Migration ledger identity mismatch for 000002: databaseName","unchanged":true,"row":{"id":"000002","checksum":"a8c910eb9bd60281aa80e343b4b1d6e02a45222293b123ab198fab4315d48e62","mode":"transactional","state":"APPLIED","error":null,"databaseName":"foreign_database","systemIdentifier":"7688988145007473322","neonProjectId":null,"neonBranchId":null}}`

The run then reported:

> `✔ captures actual ledger identity results and messages (10047.757408ms)`
>
> `ℹ tests 1`
>
> `ℹ pass 1`
>
> `ℹ fail 0`
>
> `ℹ skipped 0`

Its manifest independently records PostgreSQL major 16, a non-default port,
owned-cluster removal, exit code 0, one passed, zero skipped, status `passed`,
`error: null`, and no cleanup errors.

## Mutation evidence

Each deliberate weakening was killed by the focused ledger test. The excerpts
below quote the actual assertion output, not a source-level expectation
substituted for test output.

### 1. Accept a foreign bound row

> `✖ readiness names the migration and component for every bound mismatch (4.292749ms)`
>
> `  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:`
>
> `  + actual - expected`
>
> `  + null`
>
> `  - 'MIGRATION_READINESS_LEDGER_IDENTITY_MISMATCH:000003:databaseName'`
>
> `    actual: null,`
>
> `    expected: 'MIGRATION_READINESS_LEDGER_IDENTITY_MISMATCH:000003:databaseName',`
>
> `    operator: 'strictEqual',`

The log records 3 tests, 2 pass, and 1 fail.

### 2. Accept an unbound deployed row

> `✖ deployment readiness refuses wholly unbound and partially bound rows (2.409341ms)`
>
> `  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:`
>
> `  + actual - expected`
>
> `  + null`
>
> `  - 'MIGRATION_READINESS_LEDGER_IDENTITY_UNBOUND:000001:databaseName'`
>
> `    actual: null,`
>
> `    expected: 'MIGRATION_READINESS_LEDGER_IDENTITY_UNBOUND:000001:databaseName',`
>
> `    operator: 'strictEqual',`

The log records 3 tests, 2 pass, and 1 fail.

### 3. Allow rebinding — static CAS source-form kill only

> `✖ binding SQL is a one-way compare-and-set and cannot rebind (11.41352ms)`
>
> `  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /AND database_name IS NULL AND system_identifier IS NULL\s+AND neon_project_id IS NULL AND neon_branch_id IS NULL/u. Input:`
>
> `    expected: /AND database_name IS NULL AND system_identifier IS NULL\s+AND neon_project_id IS NULL AND neon_branch_id IS NULL/u,`
>
> `    operator: 'match',`

The assertion's `actual` value is the complete mutated `runner.ts` source and is
retained verbatim in the mutation log; it is not duplicated into this report.
The log records 3 tests, 2 pass, and 1 fail. This is a **static** source-form
mutation kill: it demonstrates that the all-null compare-and-set predicate is
present and test-enforced. The separate runtime mutation proof follows.

### 3b. Allow rebinding — runtime mutation kill

The runtime mutant removed the refusal and did perform the forbidden committed
rewrite. The test observed the missing rejection and changed foreign row:

> `MUTATION3_RUNTIME_OBSERVED {"assertion":"Missing expected rejection.","foreignRowWasRebound":true,"beforeDatabaseName":"foreign_database","afterDatabaseName":"lumera_mutant_rebind_32375_2123a1038f"}`

It then failed the mutant run as required:

> `✖ runtime mutant cannot rebind a foreign bound row (9868.95627ms)`
>
> `  AssertionError [ERR_ASSERTION]: Mutation survived: foreign bound row was updated and committed`
>
> `ℹ tests 1`
>
> `ℹ pass 0`
>
> `ℹ fail 1`

The integration wrapper also rejected that non-passing proof:

> `Error: Test output is not a complete passing proof (tests=1, pass=0, skipped=0, fail=1); inspect /home/runner/workspace/.local/ledger-identity/mutation3-runtime/output/phase4-migrations-mutant.test.log`

This failure is the expected mutation-test outcome: the intentionally unsafe
mutant failed because it rebound and committed the foreign row. It is not a
failure of the unmutated implementation.

### 4. Omit the Neon branch comparison

> `✖ readiness names the migration and component for every bound mismatch (4.924899ms)`
>
> `  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:`
>
> `  + actual - expected`
>
> `  + null`
>
> `  - 'MIGRATION_READINESS_LEDGER_IDENTITY_MISMATCH:000003:neon.branchId'`
>
> `    actual: null,`
>
> `    expected: 'MIGRATION_READINESS_LEDGER_IDENTITY_MISMATCH:000003:neon.branchId',`
>
> `    operator: 'strictEqual',`

The log records 3 tests, 2 pass, and 1 fail.

Together, these mutations establish the three separate refusal boundaries:
readiness rejects foreign identity, deployment readiness rejects legacy
unbound identity, and both static and runtime mutation evidence protect the
one-way all-null CAS guard. The fourth mutation specifically establishes that
Neon branch identity is not optional once a Neon row is bound.

## Authorized Neon test proof

The first harness attempt failed before connection because its CLI invocation
did not use the parser's explicit URL form. The complete initial output was:

> `Invoking bind-ledger-identity on LUMERA_NEON_TEST_URL using the previously recorded test declaration.`
>
> `Mutating migrations require an explicit --database-url target`
>
> `undefined`
>
> `/home/runner/workspace/scripts:`
>
> ` ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: tsx ../.local/ledger-identity/neon-proof.ts`

There is no connection warning or database result before that refusal. The
harness syntax was then corrected to the accepted explicit
`--database-url=<value>` form; this was a harness invocation fix, not a
production-code, database, or hash change.

The corrected run's actual proof lines are:

> `Invoking bind-ledger-identity on LUMERA_NEON_TEST_URL using the previously recorded test declaration.`
>
> `{`
>
> `  "bound": [`
>
> `    "000001",`
>
> `    "000002",`
>
> `    "000003",`
>
> `    "000004"`
>
> `  ]`
>
> `}`
>
> `{"target":"LUMERA_NEON_TEST_URL","ready":true,"reason":null,"migrationIds":["000001","000002","000003","000004"],"ledger":"VALID","catalog":"CANONICAL"}`
>
> `{"target":"LUMERA_NEON_TEST_BRANCH2_URL","ready":false,"reason":"MIGRATION_READINESS_LEDGER_IDENTITY_UNBOUND:000001:databaseName","migrationIds":[],"ledger":"INVALID","catalog":"UNKNOWN"}`
>
> `Authorized Neon ledger proof passed; second branch was read-only and no rows were rebound.`

This is an authorized test proof only. It shows explicit binding on the first
declared test branch and read-only fail-closed readiness on the second branch.
It does not authorize a production operation.

### Copied bound branch limitation

A copied ledger whose receipts are already bound to another Neon branch is
refused because the copied `neon_branch_id` differs. The bind command cannot
recover it: no-rebind is the safety contract, and recovery for a copied bound
branch is outside this scope. A copied *unbound legacy* ledger is different: it
may be explicitly bound only after provenance verification and independent
declaration of the new branch. Neither case proves that the migrations executed
locally on the copy.

## Destructive-harness registry evidence

The dedicated evidence document is
`docs/ledger-identity/registry-evidence.md`. It records the preserved streams
and exit statuses and quotes all 38 emitted mutation diagnostics. Its focused
run is summarized by these actual stdout lines:

> `ℹ tests 40`
>
> `ℹ pass 40`
>
> `ℹ fail 0`
>
> `ℹ skipped 0`

It also records a current old-contract reproduction, including these two actual
diagnostics:

> `ℹ current reproduction: original predicate accepted import-only external database pool integration mutation`
>
> `ℹ current reproduction: original predicate accepted import-only HTTP security hardening mutation`

The registry evidence therefore covers both persistent inclusion in the API
regression lifecycle and mutations that the earlier import-sensitive predicate
would have accepted.

## Release-chain wiring

`.local/ledger-identity/release-chain.exit` is `0`. The actual release-chain
summary is:

> `ℹ tests 30`
>
> `ℹ suites 0`
>
> `ℹ pass 30`
>
> `ℹ fail 0`
>
> `ℹ cancelled 0`
>
> `ℹ skipped 0`
>
> `ℹ todo 0`
>
> `ℹ duration_ms 6172.714543`

This is the database-free release-chain contract run; the separate full runner
and CI job results are recorded below.

## Protected-input hash census and provenance

These facts report the separately authorized protected-manifest amendment
work preserved under `.local/ledger-identity/hashes/`; creating and updating
this verification report did not itself amend those manifests or any source
file.

The required documentation validator was first run before amendment and exited
`1`. Its exact first measured failure was:

> `Error: protected hash drift: scripts/src/migrations/PHASE-5B-RUNBOOK.md`

The pre-amendment full census records 73 diagnostic current inputs and 85
execution current files, 158 total. It found 140 current matches and 18 current
mismatches across nine files. Every mismatch was branch-changed, with
`"unrelatedMismatches": []`; all 146 historical entries matched. The provenance
records the same measured boundary:

> `An independent full byte census then hashed all 158 current-tier entries:`
>
> `73 diagnostic \`currentInputs\` and 85 execution \`files\`. There were exactly 18`
>
> `pre-amendment mismatches across nine source files, and 140 matches. Every`
>
> `mismatching path was present in \`git diff --name-only $(git merge-base`
>
> `origin/main HEAD)\` including working-tree changes; there were zero unrelated`
>
> `mismatches.`

The final census records:

> `"currentTotal": 158,`
>
> `"currentMatches": 158,`
>
> `"currentMismatches": 0,`
>
> `"hashAmendments": 19,`
>
> `"historicalTotal": 146,`
>
> `"historicalMatches": 146`

The 19 current-tier amendments consist of 18 entries for nine already changed
migration-tooling files (one entry in each current tier) plus the dependent
execution-manifest entry for the finalized diagnostic manifest. No historical
tier or historical source was amended. The historical raw blocks remained
byte-identical:

- diagnostic D `inputs`: 8,954 bytes,
  `f189dd413b3b6564faf10bd5c53d294483e6e05a4f21af5cbd72535bfe967a29`;
- execution E `originalProtectedFiles`: 8,971 bytes,
  `74a5b036d043d0a8071e52d7d0bc4824797cd1429d05e0691319740c375dfd9f`.

The final protected artifact hashes are:

> `b65f40e7ec6fe6f49999f69cc86317c255e41ae042e7fea78f25e935461fc75f  docs/production-diagnostic-design/protected-input-manifest.json`
>
> `77bd59f6e37c230d02bd1acef0ce850d65ea6920b3fd9104e39a7f00f2d47061  docs/production-evidence-execution-plan/protected-input-manifest.json`
>
> `012eb7ea3a671e2cc5fa22ae4b9a9dce6a79b114eaf541ac39a129d43f460b1e  docs/production-evidence-execution-plan/provenance.md`

The final documentation validator exited `0` with empty stderr. Its actual
summary includes:

> `PASS: reusable authoritative validator and 114 exact-rule deep-cloned negative cases`
>
> `validate.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.`
>
> `validation.test.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.`
>
> `ℹ tests 13`
>
> `ℹ pass 13`
>
> `ℹ fail 0`
>
> `ℹ skipped 0`

The preserved `git diff --check` exit is also `0`, with empty stdout and stderr.

## Phase 8 privilege remains a separate grant

The Phase 5B runbook exists and specifies the narrow Phase 8 application-role
grant:

```sql
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO lumera_app;
```

The provisioned role name must replace `lumera_app`. The purpose is only to let
readiness obtain the cluster system identifier. The application also needs the
documented ledger/catalog visibility, but it does not need ledger write,
migration-runner, `pg_monitor`, or superuser privileges. The grant must be made
by an authorized administrator before enabling startup readiness and must not
be made by application startup. The existence of the runbook and these tests
does not itself grant or authorize Phase 8.

## Full Phase 5 integration runner

The full runner exit file contains:

> `0`

The full owned PostgreSQL 16 runner completed successfully. Its manifest records
`"nonDefaultPort": true`, `"ownedClusterRemoved": true`, `"status": "passed"`,
`"error": null`, and `"cleanupErrors": []`.

All 11 selected suites were preserved, and every manifest result has
`"exitCode": 0` and `"skipped": 0`:

| Suite | Result files | Passed / tests |
| --- | ---: | ---: |
| `phase4-migrations` | 1 | 38 / 38 |
| `equivalence-characterization` | 1 | 4 / 4 |
| `target-identity` | 1 | 6 / 6 |
| `supported-state` | 1 | 15 / 15 |
| `supported-convergence` | 1 | 4 / 4 |
| `adoption-boundary` | 1 | 1 / 1 |
| `namespace-boundary` | 1 | 1 / 1 |
| `actual-entrypoint-boot` | 1 | 5 / 5 |
| `legacy-boot-refusal` | 1 | 1 / 1 |
| `historical-data-regressions` | 2 | 26 / 26 |
| `interrupted-recovery` | 1 | 1 / 1 |
| **Manifest result total** | **12** | **102 / 102** |

The selected-suite declarations total 87 top-level tests; the result total is
102 because the test runner reports the nested cases in the phase-4 migration
suite. The existing coverage therefore remains present rather than being
replaced by identity coverage. The added identity case is included in the
successful phase-4 result:

> `✔ ledger identity is bound, immutable, upgradeable, and deployment-enforced (14400.052008ms)`
>
> `ℹ tests 38`
>
> `ℹ pass 38`
>
> `ℹ fail 0`
>
> `ℹ skipped 0`

The complete manifest also preserves the existing supported-state,
convergence, adoption, namespace, actual-entrypoint, legacy-boot,
historical-data, and interrupted-recovery suites listed above; no suite was
skipped or removed to add the ledger-identity coverage.

## Database CI job

The observed `.local/ledger-identity/ci-job.exit` is exactly `0`. The actual
latest-run manifest records job `ci-database-release-2-and-3`, status `passed`,
exit code `0`, and 67/67 steps passed. Every step has exit code `0`; the
additional Phase 4 migration integration is step 67 after the original 66-step
release sequence. The separate final-status file is exactly:

> `passed`

The exact per-step commands, durations, exits, `END` log lines, emitted test
summaries, backend-standards `All 13 checks passed.` line, and Phase 4 38/38
summary are preserved in
[Database CI job verification](./ci-job-verification.md).

This CI result does not alter the separately recorded protected-input result:
19 current-tier hash amendments, 158/158 final current matches, and 146/146
historical matches.