# Startup DDL equivalence — development characterization

Current review and reproducible commands:
[Phase 5 review remediation](phase5-review-fixes.md).
Supported deployment contract and original results:
[supported deployment paths and startup removal](supported-path-results.md).
All eight startup ensure imports/calls have been removed for the explicitly
supported migration paths, with a read-only pre-listen readiness gate.
Unknown historical states remain refused. This is not global historical
equivalence or authorization for production execution.
The reports below preserve their earlier, superseded phase decisions.

Scoped follow-up: [startup data in eleven tables](startup-data.md) contains the
subsequent explicit data steps, supported-state comparisons and remaining data
blockers. This original report retains its historical characterization results;
neither report authorizes startup removal or production execution.

Historical-plan follow-up:
[subscription reconciliation and proposed contract](subscription-reconciliation.md).
This records new disposable proofs, corrects the canonical name-uniqueness
assumption, and leaves historical writes blocked pending contract acceptance.

## Decision

**BLOCKED. This is a partial implementation and a reproducible failure report,
not completion of startup DDL removal.**

- Branch: `remove-startup-ddl-preparation`.
- HEAD: `d210643b0c9845b56821567f40b57ebf3ccc225d`.
- Requested starting commit: `80f822ac502b148de97b616d2b00d6dbf38bd9dd`.
  The intervening commit adds only the previous user attachment, not app code.
- These changes are uncommitted. No merge, push, publish, production read/write,
  production configuration access, or application workflow restart occurred.
- Development merge readiness for the requested migration transition: **NOT READY**.
- Production execution readiness: **NOT READY / NOT AUTHORIZED**.
- All eight startup ensure imports/calls and development post-merge setup are
  unchanged. No new numbered migrations were issued. `000001` is unchanged.

The tests found missing initialization data and a reproducible mismatch between
the canonical baseline and the original rollout's repeat branch. Removing
startup calls or adopting that latter state automatically is not authorized by
these results. No broad fingerprint normalization was added to hide the mismatch.

## Deliverables and operation counts

`scripts/src/startup-equivalence/crosswalk.ts` generates a deterministic,
repository-pinned source crosswalk. Its validator rejects modified source pins,
invented resolution status, and count-preserving altered narrative. It checks the
existing independent startup inventory and re-derives the complete document.
It does not confer new resolution authority on the existing approved crosswalk.

| Measure | Count |
| --- | ---: |
| Startup owners | 8 |
| Distinct grouped DDL mappings in the existing crosswalk | 1,435 |
| DDL occurrence records across those groups | 1,459 |
| Additional operation records | 110 |
| Generated occurrence/additional records | 1,569 |
| Proven resolved transition records | 0 |
| Additional data-backfill records | 67 |
| Additional function replacements | 33 |
| Additional operational-scaffolding records | 7 |
| Additional cleanup-reporting records | 1 |
| Additional rollout-marker records | 2 |

The additional records include 103 executable SQL literals and curated grouping;
these are not 110 extra DDL statements. The 1,569 total is not a count of unique
SQL statements or the authoritative Phase 5 evidence count. Earlier conversational
wording describing 1,459 *distinct mappings* was inaccurate: it is the occurrence
count, not the 1,435 grouped mapping count.

| Owner | DDL occurrences + additional records |
| --- | ---: |
| BusinessGrowth | 1,475 |
| Media | 27 |
| ShippingConfig | 2 |
| MarketplacePerformanceIndexes | 5 |
| Referral | 11 |
| WebPush | 15 |
| BookingCommand | 4 |
| EducationBundlePurchase | 30 |

Each generated record preserves SQL or a curated source operation, file/range,
source hash, owner/enclosing function, static order, dependency notes,
conditional context, test-caller evidence, repeat-syntax signals, candidate
canonical references, and unresolved replacement requirements.

**Limits:** This is a source-level crosswalk, not a dynamic execution trace or
proof of every branch predicate. DDL and additional-operation order counters
come from different source inventories and must not be combined as a global
execution sequence. Curated scaffolding groups lifecycle operations rather than
counting every individual lock/transaction call. Source syntax such as `ON
CONFLICT` is not proof of repeat safety. All classifications and replacement
requirements still need operation-specific semantic validation. Tracker/audit
writes and cleanup reporting are distinguished from schema objects, but their
future retention policy has not been authorized.

