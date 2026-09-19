# Migration removal / live-test phase gate

## Current implementation status

All eight startup ensure imports and calls have been removed. API startup uses
a read-only, fail-closed migration readiness check; it does not repair schema.
The supported A/B1/B2 paths and their limits are documented in
[supported-path-results.md](supported-path-results.md). Unknown historical
states remain unsupported, not silently migrated.

Development review status is tracked in
[phase5-review-fixes.md](phase5-review-fixes.md). Production remains **NOT READY /
NOT AUTHORIZED**; no live target eligibility or deployment approval is inferred.

The remainder of this file preserves an earlier assessment. It is historical,
not a statement about the current API entrypoint or current next steps.

## Historical decision at `5d3368ca` (superseded)

| Phase | Status | Reason |
| --- | --- | --- |
| A. Migration equivalence | **BLOCKED** | Required historical transitions are not fully implemented/proven; ambiguous historical terms and cleanup provenance must not be invented. |
| B. Startup DDL removal | **THEN BLOCKED** | At this checkpoint all eight original startup calls remained. They were subsequently removed for proven supported paths. |
| C. Live test deployment | **BLOCKED** | A/B have not passed; no revision is designated deployable or submitted for deployment approval. |

This was a **STOP A report**, not a completed Phase A implementation or a Phase C
readiness review. That request permitted documented safer differences;
the previous “contract not accepted” label is **not by itself** the reason to
stop. There is no authorization to delete test data or treat unknown history as
empty history.

Observed branch: `remove-startup-ddl-preparation`.
Observed HEAD: `5d3368ca671a304b28ab59c894372cffcc8509e9`.
That is the development HEAD, **not** a verified published revision.

## Exact historical boundary

### Subscription terms and identity

The nine ordered original mutations and executable counterexamples are recorded
in [subscription-reconciliation.md](subscription-reconciliation.md).

For an active subscription with missing frozen price/limit, a current plan row
cannot distinguish an unchanged historical contract from a later catalog edit.
Source `COALESCE` backfill at BusinessGrowth lines 4644–4647 simply chooses
current values; it does not recover their historical meaning. Similarly,
price/UUID ranking does not establish an intended legacy tier, and a unique
clone-looking name does not establish source-to-copy provenance.

**Missing evidence for transforming such rows:** identity-based mapping and
before-values, ownership-preserving current/pending relationship decisions,
and immutable subscriber/settled-obligation terms tied to the relevant period.
No such facts are inferred from the owner saying this is a test environment.

**Permitted safer behavior:** preserve all existing terms/references and refuse
ambiguous states. This is implementable without production access, but must be
encoded and tested as the admission contract of the actual migration—not just
the existing read-only inspector, which never enables historical writes.
The current code does not provide that full mutating path or its receipts.

### Salon cleanup and audit

BusinessGrowth lines 4384–4431 identify candidates using generated text,
UUID-derived slug, owner/education-center relations and absent provisioning
provenance. They clear users' active salon selections, retire matched salons,
and record counts. Matching those values is not independent proof of how a
particular salon was created or permission to detach its users.

**Missing evidence for transforming ambiguous candidates:** reviewed candidate
identity/provenance and the affected user/salon/center ownership relationships.
A migration must not manufacture a zero-count report or interpret a skipped
cleanup as completed.

**Permitted safer behavior:** refuse ambiguous candidates or admit explicitly
proven rows only. No cleanup replacement or complete corresponding audit/receipt
contract has yet been implemented and proven.

These are possible states demonstrated/derived from repository contracts, not
claims that the live test database actually contains them. No published data
was queried. Rejecting these states is allowed; silently excluding them from
the claimed equivalence coverage is not.

## Other Phase A work still outstanding

