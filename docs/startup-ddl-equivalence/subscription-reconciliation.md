# Historical subscription-plan reconciliation

## Decision

**BLOCKED — replacement contract requires explicit acceptance.**

Branch: `remove-startup-ddl-preparation`.
Starting HEAD: `28dc31927c443861047af4ce2b28cdc27266dae9`.

The original behavior contains ambiguous relationship selection and changes to
live commercial terms. Per this request, those differences are documented and a
safe replacement contract is proposed **before enabling a historical migration**.
No new numbered SQL migration is issued. The existing reference/fallback data
steps and canonical schema migration are unchanged.

New executable work is a source-pinned SQL evidence extractor, a bounded
read-only inspection report and disposable regression fixtures. A test-only
transactional replay of original SQL is **not** a migration replacement.

## Exact operation order and affected records

Source: `artifacts/api-server/src/lib/business-growth-schema.ts`,
`tableStatements(s)` → `runBusinessGrowthSchemaDdl` →
`ensureBusinessGrowthSchema`.

| Order | Source lines | Mutation and dependencies |
| --- | --- | --- |
| 1 | 4605–4611 | Insert `Education legacy <source UUID>` for plans referenced by both `subscriptions.plan_id` and `education_center_subscriptions.plan_id`. Copies price/features/limits/active, sets trial 30, audience education, VAT true and fixed price copy; course limit is `limits.courses::integer`, otherwise 5. Existence is checked by **name only**. |
| 2 | 4612–4616 | Update **all current education subscriptions** on the shared source plan to a matching clone ID, joined by name without verifying provenance or copied terms. Does not update salon subscriptions. |
| 3 | 4617–4619 | Relabel plans referenced by education but not salon subscriptions to audience education. Plans are global rows, not center-owned. |
| 4 | 4620–4627 | Rank **all** education plans by `(price,id)`; fill NULL course limits for the first three ranks with 5/15/30. Also sets trial/VAT and fills price copy. Existing non-NULL limits still occupy ranks; NULL-limit rows after rank 3 stay NULL. |
| 5 | 4628–4632 | Insert inactive zero-price Start/Growth/Academy fallbacks for absent education course limits 5/15/30. Presence is by audience/limit, not approved plan identity or exact payload. |
| 6 | 4633–4636 | For standard names and limits, overwrite trial days, VAT and price copy; deactivate when nonpositive price. |
| 7 | 4637 | Deactivate every education plan with nonpositive price, including custom names. |
| 8 | 4638–4639 | Replace `limits.courses` with `course_limit` for every education plan with a non-NULL limit. Other object keys survive, but the old courses value does not. Scalar/malformed JSON states need explicit handling. |
| 9 | 4644–4647 | For trial/active/free-via-loyalty education subscriptions, fill NULL current price snapshot from the **current referenced plan**, and current limit from existing snapshot, override, then referenced plan limit. Non-NULL snapshots survive. Other statuses are not backfilled. |

Related schema scaffolding at 4587–4602 adds compatibility columns/defaults and
the minimal salon-subscription relation before these operations; 4640 adds the
plan lookup index; 4641–4643 adds current snapshot columns. The later
`pending_plan_id` addition at 4662 and `plan_id_snapshot` FK at 4909 do **not**
add a corresponding historical relinking operation.

`source.ts` extracts exactly these nine DML statements with the TypeScript AST,
preserving source order and checking SHA-256
`000e7e2b564e450c6a16808bab372871c721d5faf9cd50d702cd76c90e573b30`.
It does not import startup owners or their default pools.

### Interpretation by starting state

- **Fresh:** no shared references; three inactive fallbacks are inserted.
- **Existing shared plan:** salon relationship stays on the old ID; current
  education relationships move to a copied plan, or whatever existing row
  happens to satisfy the name join.
- **Partially populated:** an existing clone-looking name suppresses copying
  regardless of its terms or provenance. Existing course limits suppress
  fallback insertion regardless of names/custom fields.
- **Inconsistent:** a single unrelated row occupying the expected clone name can
  receive the education links. Canonical uniqueness rejects a duplicate name.
  Malformed course strings can fail the first INSERT; later malformed JSON or
  interruption can leave earlier operations committed in the original
  autocommit sequence.
- **Repeated:** row creation may stabilize while rank-derived backfill and
  mutable commercial terms still need explicit verification; syntactic
  `NOT EXISTS` is not proof of complete idempotency.

The actual startup already holds the BusinessGrowth advisory lock, and canonical
`subscription_plans_name_unique` enforces `UNIQUE(name)` (baseline SQL 9253–9257;
ORM `commerce.ts:392`). Earlier wording that the name was non-unique was incorrect.
Duplicate-name examples would require an explicitly drifted schema and cannot
be called supported canonical historical fixtures. A unique display name still
does not prove that the row is the right historical clone. There is no claim
that normally locked startup calls currently race; a replacement must preserve
or strengthen that serialization.