## Fixture provenance

All database work used a newly initialized local PostgreSQL **16.10** cluster,
loopback-only, port **41757**, under `/tmp/lumera-ddl-equivalence.trzMtz`.
It contained newly generated owned child databases only. No production dump,
customer data, observed production fingerprint, or existing development schema
was used. Child database cleanup was verified: zero matching fixture databases
remained.

The immutable repository baseline was introduced in commit
`b05dbf8384ef695a61bc4132a938e3ef4c1c172f`; its SHA-256 is
`643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60`.

Reconstructed states:

1. **Fresh runner apply** of `000001`, including its real ledger, then repeat.
2. **Canonical existing-schema reconstruction**: execute the same baseline body
   without a ledger in another new child, run the real read-only preflight,
   adopt only that disposable child, and repeat adoption.
3. **Original full-rollout state**: execute the eight real owners, in application
   startup order, over state 2. Seven use injected pools; referral uses the
   default pool bound exclusively to the verified child before dynamic import.
4. **Original current-version fast-path state**: repeat all eight real owners
   in the same order, then run preflight again.
5. Negative reconstructions: canonical plus an unexpected table; canonical minus
   a standalone required function. Both are rejected without repair.

Only state 2 establishes the exact canonical existing-schema path. These are
repository reconstructions, not evidence of a historically deployed state.
Populated pre-baseline states and their supported transition matrix have **not**
been established; this is incomplete scope, not a claim that repository history
cannot supply any such fixture.

### Fingerprints

Canonical fresh, canonical reconstructed, disposable-adopted, and first full
startup final schema all have:

- Structural: `938c62183adabae9fdab00c5d968c39feb3f216e521b9031d1642575f5875cad`
- Physical: `673f3810d49a4be6899482d44281607dac06d3e1012cd001e8348a45fdf5ea1f`
- 5,060 normalized objects; 103 enums; 24 triggers; 21 functions.

After the repeated startup:

- Structural: `b8b39c5dfdc9c19dec105cfecef8f6688a4a00982dd25b47847cc3d92a5c8a29`
- Physical: `25bedc22380e260a6d84f802f8b1c4a948159ac1d1f9266f171cd27d7fb4a048`
- Counts unchanged. Preflight: **NOT_READY**, `STRUCTURAL_MISMATCH` and
  `PHYSICAL_MISMATCH`, with a valid ledger.

See `evidence/summary.json` for the exact changed catalog definitions, per-owner
observations, baseline provenance, source pins, and crosswalk output hash.

## Exact blockers

### 1. Schema equality does not establish initialization-data equality

The first startup adds rows absent after fresh migration apply:

| Table | Added rows |
| --- | ---: |
| aftercare_settings | 1 |
| b2c_display_settings | 1 |
| beauty_job_categories | 17 |
| beauty_job_platform_settings | 1 |
| business_growth_schema_rollout | 1 |
| education_b2b_discount_settings | 1 |
| education_placement_settings | 1 |
| education_salon_cleanup_reports | 1 |
| shop_settings | 1 |
| subscription_plans | 3 |
| suppliers | 1 |

These include application defaults/reference data and rollout bookkeeping.
They must not all be treated as interchangeable seeds. A numbered replacement
needs reviewed semantics, dependency order, existing-data preservation and
repeat tests. No seed-only partial migration was presented as equivalence.

### 2. Full and fast startup paths are not exact catalog equivalents

The repeat path in `business-growth-schema.ts` replaces
`public.prevent_education_gift_voucher_snapshot_update` with differently indented
PL/pgSQL source. The strict fingerprint retains the body text; the associated
trigger's function definition changes too. This is an exact-identity mismatch,
**not evidence that its business behavior changed**. A tested convergence
migration or a separately reviewed identity policy is needed. `000001` must not
be edited and the fingerprint must not be weakened opportunistically.

### 3. Historical-data equivalence remains unproven

