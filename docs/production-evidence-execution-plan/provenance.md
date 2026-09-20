# Local provenance

## Open Phase 7 item: wishlist historical operation ownership

The historical inventory retains the create-index operation for
`product_wishlists_user_product_variant_unique`. That standalone statement no
longer exists in current source: version 127 replaces it with conditional
index-to-constraint adoption and validation. The authorized historical/current
two-tier split preserves the evidence but defers, rather than resolves, this
operation mismatch. Phase 7 must classify this historical operation and assign
its migration owner, as it must for every historical operation. No historical
identity, baseline or application logic is changed by this note.

## Combined Phase 5 local integration

The owner authorized local integration on base
`83efbf71bbd15317e9ff28aa5a8368aa0c9000be`, combining the authenticated Phase F
reconstruction, audit-gapfix, and commerce regression. The Phase F checksum-file
digest is `2d5ae50af4e22c706f4d20064d5dc3bf16ec9c1d8d7b82dce8bce6db2268cc40`;
the audit/commerce preservation checksum-file digest is
`d252b3fc8b076e28eb8e9bfdb59de24bc7ed1b08b651a4a8b996bf29fea40800`.

Only the current-source tiers receive these additional amendments:

- `artifacts/api-server/src/lib/business-growth-schema.ts`:
  `91c061a8e2e6c16ee01584d5692ad0d3ff29dc29e6b5aa10725ea29f04f84fe8`.
  The reconstruction's version 127 wishlist adoption/validation remains intact;
  the audit delta adds snapshot-backfill reset-failure connection destruction.
- `scripts/src/migrations/PHASE-5B-RUNBOOK.md`:
  `7690186d2b64aa81584c0235d76bc58fc35f32f4bd2b86da97165b6cc029b7ac`.
  The audit corrects current startup-removal status without asserting deployment
  authorization or changing historical operation evidence.
- Diagnostic current-source manifest:
  `7d8e97913e4de06eef499f97a4a9bb32ee80470989feebc4578fe80ce19572ac`,
  recorded in the execution manifest's current `files` map.

All 73 historical `inputs`, all 73 `originalProtectedFiles`, historical source
pins, baseline flags and evidence identities remain unchanged. The earlier
sections below describe their respective historical integration stages, not
the final combined source hashes. The advisory-lock unlock-failure defect
remains unresolved; this integration does not claim to fix it.

## Phase E: reviewed historical/current-source separation

