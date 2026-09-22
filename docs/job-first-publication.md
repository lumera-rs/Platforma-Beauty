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
environment setting. Application readiness already reads that column with the
same database role. An uncorrelated scalar subquery in the atomic update avoids
an additional application round trip. Missing, unfinished or invalid ledger
evidence cannot initialize a publication timestamp; unavailable ledger access
raises a database error, rather than inventing a date.

Rows created before that boundary with NULL publication **remain NULL
permanently**, including expired/closed renewal, reactivation and approval.
They retain the creation-time approximation because no reliable source
distinguishes previously-public legacy rows from never-public legacy rows.
An audit decision compared with the current expiry is not a safe substitute:
renewal may have changed expiry while moderation was pending. No legacy
timestamp is fabricated or backfilled. Post-migration rows capture their first
actual public transition, including activation after an expired approval.

## Regression checks and CI

The existing Beauty Poslovi HTTP suite now proves creation and caller-supplied
timestamps cannot initialize publication; first/concurrent/bulk approval sets
it; editing, renewal, rejection/reapproval and admin reactivation preserve it;
expired approval is not publication; activation afterwards initializes it;
already visible legacy NULL rows remain NULL on renewal and approval retry.
It also covers expired/closed/pending pre-migration rows, post-migration
creation, and missing-cutoff fail-closed behavior on the owned disposable
cluster.
The SEO server test proves visible SSR and structured-data equality, client
formatting uses the same helper, and only null/absent publication uses fallback.
SEO remains under staging `noindex, nofollow`.

`pnpm run test:beauty-jobs` now owns a new disposable PostgreSQL 16 cluster,
declares its generated cluster identity and database name, applies the entire
manifest through the runner, and cleans up the cluster. It does not read an
ambient database URL. It is included in timed release phase 2 and pinned by
the release-chain contract; no production authorisation is implied.