## Ownership, foreign keys and historical identifiers

The canonical schema has four direct references to `subscription_plans`:

1. `subscriptions.plan_id` — salon's current relationship; preserve salon ID,
   subscription ID and this link when splitting education use.
2. `education_center_subscriptions.plan_id` — current education relationship;
   only this specific link is eligible for a reviewed split mapping.
3. `education_center_subscriptions.pending_plan_id` — scheduled future target,
   not interchangeable with the current plan.
4. `education_payment_obligations.plan_id_snapshot` — historical obligation
   identity, with `ON DELETE RESTRICT`; **never relink it**.

Schema sources: `lib/db/src/schema/commerce.ts:390–421` and
`lib/db/src/schema/education.ts:95–128,194–232`. Plans have no tenant owner FK.
Tenant boundaries live in salon subscriptions' `salon_id` and education
subscriptions' `center_id`, with the respective salon/center owners.

Preserve subscription IDs, salon/center IDs and owner/user relationships. Also
preserve existing current snapshots; pending plan, cycle, effective date and
keep-course choices; payment obligation amount/limit/cycle/service-period and
payment instruction/IPS snapshots; and financial audit old/new JSON containing
historical plan IDs. No migration should rewrite prior audit evidence.

Application consequences are real, not just schema differences:

- `education-subscription-billing.ts:343–350,380–435` uses current subscriber
  snapshots first, with a live-plan fallback when NULL, and freezes new target
  terms into obligations. Plan CRUD at 119–164 is legitimate runtime logic,
  **not** historical migration SQL.
- Renewal at 521–544 validates live plan audience/active/price and issues new
  immutable terms. Changing a global plan can therefore change future renewal.
- `education-payment-obligation-settlement.ts:130–163` and
  `education-subscription-worker.ts:76–113,137–152` consume obligation snapshots
  first. A preserved ID alone does not prove that missing historical terms are
  safe to reconstruct from today's plan.
- `education-financial-audit.ts:39–100` preserves bounded audit payloads;
  old/new plan IDs must not be rewritten to make a migration look equivalent.

## Fixture provenance and limits

Repository introduction is evidenced by the actual diff of commit `74a7d184`
and the shared-plan startup fixture in
`artifacts/api-server/src/lib/business-growth-schema.test.ts:375–421`.
Neither establishes a deployed historical state.

The new fixtures are **synthetic canonical-schema representations of legacy
relationship states**, constructed from those source rules, application
contracts and FK definitions. They are not production dumps, observed
historical records, or reconstruction of every pre-v114 physical schema.
UUIDs, names and monetary values used by tests are explicit test inputs.

The original SQL is executed only in newly owned disposable PostgreSQL 16.10
children. No real development schema is adopted or changed.

## Proposed replacement contract — NOT ACCEPTED

This proposal is the required decision boundary, not an enabled implementation:

1. **Explicit scope and stale-input protection.** Require a reviewed source
   plan/relationship manifest, exact before-values and affected ownership IDs.
   Abort if any row/relationship differs at execution. No live target or
   approval is inferred from a successful disposable test.
2. **Identity-based copy mapping.** Never reuse a plan because its name resembles
   `Education legacy <id>`. Allocate a new copy ID with a durable, unique
   source→copy mapping and immutable provenance. A preexisting name collision
   or partial clone without matching evidence blocks the operation.
3. **Only approved current education links may move.** Keep the original shared
   plan, salon links, subscriber IDs, center/salon ownership and all unrelated
   relationships unchanged. A relabel of a global education-only plan also
   requires an explicit approved before/after decision.
4. **No UUID/price tier inference.** Require an evidenced per-plan course limit.
   Do not infer it from rank, fallback name, zero price or a missing JSON key.
   Missing, malformed or conflicting course evidence blocks that plan.
5. **Preserve commercial configuration.** Do not normalize custom
   trial/VAT/price-copy/active/limits fields. Any intended change must be
   separately reviewed with its before/after values. Retain custom JSON keys.
6. **Freeze established subscriber terms.** Keep non-NULL snapshots unchanged.
   For missing active/trial/free snapshots, require unambiguous immutable
   contract/settled-obligation evidence tied to that subscriber and period;
   otherwise stop. Today's plan price is not historical evidence.
7. **Pending and issued obligations are separate boundaries.** Never automatically
   map pending targets when mapping current plans. Require a separate approved
   pending decision or abort. Never relink issued payment `plan_id_snapshot`,
   alter issued payment/service snapshots, or rewrite existing audit JSON.
8. **Atomicity and serialization.** Hold the established migration→BusinessGrowth
   locks and lock affected relation tables/rows in a fixed order. Validate under
   lock, create copies/mappings, update only approved links and append genuine
   execution evidence in one transaction. Failure rolls everything back.
9. **Replay and concurrency.** A successful repeat must reuse the same recorded
   copy IDs and preserve all rows. An interrupted transaction creates no
   committed mapping. A concurrent run must either observe the same completed
   mapping or fail explicitly, never create another clone.
