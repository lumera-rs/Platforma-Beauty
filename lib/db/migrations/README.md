# Lumera migrations

This directory is the single filesystem authority for future Lumera database
migrations. It intentionally contains no migration yet.

Each migration must use exactly this layout:

```text
000001_add_customer_preferences/
  migration.sql
000002_create_delivery_zone_index/
  migration.sql
```

## Contract

- Directory names start with exactly six digits and a lowercase snake_case
  purpose: `NNNNNN_meaningful_purpose`.
- A purpose contains at least two descriptive words of at least two characters
  each. Generic words and version labels are rejected mechanically; reviewers
  remain responsible for confirming that an otherwise valid purpose is useful.
- Numbering starts at `000001`, increases by one, has no gaps or duplicates,
  and a sequence number is never reused.
- Purposes must describe the schema change. Dates, branch/task identifiers,
  and generic purposes such as `fix`, `final`, `final_fix`, `v2`, `new`,
  `update`, or `changes` are forbidden.
- A migration directory contains exactly one regular file named
  `migration.sql`. Symlinks, nested directories, and sidecar metadata are not
  allowed by this contract.
- Applied or protected migrations are immutable. Corrections use a new
  sequence number; historical directories are never edited, renamed, removed,
  replaced, or renumbered.
- `manifest.json`, Drizzle `meta/_journal.json`, ledger data, baseline files,
  and migration-runner metadata are deliberately outside this task.

## Reference history

The verifier compares this directory with an explicitly supplied local
reference directory. CI must check out the protected branch or commit into a
separate directory, then pass its `lib/db/migrations` path with
`--reference-dir`. The verifier never fetches a branch and never guesses a
reference. A missing or unreadable reference fails verification. Current and
reference paths must resolve to independent physical directories; passing the
same directory through a direct path or symlink is rejected.

Example:

```bash
pnpm --filter @workspace/scripts exec tsx \
  ./src/migration-contract/verify-migration-contract.ts \
  --current-dir=../lib/db/migrations \
  --reference-dir=/path/to/protected-checkout/lib/db/migrations
```

`README.md` is the only non-migration entry allowed at the migration root.