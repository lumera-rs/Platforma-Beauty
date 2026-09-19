# Read-only production diagnostic design

Design-only PostgreSQL 16 text package for the Task #944 specification. No production results and no database connection.

- diagnostic-catalog.json: 10 traceable diagnostic designs (D-01 through D-10).
- `docs/production-evidence-plan/collection-procedures.json`: external authoritative input containing 10 collection procedures (P-01 through P-10); not a file in this package. Diagnostics and procedures are distinct terms.
- diagnostic-queries.sql: text-only non-mutating metadata probes.
- coverage-matrix.json: exact 1,435 mappings, 1,459 occurrences, 110 additional operations, 8 owners and 1,545 records.
- execution-safety.md: operational controls.
- blocked-evidence.md: explicit blockers.
- verification.md: database-free validation contract.
- protected-input-manifest.json: SHA-256 pins for authoritative inputs.
- sql-section-manifest.json: machine-checkable statement, scope, output, and blocker partition.
- record-to-target-manifest.json: 1,545 exact static record-to-owner/occurrence/object-group bindings.
- validate.mjs: audited static reconciler with negative cases.

Authoritative statuses remain UNRESOLVED; production facts remain UNKNOWN.

P-05 has two ordered conditional fixed-target statements (preflight then scan) for `public.shipping_rules`, one execution chunk, and 1,216 blocked records. The scan is prepared only after a matching preflight target_exists=true, reads at most two rows, exposes no row values, and uses no dynamic SQL or fabricated zero result.

Every runnable section is executed only as deterministic chunks of sorted record IDs (maximum 100), with a chunk digest and target-binding IDs. The executor must materialize scope exclusively from the target manifest; SQL parameters are not a license to broaden scope. D-05 scan has an explicit outer LIMIT 1 and its inner count samples at most 2 rows; D-07 has an explicit outer LIMIT 1000 and samples at most 201 activity rows, aligned with declared result caps.

Safe partial-observation records enter deterministic chunks only: D-01 (1,545), D-02 (3), D-03 (13), D-04 (19), D-05 (1 conditional), D-07 (1,545), D-08 (3), and D-09 (118). D-06 and D-10 have zero exact records and zero chunks. These observations do not resolve composite PE facts or authoritative status.

Each diagnostic has one positional parameter contract and typed nullable output schema in both the catalog and section manifest. D-10 is fully blocked: it has no SQL statements or execution chunks and cannot echo reviewer or approval attestations.

Identifier extraction is conservative: parser-keyword artifacts such as an exact case-insensitive IF are BLOCKED_INVALID_IDENTITY, never concrete. D-04 covers indexes only and joins each index to its nonempty parent table; constraints remain blocked.

Runnable diagnostics use evidenceSatisfaction PARTIAL_OBSERVATION_WITH_BLOCKERS; D-06 and D-10 use BLOCKED_NON_DATABASE_ATTESTATION, while D-05 remains PARTIAL_OBSERVATION_WITH_BLOCKERS because its bounded observation does not satisfy PE-05. All PE composite facts remain blocked, authoritative statuses remain UNRESOLVED, and production facts remain UNKNOWN. SQL is an unapproved supporting-observation design only.

D-07 returns one aggregate observation per scope record: observed_sessions_capped_at_201 (bigint) and sample_truncated (boolean). It uses a bounded activity sample and does not return session rows or session_found. Any definition/argument excerpt is truncated, not redacted; truncation is not a privacy protection.