Row counts do not prove row content, tenant isolation, entitlement preservation,
historical backfills, cleanup decisions, or financial reconciliation. All
unresolved source records remain unresolved. No populated historical fixture,
tenant-isolation suite, or HTTP application boot without startup DDL was completed.

## Verification performed

Commands ran from the workspace; the `@workspace/scripts` package supplies `tsx`.
All disposable commands explicitly targeted the newly created loopback cluster.
The URL below is a local passwordless test target, not a credential.

```sh
# TypeScript: PASS (exit 0).
pnpm --filter @workspace/scripts exec tsc -p tsconfig.json --noEmit

# Source crosswalk: 7/7 PASS.
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx \
  --test src/startup-equivalence/crosswalk.test.ts

# Fixture characterization: 4/4 PASS; reports four BLOCKERS, not equivalence GO.
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx \
  src/startup-equivalence/fixtures.test.ts \
  --admin-url=postgres://equivalence_owner@127.0.0.1:41757/postgres \
  --output=/tmp/lumera-ddl-equivalence-report/characterization-final.json

# Actual terminated-backend recovery: 1/1 PASS.
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx \
  src/startup-equivalence/recovery.test.ts \
  --admin-url=postgres://equivalence_owner@127.0.0.1:41757/postgres

# Established migration/database contract suite: 37/37 PASS.
env -u DATABASE_URL NODE_ENV=test \
  LUMERA_PHASE4_DISPOSABLE_DATABASE_URL=postgres://equivalence_owner@127.0.0.1:41757/postgres \
  LUMERA_PHASE4_DISPOSABLE_DB=1 \
  pnpm --filter @workspace/scripts exec tsx --test src/migrations/migrations.integration.test.ts

# Existing migration/preflight unit tests: 16/16 PASS within combined unit run.
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test \
  src/startup-equivalence/crosswalk.test.ts src/startup-equivalence/fixtures.test.ts \
  src/migrations/migrations.test.ts src/migrations/preflight.test.ts

# Generate the full 1,569-record crosswalk (about 7 MB; not committed).
env -u DATABASE_URL pnpm --filter @workspace/scripts exec tsx \
  src/startup-equivalence/crosswalk.ts \
  --output=/tmp/lumera-ddl-equivalence-report/operation-crosswalk.json
```

The combined unit command initially had one failing *new crosswalk-validator*
test and one intentionally skipped DB test. The validator's multi-range source
handling was corrected and its complete seven-test suite rerun successfully.
The existing 16 migration/preflight unit tests passed unchanged. An initial
fixture assertion expecting repeat equality also failed; it was retained as the
reported equivalence blocker and the characterization now asserts the actual
drift and the **BLOCKED** verdict rather than claiming equality.

The recovery test kills the owned migration backend before commit, confirms
rollback plus the persisted `APPLYING` ledger state, then replays the same
synthetic test command and proves exactly one resulting row. It does not
pretend to be a historical numbered migration.

Final successful test logs are in `evidence/`. The standalone
`fixtures-cli.ts` diagnostic writes a report and exits **2** when blockers exist;
its exit code is deliberately distinct from a passing characterization test.
No full CI, full HTTP app boot, populated tenant-preservation test, or independent
Claude Code review was completed. The application workflow was not restarted.

## What must precede further implementation

1. Review the operation-level source requirements and establish populated,
   supported historical fixture states.
2. Prove seed/backfill/reconciliation behavior and the full-versus-fast-path
   convergence policy; only then issue immutable numbered `000002+` migrations.
3. Test schema/data/tenant/boot equivalence and interruption recovery for those
   actual migrations, not only the runner protocol.
4. Only after those checks pass, replace development post-merge setup without
   auto-adoption, remove eight startup paths, and add the runtime-DDL regression
   gate. None of this conditional work has been done.
5. Obtain independent review before a development merge decision.

Production separately still requires actual target identity and supported
fingerprint evidence, reviewed baseline/adoption authority, restore-tested
backup, maintenance/exclusivity evidence, operator approvals, and an explicit
execution decision. No existing Phase 5 evidence or authorization status was
changed by these development tests.