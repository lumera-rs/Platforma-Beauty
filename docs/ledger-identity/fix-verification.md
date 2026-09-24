# Ledger identity fix verification

This note records the completed verification of the ledger identity fix.
`.local/ledger-fix/ci-job.exit` and
`.local/ledger-fix/phase5-job.exit` each contain exactly:

```text
0
```

The full 67-step CI job is detailed in
[`fix-ci-job-verification.md`](./fix-ci-job-verification.md).

## Reviewed read-only dependency

`lib/db/src/migration-runtime/ledger-identity.ts` was reviewed as a runtime
dependency of migration readiness. Its database access is the target-identity
`SELECT`; it contains no ledger DDL or DML. The exact reviewed dependency was
added to the eligibility CLI allowlist rather than weakening the graph audit.

The completed Phase 5 unit log contains the focused checks:

```text
✔ eligibility CLI runtime dependency graph is explicitly read-only (201.876579ms)
✔ runtime dependency audit rejects writes introduced into the resolved package export (9.068718ms)
✔ runtime dependency audit still rejects unrecognized package imports (0.905188ms)
✔ runtime dependency audit rejects an indirect write path without executing it (0.871953ms)
```

## Correct implementation on an owned disposable database

The complete Phase 5 integration runner used PostgreSQL 16 on loopback at a
non-default port. Its manifest records:

```text
"major": 16,
"host": "127.0.0.1",
"nonDefaultPort": true,
"ownedClusterRemoved": true
```

The ledger suite's exact result was:

```text
✔ adoption preflight reads the legacy seven-column ledger as unbound without DDL
✔ binder refuses a wrong declared identity without changing legacy rows or shape
✔ binder failure at 000003 rolls back earlier bindings and legacy column upgrades
ℹ tests 41
ℹ pass 41
ℹ fail 0
ℹ skipped 0
```

The complete integration manifest reports all 12 result entries with exit code
zero. Summing its actual `tests` fields gives 105 tests, and summing its actual
`passed` fields gives 105 passes; every entry has `skipped: 0`. The runner's
final exact status is:

```text
"status": "passed",
"error": null,
"cleanupErrors": []
```

The old-shape preflight test verifies all of the following together:

1. the exact historical seven-column ledger shape is accepted for reading;
2. absent JSON identity properties are represented as an unbound identity;
3. the ledger is read as `VALID`, not `LEDGER_UNREADABLE` or
   `LEDGER_INCONSISTENT`;
4. no observed statement begins with `CREATE`, `ALTER`, `DROP`, `INSERT`,
   `UPDATE`, or `DELETE`; and
5. receipt JSON and the seven column names are unchanged after preflight.

## Complete Phase 5 unit result

The unit command was:

```text
> workspace@0.0.0 test:migrations:phase5:unit /home/runner/workspace
```

Its exact totals were:

```text
ℹ tests 95
ℹ suites 0
ℹ pass 94
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 29002.109544
```

The one skip was intentional and is not reported as a zero-skip unit run. The
real skipped case and reason were:

```text
﹣ disposable equivalence characterization requires an explicit child-database admin target (0.172547ms) # Pass --admin-url=postgresql://127.0.0.1:<non-5432-port>/<admin-db> to run disposable characterization.
```

## Release-chain check

The release-chain log records all 30 checks passing:

```text
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6722.972722
```

The recorded `.local/ledger-fix/release-chain.exit` content is:

```text
0
```

## Protected-input hash amendments and validators

The pre-amendment validator failed for the expected protected current-input
drift:

```text
Error: protected hash drift: scripts/src/migrations/migrations.integration.test.ts
```

Exactly five current-hash amendments were then recorded. The final census
contains these exact counts:

```text
"currentTotal": 158,
"currentMatches": 158,
"currentMismatches": 0,
"hashAmendments": 5,
"historicalTotal": 146,
"historicalMatches": 146
```

The historical raw manifests remained byte-identical to `origin/main`. Their
evidence records:

```text
"identical": true,
"bytes": 8954,
"sha256": "f189dd413b3b6564faf10bd5c53d294483e6e05a4f21af5cbd72535bfe967a29"
```

and:

```text
"identical": true,
"bytes": 8971,
"sha256": "74a5b036d043d0a8071e52d7d0bc4824797cd1429d05e0691319740c375dfd9f"
```

The final protected manifests and provenance file have these recorded hashes:

```text
077982b28392b35dfdc42504f19c808b20d5dbc7cca862ece5098fef72f56822  docs/production-diagnostic-design/protected-input-manifest.json
aa571f342da682d785dfde5ab898f23f025f843a3282ed94c225e75363c6a821  docs/production-evidence-execution-plan/protected-input-manifest.json
462ef24d77f973d24fcfd4a91e51f5dfd2cd5c01db52009140ebfed56844eea1  docs/production-evidence-execution-plan/provenance.md
```

The final documentation validator's exact summary was:

```text
PASS: reusable authoritative validator and 114 exact-rule deep-cloned negative cases
validate.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.
validation.test.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7927.361036
```

`.local/ledger-fix/hashes/docvalidators-final.exit` and
`.local/ledger-fix/hashes/git-diff-check.exit` each contain exactly:

```text
0
```

## Actual mutant: ignore the declared identity

The binder was temporarily mutated to read the backend identity while ignoring
`options.expectedTargetIdentity`. The mutant was run only against an owned
disposable runner and then removed from tracked source.

The real killing output was:

```text
✖ binder refuses a wrong declared identity without changing legacy rows or shape
AssertionError [ERR_ASSERTION]: Missing expected rejection.
actual: undefined
operator: 'rejects'
```

This failure demonstrates that the new wrong-declared-identity test requires
the binder to reject before upgrading the old shape or changing any receipt.

## Actual mutant: commit each binding row

A detached scratch worktree under `.local/ledger-fix/per-row-scratch` was
mutated to issue `COMMIT` and `BEGIN` after each successful receipt binding.
Tracked source remained on the correct single-transaction binder. The focused
test ran against a runner-created disposable PostgreSQL instance.

The real killing output was:

```text
✖ binder failure at 000003 rolls back earlier bindings and legacy column upgrades
AssertionError [ERR_ASSERTION]: failed all-row binding must roll back bindings written before 000003
```

The exact diff showed that the mutant persisted both the schema upgrade and
earlier row bindings:

```text
+ database_name: 'lumera_phase4_69456_36ec900170'
+ neon_branch_id: null
+ neon_project_id: null
+ system_identifier: '7689013534816726825'
```

Those added identity properties appeared on receipts `000001` and `000002`.
Receipts `000003` and `000004` also gained the four new properties with null
values. Thus the failure proves both required observations: identity columns
survived the injected `000003` failure, and bindings committed before that
failure survived as well. The correct implementation's passing result proves
that one rollback removes both the new columns and all earlier bindings.