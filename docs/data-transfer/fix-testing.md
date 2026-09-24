# Transfer fix regression evidence

The runs below used the restricted environment wrapper. Its actual output was:

```text
BINARY_PROOF command -v initdb: not found
BINARY_PROOF LUMERA_POSTGRES_16_BIN=/nix/store/bgwr5i8jf8jpg75rr53rz3fqv5k8yrwp-postgresql-16.10/bin
```

Only runner-owned disposable PostgreSQL 16 clusters were used. No Neon, development, or production target was used by these tests.

## Initial regression run

The initial expanded suite did **not** pass:

```text
ℹ tests 17
ℹ pass 15
ℹ fail 2
ℹ skipped 0
```

The FK-orphan and synthetic trigger-side-effect cases failed with `TRANSFER_FAILED`, `sqlstate: null`, `step: 'disable-mutating-triggers'`. This is retained as failed evidence, not a successful full-suite result. The positive sequence, duplicate, validating-trigger, trigger-restoration, rehearsal, and exact-identity cases passed in that run. Full log: `.local/data-transfer-fix/integration.log`.

## Final correct regression run

After fixing PostgreSQL `name[]` decoding in dependency discovery, the earlier complete run passed 18 tests. The final safety run, including origin-session rejection and safe error metadata, supersedes it:

```text
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 143361.134223
```

Evidence: `.local/data-transfer-fix/final-safety-integration.log`, `.local/data-transfer-fix/final-safety-integration.exit` (`0`). This includes the actual canonical product-category ownership trigger, the test-only validating trigger, sequence advancement, duplicate preservation, exact declared-identity rejection, trigger restoration, and rehearsal rollback of both rows and sequence state.

Final safety unit output, retained in `.local/data-transfer-fix/final-safety-unit.log` with exit `0`:

```text
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2213.405673
```

## Five actual final scratch mutants

Tracked engine source was never mutated. Scratch copies are under `.local/data-transfer-fix/mutants/`. Each selected mutant test ran on a fresh owned disposable cluster; each process exited `1` and printed:

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

Actual killing messages:

```text
AssertionError [ERR_ASSERTION]: wrong declared identity must fail with the exact identity error
AssertionError [ERR_ASSERTION]: sequence must restart above the highest transferred value
AssertionError [ERR_ASSERTION]: duplicate rows must not be discarded during transfer
AssertionError [ERR_ASSERTION]: Missing expected rejection: the canonical validating ownership trigger must reject a self-parent category
AssertionError [ERR_ASSERTION]: disabled trigger must be re-enabled before final policy and fingerprint verification
```

The identity mutant returned `TARGET_LEDGER_NOT_BOUND` rather than the required `Target identity mismatch: databaseName`; generic refusal no longer satisfies the test. The sequence mutant returned `1` instead of `4001`. The duplicates mutant produced a blocked content-hash result rather than the required committed transfer preserving both duplicate rows. The validating-trigger mutant accepted a self-parent row after suppressing validation, failing the invariant assertion. The restoration mutant was rejected by the final trigger policy check before commit.

Logs and exit files: `.local/data-transfer-fix/mutant-safety-{identity,sequence,duplicates,validating,restore}.{log,exit}`. All five were refreshed after the final origin-session and safe-error changes; only scratch engine copies were mutated. Earlier `mutant-final-*` evidence remains retained but is superseded by these final safety runs.

The final validating-trigger mutant disables and restores the real `product_categories_supplier_ownership` trigger around the load. The correct test expects the exact safe error fields `code: TRANSFER_FAILED`, `sqlstate: P0001`, `step: insert`; accepting the self-parent row produces the missing-rejection assertion above. Both databases for this test are built by the real migration runner, and fixture seed identities are explicitly synchronized before the test. These disposable runs do not claim a Neon-role proof.