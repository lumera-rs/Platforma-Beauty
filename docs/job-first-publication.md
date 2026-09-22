# Job listing first publication

## Existing evidence

`beauty_job_listings.created_at` records creation, not publication.
`moderated_at` is overwritten by subsequent decisions and cleared by owner
edits. The append-only moderation audit records administrator decisions, but
does not record the status and expiry at each decision or all renewal/activation
transitions. An approval of an already expired listing is not publication.
Neither column nor the audit can reliably reconstruct original public visibility.

## Runtime rule and legacy fallback

Public visibility requires active status, approved moderation and future expiry.
The route's `firstPublicationOnVisibility` SQL expression is the single stamp
policy: in the transition update, the current row must be non-public, the next
state public, `first_published_at` NULL, and creation at or after migration
`000004`'s authoritative applied timestamp. Otherwise it returns the original
value. It uses database time and evaluates the current row atomically, so
concurrent/repeated approvals cannot overwrite the first value.

Only single approval/admin reactivation, bulk approval, and renewal activation
call this expression. Creation, owner/admin edits, rejection, closing, expiry
sweeps and report resolution do not set or clear the field. Renewal preserves
an existing date; approval of an expired listing does not initialize it. If
renewal is the first actual activation after that approval, it initializes the
previously empty field. No-op approval or renewal of an already visible legacy
listing leaves its NULL untouched.

The response-only API field is `firstPublishedAt`; create/update input contracts
do not accept it. The DTO serializes the nullable database timestamp. The shared
`publicJobDate` helper selects `firstPublishedAt ?? createdAt`, then validates
that selected value. Invalid non-null publication values do not silently fall
back. Server-rendered visible dates, client visible dates and `JobPosting.datePosted`
all use this helper. The nonexistent `publishedAt` branch has been removed.

For listings created before this change whose first publication field is empty,
the creation date is an **approximation**, not verified original publication.
There is no migration backfill and no claim that moderation history supplies an
accurate legacy date.

The generation boundary is `finished_at` from the transactional, APPLIED
`000004` row in `public.lumera_migration_ledger`, not a hand-entered date or
environment setting. `job-publication-cutoff.ts` resolves and validates it
**before** starting either moderation transaction, and before the renewal update,
using a separate pool read. The transition SQL receives only a bound cutoff
timestamp or NULL; it never queries the ledger. A failed read therefore cannot
abort the business transaction.

The first successful valid receipt is cached for the process lifetime. Concurrent
cold reads share one promise; failures are not cached, allowing recovery without
a restart. The cache stores an immutable timestamp number and returns independent
Date objects. A cached valid cutoff continues to work during a later ledger
outage. Without cached evidence, a missing table, missing migration row, denied
SELECT, or invalid receipt returns NULL and logs the structured
`job-publication-cutoff-unavailable` event with its reason (and SQLSTATE when
available). Approval, bulk approval and renewal still complete normally, leaving
an unknown first-publication timestamp NULL and preserving any known timestamp.
There is no attempt to catch an error inside an already-aborted transaction.

Rows created before that boundary with NULL publication **remain NULL
permanently**, including expired/closed renewal, reactivation and approval.
They retain the creation-time approximation because no reliable source
distinguishes previously-public legacy rows from never-public legacy rows.
An audit decision compared with the current expiry is not a safe substitute:
renewal may have changed expiry while moderation was pending. No legacy
timestamp is fabricated or backfilled. Post-migration rows capture their first
actual public transition, including activation after an expired approval.
An empty date caused by unavailable cutoff evidence likewise uses the documented
creation-time approximation; it is not presented as verified publication evidence.

## Regression checks and CI

The existing Beauty Poslovi HTTP suite now proves creation and caller-supplied
timestamps cannot initialize publication; first/concurrent/bulk approval sets
it; editing, renewal, rejection/reapproval and admin reactivation preserve it;
expired approval is not publication; activation afterwards initializes it;
already visible legacy NULL rows remain NULL on renewal and approval retry.
It also covers expired/closed/pending pre-migration rows, post-migration
creation, and missing-cutoff fail-closed behavior on the owned disposable cluster.
The cold-cache failure matrix exercises single approval, bulk approval and renewal
with the ledger table temporarily renamed, SELECT revoked from a real
non-superuser database role, and the `000004` row absent. Each combination checks
HTTP 200, public visibility, committed moderation audit where applicable,
preserved known dates/NULL unknown dates, and the diagnostic reason. Fixtures
restore the ledger and privileges in finally blocks; no development database is
used. Additional checks prove concurrent read deduplication, immutable cache
values, retry after failed reads, and continued stamping on all three paths from
a warm cache while the table is unavailable.

### Scratch mutation proof

Restoring the ledger SELECT inside the transition UPDATE was tested in an
independent scratch copy. Scratch-only aggregation let all 18 cold-cache matrix
cases run before failing, after table, row and role fixtures were restored.
For each row below, both `unset` and `known` date variants returned HTTP 500
instead of the required 200:

| Diagnostic condition | Single approval | Bulk approval | Renewal |
| --- | --- | --- | --- |
| `ledger_missing` | 500 → expected 200 | 500 → expected 200 | 500 → expected 200 |
| `ledger_select_denied` | 500 → expected 200 | 500 → expected 200 | 500 → expected 200 |

Each of these 12 assertions reported
`<condition> / <single|bulk|renew> / <unset|known>: transition must succeed despite unavailable publication cutoff`,
followed by `500 !== 200`. The six missing-row cases passed. Assertions dependent
on a successful response were skipped only for failed status cases; the mutant
run stopped at the aggregate failure before the warm-cache checks. It exited 1.
The fixed production code and real test file were not changed for this mutation.
The run used its own PostgreSQL 16.10 cluster, database `postgres`, system
identifier `7688363559033913984`, unencrypted transport, and migrations applied
through the runner. Full per-case messages are retained in the local ignored
`recovery-backups/job-cutoff-cache/mutation-inline-ledger-all-routes.log`.

The SEO server test proves visible SSR and structured-data equality, client
formatting uses the same helper, and only null/absent publication uses fallback.
SEO remains under staging `noindex, nofollow`.

`pnpm run test:beauty-jobs` now owns a new disposable PostgreSQL 16 cluster,
declares its generated cluster identity and database name, applies the entire
manifest through the runner, and cleans up the cluster. It does not read an
ambient database URL. It is included in timed release phase 2 and pinned by
the release-chain contract; no production authorisation is implied.