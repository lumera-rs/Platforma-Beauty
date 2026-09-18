# Verification

Database-free deterministic checks independently load and compare inventory.json, evidence-matrix.json, collection-procedures.json, and complete-evidence.json. They assert exact record IDs, occurrence IDs, procedure IDs, evidence requirement IDs, owner names, statuses, diagnostic assignments, blocker/coverage declarations, protected SHA-256 pins, complete totals, every required diagnostic field, safe SQL tokens, absence of production results, and unchanged authoritative statuses. Negative fixtures deep-clone candidate artifacts and invoke the same exported validatePackage(inputs, artifacts) function; they detect missing and duplicate IDs, wrong procedure/evidence references, missing assignments, orphan diagnostics, missing gates/timeouts/risk/required fields, unsafe stacked statements and mutating functions, unauthorized results, status drift, owner/occurrence/count mismatch, coverage/blocker overlap, and protected-hash drift.

Validator imports are restricted to filesystem, JSON, crypto and assertion primitives; no database, network, child-process, application or SQL execution. The SQL tokenizer removes comments, ignores quoted string contents, splits only on semicolons outside strings, permits only SELECT/WITH and an explicit read-only function allow-list, and rejects dynamic execution, mutating functions, CALL/DO/COPY, stacked mutations, and unbounded definition payloads.

## Audited reproduction

Import audit: `validate.mjs` imports only `node:fs`, `node:assert/strict`, and `node:crypto`. It has no database client, network, child-process, shell, application, startup, or SQL execution import. The SQL file is read as text only.

Exact command run:

    node docs/production-diagnostic-design/validate.mjs

Observed result: database-free validator pass (negative-case count is printed by the validator). This command performs filesystem reads, JSON parsing, SHA-256 hashing, assertions, and no database or network operation. Checks include safe-set partition/chunk coverage, two-phase privacy-safe P-05 preflight/aggregate/fixed-target gating, D-04 relationship-based object_found, contiguous parameter positions and SQL alignment, joined-output nullability, invalid keyword identity marked concrete, D-04 index-parent join, parent-output, and parent-binding omissions, nullable allow-list WHERE regression, duplicate/swapped output columns, D-07 activity cross-join regression, wrong record-target binding, dynamic target coverage, blocked IDs in chunks, chunk gap/duplicate/oversize/order/digest, manifest plus SQL-text enforcement of the P-02/P-08 target contracts, and undeclared/missing/renumbered parameters plus missing/renamed/type-mismatched output columns. It also rejects unknown catalog fields and status values, execution-result-like fields, missing substantive blocker rationale, nondeterministic D-03 selection, and result-cap/LIMIT drift.

The protected manifest pins 73 files from the current clean snapshot: all four requested evidence packages, crosswalk and DDL baseline/inventory, canonical migration, migration-contract and migrations infrastructure, and all eight startup-owner source files. This is a current-snapshot integrity boundary only; no comparison to the approved HEAD is claimed. Git path proof covers this package's changed paths only; it does not claim that every file in Git history originated under this directory. The automatically attached review input under `attached_assets/` is recorded as an external, auto-attached provenance input and is not part of this package or its protected 73-file set.

## R-1–R-9 correction provenance

The correction instructions were read in full from `attached_assets/Pasted-Implementiraj-korekcije-prema-poslednjoj-nezavisnoj-Cla_1789626811403.txt`. They reproduce the review findings; a separate full Claude report for this revision was not located. Do not claim an independent review has approved these corrections.

- Baseline for this correction: `536e1743211fb10788d72ec9ac7b44f12871dff3`.
- Earlier automatic attachment commit: `fb44ef9886b647015abf119af846fe1c9574d8c9`, containing only the earlier `attached_assets/Pasted-Implementiraj-ispravke-iz-poslednje-nezavisne-Claude-Co_1789625695493.txt` input.
- Earlier implementation commit: `536e1743211fb10788d72ec9ac7b44f12871dff3`, containing the previous eight-file implementation. The attachment commit is not its final HEAD.
- The new R-1–R-9 attachment was untracked at the initial inspection. No attachment commit for it existed at that point.
- These corrections are working-tree changes, not a manually created implementation commit. The final handoff must report the freshly observed HEAD and status, separately from the baseline and attachment history. A later automatic checkpoint is not something this document can predict.

SQL validation is static and per statement, not proof of PostgreSQL runtime behavior. Result-byte caps remain an executor obligation; an SQL row LIMIT does not bound bytes. Blocker rationales are validated against reviewed, requirement-specific text rather than treating arbitrary long prose as evidence. Editing those rationales requires explicit re-review of the validation policy.