Authority: the owner's Phase E two-tier correction and exact N1–N8 instructions.
The isolated reconstruction base is `83efbf71bbd15317e9ff28aa5a8368aa0c9000be`
(PR #30), branch `fix/wishlist-v127-phase-a-754e4e9efff9`.
All 73 historical `inputs` and `originalProtectedFiles` values remain unchanged.
Each was independently reproduced by SHA-256 of the corresponding file at
`b8f30561`, not by hashing the current working tree. The canonical sorted-entry
JSON digest is `ea939afa67068f34523fef2e76c811adeca39178ad5955959c8d4e7adceb14da`.
Both validators pin that authority independently; neither candidate manifest can
authorize amendments to the historical baseline.

The diagnostic `currentInputs` inventory is exactly the original 73 paths.
Its sorted-path JSON digest is
`2cf4681c2e15d0bbfeb5e9571083f9f5ccadc5e748561f0a44dee0d282f5b8ef`.
The execution `files` inventory is unchanged, independently pinned by digest
`d0665f6c4d1a70e66fcf32acf417eb3fc02d558b98d6fcca1c04faa80510e438`.
Current hashes are checked against actual file bytes, independently of historical
values. No historical hash is used as a current-source expectation.

### Approved current-source amendments

Seven migration-tooling files below are **already in PR #30/base main**, not
Phase E application changes. Their actual reconstruction bytes were matched to
`git show 83efbf71bbd15317e9ff28aa5a8368aa0c9000be:<path>`.
Paths in this table are relative to `scripts/src/migrations/`.

| Path | Authenticated current SHA-256 |
| --- | --- |
| `manifest.ts` | `37c6b1ad27dc6b44edc7bb6ad1829f866d64448f2a4f5bf6f7461e4393671c5b` |
| `migrations.integration.test.ts` | `cc987accc3877d78735f135bc80c3b547efd4d0cdb360e17390b4a73a574120c` |
| `migrations.test.ts` | `8e999b726d0e1ea30ca09ca3703d30cb8bf8fc1cde7e40e918e0c8b75318b6fb` |
| `preflight.test.ts` | `0646575682471781c88b836a07ac061ceb751d5cdba4d6d005ef4864bbc78fb1` |
| `preflight.ts` | `7b989ff9bb40d894a25873b9bbb24a8a56211299fc3e848e5f226a7c9959fa66` |
| `runner.ts` | `2787a118fc7aae4915ecc1a11d61b41b3f9df3a6fa67eb4c95105a3db27da557` |
| `types.ts` | `a16f325dda15ba696dd869c8b43e717263c34a283485d41e4e7109d8452f467e` |

The integration test is the actual base-main version above, **not** the divergent
main-workspace branch version.

- **Phase A**: `artifacts/api-server/src/lib/business-growth-schema.ts`,
  SHA-256 `87c148328fcbab2b3070940baeae4f02e2ee0598cdc920c2c0ff5aedaa74ceb1`.
  Matched actual bytes against the verified archive in
  `recovery-backups/wishlist-v127/phase-a-754e4e9efff9/final`;
  SHA256SUMS digest `2eb3775c28931a01dfb82749f9769e54420a504d26d3601b59205a376b773a7a`.
- **Phase C authenticated-history correction**:
  `scripts/src/startup-migration-crosswalk.ts`,
  SHA-256 `13d30e5971ed5285b799742b004155ce6a483d2cf5527e7950e8a80e91903c73`.
  Matched actual bytes against the verified archive in
  `recovery-backups/wishlist-v127/phase-c-correction-1789838890808/final-complete`;
  SHA256SUMS digest `ac5aeb2aaedfa1b21319f74a7e83cdaf50a5b3fce3991c394ae93379aef35779`.
- **Phase E documentation-only amendments**: execution `files` additionally
  records the new diagnostic manifest (`803bd9fdf57816b825aca65a2855daad5b7ba0d8d2505db9753fef981fa10341`)
  and diagnostic validator (`95183cd1834495f6c89601b75cfe2045a7c5085749c7660d8172679c164b21e6`).
  These implement the owner's two-tier policy and independent N7/N8/current-hash
  regressions. No application source was edited to satisfy a hash.

Thus nine historical/current differences are authorized (seven PR #30, one
Phase A, one Phase C). The execution tier has eleven incoming-hash amendments,
including the two reviewed Phase E documentation changes. All other protected
source hashes, SQL operation identities, migrations, canonical schema and source
pins remain unchanged. The incoming complete Phase E backup was authenticated
with SHA256SUMS digest
`43f93a42b52ac368d7cd8f7cde7a1b3d8dacfda3f7f4b68cbb97bcc60d51aa85`.

## Initial observation

- Initial HEAD: `b7aa1281621ef739f66da6e1cd4d78b7c1f99921`.
- Branch: `fix-production-demo-seed-boundary`.
- Initial tracked working tree: clean.
- Initial untracked input:
  `attached_assets/Pasted-Implementiraj-pripremu-kontrolisanog-prikupljanja-produ_1789628259200.txt`.
  The complete 248-line preparation instruction was read. It is a
  user-provided, automatically attached external input, not an implementation
  file in this package.

## Relevant inherited attachment history

`fb44ef9886b647015abf119af846fe1c9574d8c9` is an earlier attachment-only commit:
`attached_assets/Pasted-Implementiraj-ispravke-iz-poslednje-nezavisne-Claude-Co_1789625695493.txt`.
It is not this preparation's baseline or implementation HEAD.

`b7aa1281621ef739f66da6e1cd4d78b7c1f99921` contains the preceding R-1–R-9
implementation in five diagnostic-package files **and** its attachment,
`attached_assets/Pasted-Implementiraj-korekcije-prema-poslednjoj-nezavisnoj-Cla_1789626811403.txt`.
It is a mixed implementation/input checkpoint, not an attachment-only commit.

No automatic attachment commit for this new preparation request existed at
initial inspection. Any checkpoint created after the handoff must be identified
from its actual paths, not inferred from its subject or the previous report.
Historical attachment-only commits unrelated to this request are not presented
as changes made during this preparation.

## Implementation boundary

All implementation additions belong exclusively to
`docs/production-evidence-execution-plan/`. Existing approved packages, source
files, application configuration and authoritative statuses are immutable
inputs. The preparation creates no manual Git commit and performs no push,
merge, publish or deploy.

The final handoff reports a newly read HEAD and complete local status. A
working-tree addition is not a new implementation commit, and this document
does not predict future automatic checkpoints.