10. **Separate data receipt from schema adoption.** Do not use catalog fingerprint
    equality to acknowledge a data reconciliation. No completion marker,
    adoption or startup removal is authorized by this proposal.

The read-only inspector deliberately always reports
`BLOCKED_PENDING_CONTRACT_ACCEPTANCE` and `historicalWritesEnabled=false`.
Its findings are bounded diagnostics, **not** an exhaustive eligibility engine
or a complete simulation of nine sequential mutations. An empty findings list
is not approval.

## Implemented files and unchanged boundaries

- `scripts/src/subscription-reconciliation/source.ts`: source-pinned evidence.
- `scripts/src/subscription-reconciliation/inspect.ts`: bounded, repeatable-read,
  read-only fixture inspection with relationship and FK reporting.
- Companion test/fixture files: original-behavior and preservation proofs only.
- **No new migration SQL**, no change to `000001` or either prior explicit data
  step, no schema-manifest/adoption/ledger changes, no runtime or post-merge edits.
- All eight startup ensure calls remain. No production access, application
  restart, merge, push or publication occurs.

## Actual verification

New cluster: PostgreSQL **16.10**, loopback port **45881**,
`/tmp/lumera-plan-history.hxpJ5t`. The commands below used a synthetic passwordless
test target, not credentials for an existing environment:

```sh
# New historical-plan proof suite: exit 0, 13/13 PASS, no skips.
env -u DATABASE_URL NODE_ENV=test pnpm --filter @workspace/scripts exec tsx \
  src/subscription-reconciliation/reconciliation.test.ts \
  --admin-url=postgres://plan_history_owner@127.0.0.1:45881/postgres

# Scripts TypeScript: exit 0, no diagnostics.
pnpm --filter @workspace/scripts exec tsc -p tsconfig.json --noEmit
```

Successful output:
[`evidence/subscription-reconciliation-tests.txt`](evidence/subscription-reconciliation-tests.txt).
The small name-collision example in
[`evidence/subscription-plan-name-collision.json`](evidence/subscription-plan-name-collision.json)
contains synthetic fixture IDs only.

| New proof | Actual result |
| --- | --- |
| Source pin and nine ordered DML operations | PASS |
| Read-only inspection preserves every fixture row and reports ownership | PASS |
| Ordinary shared-plan split preserves salon/center/subscriber/payment identities | PASS |
| One unrelated reserved-name plan receives original education links | PASS — reproduces unsafe behavior, not acceptable equivalence |
| Canonical duplicate clone name is rejected by UNIQUE | PASS — no constraint was removed |
| Existing snapshots survive; missing active snapshots use live terms; inactive NULLs remain | PASS — records original behavior, not historical correctness |
| Price/UUID ranking and fourth NULL-limit plan | PASS — reproduces unsupported inference/incomplete backfill |
| Custom standard-tier terms and courses JSON are overwritten | PASS — reproduces a preservation discrepancy |
| Later scalar-JSON failure leaves earlier autocommit writes, while a transaction rolls all writes back | PASS |
| Four direct FK relationships, including pending and historical payment plan IDs | PASS |
| Existing restricted fallback step rejects historical relationship fixtures | PASS |
| Concurrent test-only original replay with established lock order produces one clone and stable links | PASS |
| Concurrent read-only reports stay blocked and preserve data | PASS |

The transactional wrapper exists only in
`scripts/src/subscription-reconciliation/fixture.ts`. Its replay/rollback and
concurrency results prove test-harness mechanics around the original statements,
**not** a new accepted migration's retry/receipt contract.

The snapshot, tenant and referential-integrity proofs are scoped to these
constructed cases. No full HTTP boot, full CI, broad historical inventory,
pre-v114 schema transition or real-world historical-data certification was run.
The earlier reference/fallback characterization suite was not repeated.

Cleanup verified zero generated child databases, then stopped the temporary
server. A final `pg_ctl ... status` independently confirmed no server running.
`git diff --check` passed.

## Final status and remaining work

- **Historical `subscription_plans`: NOT FULLY RESOLVED.**
- The limited preexisting fallback seed remains separate and unchanged.
- No new historical migration is enabled or claimed equivalent.
- The replacement contract above is **proposed, not accepted**. Its intentional
  deviations from unsafe source behavior require acceptance before implementing
  the mutating path; actual targets/mappings would then need their own evidence.
- Development merge readiness for removing startup DDL: **NOT READY**.
- Production execution: **NOT READY / NOT AUTHORIZED**.

Final observed branch/HEAD:
`remove-startup-ddl-preparation` /
`28dc31927c443861047af4ce2b28cdc27266dae9`.
Working tree contains modified reports/memory and untracked new
`scripts/src/subscription-reconciliation/` files, report/evidence and the supplied
attachment. Nothing was manually committed, merged, pushed or published.