| Item | Existing evidence | What remains |
| --- | --- | --- |
| Categories | Missing rows are inserted; conflicting payloads roll back without overwrite. | Integrate the explicit safer contract into the complete migration boundary; do not call it strict overwrite-equivalence. |
| Function identity | Full and fast paths differ in the body formatting of `prevent_education_gift_voucher_snapshot_update`; object counts stay equal. | An immutable convergence migration and tests from both states, including function/trigger behavior and exact fingerprints. Do not weaken normalization. |
| Rollout marker | Startup writes completion after the rollout; standalone data steps do not forge it. | A completion rule backed by actual per-operation receipts, impossible to mark complete after skipped/blocked work; recovery/concurrency proof. |
| Other historical operations | Crosswalk and characterization exist; a partial seed proof is not proof of every backfill/reconciliation. | Resolve each operation's preservation and supported-state contract before completing the operation-level equivalence report. |

The existing occurrence count is not itself a blocker or proof. Formatting
convergence and receipt implementation are engineering work, not inherently
unrecoverable historical facts. They are listed separately from missing
historical evidence.

## Evidence reused, not rerun

No completed inventory, characterization or database suite was rerun in this
review. No new database, application workflow or production connection was
started.

Prior successful commands/results retained as prior evidence:

```sh
# Prior reference/fallback proof: 13/13 PASS.
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx \
  src/startup-data/apply.test.ts \
  --admin-url=postgres://startup_data_owner@127.0.0.1:33521/postgres

# Prior historical-behavior proof: 13/13 PASS.
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx \
  src/subscription-reconciliation/reconciliation.test.ts \
  --admin-url=postgres://plan_history_owner@127.0.0.1:45881/postgres

# Prior scoped TypeScript result: PASS.
pnpm --filter @workspace/scripts exec tsc -p tsconfig.json --noEmit
```

Those temporary servers were stopped after their original runs. These commands
are evidence references, not instructions to connect to an existing live target.
Logs remain in `evidence/startup-data-tests.txt` and
`evidence/subscription-reconciliation-tests.txt`.

Neither thirteen-test suite establishes full Phase A or Phase B coverage.
No fresh/existing-schema API boot without startup DDL, full release/CI gate,
complete financial/tenant regression, or independent Claude Code removal-diff
review has passed for a removal candidate. No such candidate exists.

Local checks in this review confirmed the branch/HEAD and the eight imports and
calls in `artifacts/api-server/src/index.ts` (imports 14–39, calls 84–91).
Application code, migrations, adoption, post-merge behavior and CI are unchanged.

## Live-test facts and unknowns

Phase C has **not** been entered. The following boundary record prevents
unverified facts from becoming deployment assumptions:

- Owner says the published environment is a live test without real customers.
  Existing test data must still be preserved.
- Exact published revision: **UNKNOWN**.
- Exact live data contents and supported-state eligibility: **UNKNOWN**.
- Backup plus restore verification for the intended target/revision: **UNKNOWN**.
- Whether that target needs adoption, and its target-specific preflight result:
  **UNKNOWN**. A disposable preflight is not target authorization.
- At that checkpoint startup paths still mutated schema/data. This statement
  was superseded by the eight-call removal and read-only readiness guard.
- Deployment and rollback sequences: **not validated or authorized**.
- No candidate revision, production configuration, secrets, database or deployment
  metadata was accessed or changed. No deployment callback was used.
- No development database copy, publication, merge, push, production restart,
  production migration or baseline adoption occurred.

## Historical changes and next action at that checkpoint

This review adds this phase-gate report, links it from the report index and records
the owner's live-test preservation boundary in `replit.md`. No executable
migration/removal changes are made.

Existing migrations remain:

- Schema namespace: `000001_canonical_schema`, unchanged.
- Explicit data namespace: `000001_startup_reference_data` and
  `000002_education_fallback_plans`, unchanged and limited to their documented
  disposable supported states.
- New migration numbers in this review: **none**.

The next planned work at that checkpoint was **Phase A development**: implement a
transactional, fail-closed admitted-state migration/receipt boundary, explicitly
reject the unresolved historical cases above, and prove all remaining operation,
convergence, recovery and tenant requirements. If migration of an ambiguous
historical case is required, obtain its missing provenance/terms rather than
guessing them. Separately authorized data access would be a separate operation,
not implicit permission granted by this request.

The original sequence required A before B, and B before target-specific C
validation. The later supported-path contract permitted B for proven A/B1/B2
states while refusing unknown history. Target-specific revision, backup,
adoption, recovery and smoke-test validation still require separate authorization.