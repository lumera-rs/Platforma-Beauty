# Local provenance

## PR #35: complete current-source amendment census

Authority: the owner's explicit batch amendment instruction, including the
diagnostic-manifest cascade. This section supplements, without rewriting, the
existing Phase 6 provenance below.

Before any edits, SHA-256 was independently calculated from every current file's
bytes for D `currentInputs` (73 entries) and E `files` (85 entries).
Exactly 12 entries mismatched, covering six files. Each was confirmed changed
by `git diff --name-only $(git merge-base origin/main HEAD) HEAD`.
The computed merge base is `44ccaabd1cccf22843bb588249f0e96ce149de73`.
No drift involved an untouched file, so the stop condition did not trigger.

Before editing, every historical D `inputs` entry (73) and E
`originalProtectedFiles` entry (73) was independently checked by hashing
`git show b8f30561:<path>` bytes, not current source bytes. All 146 checks passed.
The resolved historical commit is `b8f30561d658d7a87d06d520002d4136855e85e1`.
No historical pin, historical tier, path inventory, SQL, runtime code, or
validator logic is amended by this batch.

### Complete BEFORE mismatch table and approved source amendments

D = `docs/production-diagnostic-design/protected-input-manifest.json`.
E = `docs/production-evidence-execution-plan/protected-input-manifest.json`.
The following rows were generated from the manifests and SHA-256 of file bytes.
For each of these 12 amendments, **Old hash** is the pre-edit recorded value and
**Actual before amendment / new hash** is both the independently measured
pre-edit file hash and the approved replacement. No hashes are shortened.
Reasons R1–R6 below apply to the corresponding file in both manifests.

| Manifest | File | Tier | Old hash | Actual before amendment / new hash | Branch changed |
| --- | --- | --- | --- | --- | --- |
| D | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | currentInputs | `7690186d2b64aa81584c0235d76bc58fc35f32f4bd2b86da97165b6cc029b7ac` | `c052b95ee50525e25e458d51fab68f1bd551c3b6abfba645b805434b271078ec` | Yes |
| D | `scripts/src/migrations/cli.ts` | currentInputs | `b4d9e0864411268985c19587a1806ecd6384ff677e3ed98c2ffddd52679f214f` | `6ae1e4fa44fe6714fe0718322433f50a6718129b1bfb3f5d186b6792ed033771` | Yes |
| D | `scripts/src/migrations/migrations.integration.test.ts` | currentInputs | `cc987accc3877d78735f135bc80c3b547efd4d0cdb360e17390b4a73a574120c` | `c036038e457751b6c0daa37e16c94bb7b63b142daf5c3e06e5abe7655c5c59c3` | Yes |
| D | `scripts/src/migrations/migrations.test.ts` | currentInputs | `8e999b726d0e1ea30ca09ca3703d30cb8bf8fc1cde7e40e918e0c8b75318b6fb` | `fad1450b48f44120bf3c0edbce24be2a19d5138ef8bba3d0c493557b26e10490` | Yes |
| D | `scripts/src/migrations/runner.ts` | currentInputs | `2787a118fc7aae4915ecc1a11d61b41b3f9df3a6fa67eb4c95105a3db27da557` | `cd563674d95e0e3eddb87312ef6a6ffc57fbeb6626c864e130c4d8ffaeb2bce5` | Yes |
| D | `scripts/src/migrations/types.ts` | currentInputs | `a16f325dda15ba696dd869c8b43e717263c34a283485d41e4e7109d8452f467e` | `7f01d8bdea395c225cab03a83c91285f7e76af098cd78811e36b3c3d5de86871` | Yes |
| E | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | files | `7690186d2b64aa81584c0235d76bc58fc35f32f4bd2b86da97165b6cc029b7ac` | `c052b95ee50525e25e458d51fab68f1bd551c3b6abfba645b805434b271078ec` | Yes |
| E | `scripts/src/migrations/cli.ts` | files | `b4d9e0864411268985c19587a1806ecd6384ff677e3ed98c2ffddd52679f214f` | `6ae1e4fa44fe6714fe0718322433f50a6718129b1bfb3f5d186b6792ed033771` | Yes |
| E | `scripts/src/migrations/migrations.integration.test.ts` | files | `cc987accc3877d78735f135bc80c3b547efd4d0cdb360e17390b4a73a574120c` | `c036038e457751b6c0daa37e16c94bb7b63b142daf5c3e06e5abe7655c5c59c3` | Yes |
| E | `scripts/src/migrations/migrations.test.ts` | files | `8e999b726d0e1ea30ca09ca3703d30cb8bf8fc1cde7e40e918e0c8b75318b6fb` | `fad1450b48f44120bf3c0edbce24be2a19d5138ef8bba3d0c493557b26e10490` | Yes |
| E | `scripts/src/migrations/runner.ts` | files | `2787a118fc7aae4915ecc1a11d61b41b3f9df3a6fa67eb4c95105a3db27da557` | `cd563674d95e0e3eddb87312ef6a6ffc57fbeb6626c864e130c4d8ffaeb2bce5` | Yes |
| E | `scripts/src/migrations/types.ts` | files | `a16f325dda15ba696dd869c8b43e717263c34a283485d41e4e7109d8452f467e` | `7f01d8bdea395c225cab03a83c91285f7e76af098cd78811e36b3c3d5de86871` | Yes |

Approved reasons (existing branch changes, not source edits made by this batch):

- R1 — `PHASE-5B-RUNBOOK.md`: branch-added migration preparation/runbook guidance.
- R2 — `cli.ts`: explicit expected-target identity parsing and propagation.
- R3 — `migrations.integration.test.ts`: branch-updated migration integration tests.
- R4 — `migrations.test.ts`: branch-updated migration unit tests.
- R5 — `runner.ts`: deployment-runtime boundary and target-identity enforcement.
- R6 — `types.ts`: expected-target identity option for migration runners.

### Thirteenth amendment: explicitly authorized diagnostic-manifest cascade

The nested D manifest entry was **not** a mismatch in the BEFORE census:

| Manifest | File | Tier | Old hash | Actual before amendment | Branch changed before batch |
| --- | --- | --- | --- | --- | --- |
| E | `docs/production-diagnostic-design/protected-input-manifest.json` | files | `081dcdd849ca69836802ee549e613155001076b4b9f94aaa2445c11e0668c713` | `081dcdd849ca69836802ee549e613155001076b4b9f94aaa2445c11e0668c713` | No |

After all six D `currentInputs` replacements were final, its final file bytes
were hashed again. The owner explicitly authorized this dependent amendment:

| Manifest | File | Tier | Old hash | New hash | Branch changed | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| E | `docs/production-diagnostic-design/protected-input-manifest.json` | files | `081dcdd849ca69836802ee549e613155001076b4b9f94aaa2445c11e0668c713` | `c487ac3398ec51fbdd570bbcb799dd04d6e83e7193b94e9527bac4e47b942308` | Yes, via this authorized working-tree amendment | Cascade from the six finalized D current-source amendments; not a historical-pin update |

This batch therefore amends exactly 13 current-tier hashes: six in D and seven
in E. The preceding Phase 6 sections remain historical provenance for their
respective amendments, not assertions of the latest current-source hashes.

### Batch validation

Ran `pnpm --filter @workspace/scripts run test:reconstruction:docs` once after
the complete batch. Its command runs both validators before the validator
regression tests. The diagnostic validator passed its 114 exact-rule negative
cases; the execution validator passed its baseline and rejected all 65 negative
fixtures with exact errors. The test runner reported 13 passed, zero failed,
zero skipped.

An independent post-batch byte check confirmed all 158 current-tier entries
match their files, exactly 13 hash amendments exist, both historical blocks
remain raw-byte-identical to pre-batch HEAD, and every pre-existing provenance
section is preserved. Each of the 12 source table rows was programmatically
matched against the pre-batch manifest and current file digest. The diagnostic
manifest was unchanged versus the merge base before this authorized cascade.
`git diff --check` passed. Only the two manifests and this provenance document
were changed; no database action, workflow, commit, or push was performed.

## Phase 6: complete current-source amendment census

Compared every current-source entry in both protected-input manifests with
actual file bytes before this amendment: diagnostic `currentInputs` (73) and
execution-plan `files` (85). Exactly 18 entries drifted. Every covered file
differs from main because of this branch's authorized advisory-lock work.
There were no unrelated/untouched-file drifts.

In the complete pre-amendment table below:

- D = `docs/production-diagnostic-design/protected-input-manifest.json`.
- E = `docs/production-evidence-execution-plan/protected-input-manifest.json`.
- API = `artifacts/api-server/src/lib/`.
- Hashes are full SHA-256 values; "Actual before amendment" preserves the
  initial census, not an intermediate working-tree edit.

| Manifest | File | Tier | Recorded | Actual before amendment | Branch changed versus main |
| --- | --- | --- | --- | --- | --- |
| D | API`media-schema.ts` | currentInputs | `313ca81d6c08c7ca75973173d1ffa5b7b7a2fe47877f98a1ded3de0781d7cfe0` | `658c07ee3c9cbeb0df1b3df8b20ec05984842939f97ec23dfe00c9f6f53582d3` | Yes |
| D | API`shipping-config.ts` | currentInputs | `65bd907013564ae640dfce6c63c7c093ef42208d3ec262433a38b499c5a1bc1b` | `2a8ecd839029b212a9e82a28e6644a26dc04eda6db02d67d73e745ce470ed180` | Yes |
| D | API`marketplace-performance-schema.ts` | currentInputs | `892f271abcee6b6e20c2fcd4a38c17e53e3c7a78aaa19e363647e485036b890b` | `a3d53d830000822d578547079e9dc9a4723e5cc023522cd57decbd7b322beaa5` | Yes |
| D | API`referral-schema.ts` | currentInputs | `9a93ccf452ed78869a970bf5fe3d2878eeacdf878ceace07131efdefa675a9e5` | `7824c2a2a7d3a203e5540182bc462d9034c1684be7086640b49b43f79eb4497c` | Yes |
| D | API`web-push-schema.ts` | currentInputs | `5a27699abeebda158e129c120fb7380f1f362c16637e602e7d246ffe89efd051` | `6adce74c8098bcc9c71cc2b348047aff0ad4dd939e4dc56c935a39b35995d752` | Yes |
| D | API`booking-command-schema.ts` | currentInputs | `c2609996bf939510960ffb228248cf9463465ad3875b291907c85ba4c6f8566b` | `46385278f2e67f0e2bcbf5ddcf0e683547ade21c3a5804940ef8378810b845a0` | Yes |
| D | API`education-bundle-purchase-schema.ts` | currentInputs | `53cb4b3499f1bb369a9be3a50a45cfda7813d9c2d4a9ad4f481f75d97e8f5017` | `a0da3b7b0ca1985682c00a69ce9c05bb6f5cb8d8fae07b19470080e67901f7ca` | Yes |
| D | `scripts/src/migrations/lock.ts` | currentInputs | `25427b717e9b10b94a4fde71b11a03f0aa593d7e8592c504555fd3a8223e2f75` | `8a3a45f886d9c4a45c17cf717d70400e286aace47d279e885b2ad8a217402c47` | Yes |
| E | API`booking-command-schema.ts` | files | `c2609996bf939510960ffb228248cf9463465ad3875b291907c85ba4c6f8566b` | `46385278f2e67f0e2bcbf5ddcf0e683547ade21c3a5804940ef8378810b845a0` | Yes |
| E | API`business-growth-schema.ts` | files | `91c061a8e2e6c16ee01584d5692ad0d3ff29dc29e6b5aa10725ea29f04f84fe8` | `981434746172a7985ce9f63cff2e03e972e6b6c1a2d1f533f3a5194298058597` | Yes |
| E | API`education-bundle-purchase-schema.ts` | files | `53cb4b3499f1bb369a9be3a50a45cfda7813d9c2d4a9ad4f481f75d97e8f5017` | `a0da3b7b0ca1985682c00a69ce9c05bb6f5cb8d8fae07b19470080e67901f7ca` | Yes |
| E | API`marketplace-performance-schema.ts` | files | `892f271abcee6b6e20c2fcd4a38c17e53e3c7a78aaa19e363647e485036b890b` | `a3d53d830000822d578547079e9dc9a4723e5cc023522cd57decbd7b322beaa5` | Yes |
| E | API`media-schema.ts` | files | `313ca81d6c08c7ca75973173d1ffa5b7b7a2fe47877f98a1ded3de0781d7cfe0` | `658c07ee3c9cbeb0df1b3df8b20ec05984842939f97ec23dfe00c9f6f53582d3` | Yes |
| E | API`referral-schema.ts` | files | `9a93ccf452ed78869a970bf5fe3d2878eeacdf878ceace07131efdefa675a9e5` | `7824c2a2a7d3a203e5540182bc462d9034c1684be7086640b49b43f79eb4497c` | Yes |
| E | API`shipping-config.ts` | files | `65bd907013564ae640dfce6c63c7c093ef42208d3ec262433a38b499c5a1bc1b` | `2a8ecd839029b212a9e82a28e6644a26dc04eda6db02d67d73e745ce470ed180` | Yes |
| E | API`web-push-schema.ts` | files | `5a27699abeebda158e129c120fb7380f1f362c16637e602e7d246ffe89efd051` | `6adce74c8098bcc9c71cc2b348047aff0ad4dd939e4dc56c935a39b35995d752` | Yes |
| E | `docs/production-diagnostic-design/protected-input-manifest.json` | files | `7d8e97913e4de06eef499f97a4a9bb32ee80470989feebc4578fe80ce19572ac` | `2363a20ac5079ad54edbad0ad9d8176f4b88cdd8ab5f1ee8bdf55b42a768bb6a` | Yes |
| E | `scripts/src/migrations/lock.ts` | files | `25427b717e9b10b94a4fde71b11a03f0aa593d7e8592c504555fd3a8223e2f75` | `8a3a45f886d9c4a45c17cf717d70400e286aace47d279e885b2ad8a217402c47` | Yes |

### Approved cleanup-code amendments

For each of the 15 API-source entries above, the recorded value is the old
hash and the actual value is the new hash applied to that exact manifest/tier.
Media, shipping, referral, web-push, booking-command and education-bundle owners
now log advisory-unlock failure and destroy their pooled session. Marketplace
additionally destroys sessions after timeout restoration failure. Business
Growth carries unlock/reset failures through the existing unsafe-session
registry and destroys sessions after timeout or search-path restore failure.
These are the reasons for the corresponding whole-file hash changes.

The Business Growth protected segment remains 4,045 byte-identical bytes,
SHA-256 `7e8b60a40fd9fa15e27e49387193883ef2b9ca22c33882db9dc96d6a5dae9c48`.

### Supporting amendment: migration-lock comment (not cleanup code)

Both the D `currentInputs` and E `files` entries for
`scripts/src/migrations/lock.ts` change from
`25427b717e9b10b94a4fde71b11a03f0aa593d7e8592c504555fd3a8223e2f75` to
`8a3a45f886d9c4a45c17cf717d70400e286aace47d279e885b2ad8a217402c47`.
The file changed only to add the authorized warning about caller-owned,
single-connection pools being ended. This hash amendment is a consequence of
authorized supporting documentation, not a migration-lock cleanup-code fix.

### Supporting amendment: diagnostic manifest (not cleanup code)

The E `files` entry for
`docs/production-diagnostic-design/protected-input-manifest.json` changes from
`7d8e97913e4de06eef499f97a4a9bb32ee80470989feebc4578fe80ce19572ac` to
`081dcdd849ca69836802ee549e613155001076b4b9f94aaa2445c11e0668c713`.
The initial census value `2363a20ac5079ad54edbad0ad9d8176f4b88cdd8ab5f1ee8bdf55b42a768bb6a`
already reflected the earlier approved Phase 6 Business Growth amendment.
The final value also reflects the eight current-source amendments above.
This is a consequence of authorized manifest-content changes, not cleanup code.
The enclosing manifest is hashed only after its current-source edits are complete.

### Historical preservation

The 73-entry diagnostic `inputs` block and the 73-entry execution
`originalProtectedFiles` block are compared as raw text bytes against main,
not merely as parsed values. Both remain byte-identical, as do their path lists.
An intermediate unstaged edit accidentally matched duplicate hashes in the
diagnostic historical block; it was restored before validation or commit.
No historical amendments are part of the final diff. No startup-DDL inventory,
baseline, or runtime source is changed by this hash amendment.

## Phase 6: approved current-source advisory-lock amendment

The owner authorized this one amendment to the diagnostic manifest's
`currentInputs` tier:

- `artifacts/api-server/src/lib/business-growth-schema.ts`:
  old `91c061a8e2e6c16ee01584d5692ad0d3ff29dc29e6b5aa10725ea29f04f84fe8`;
  new `981434746172a7985ce9f63cff2e03e972e6b6c1a2d1f533f3a5194298058597`.
  The advisory-lock cleanup fix and sibling session-restoration cleanup changed
  the file. The protected historical segment was proven byte-identical before
  and after the changes: 4,045 bytes, SHA-256
  `7e8b60a40fd9fa15e27e49387193883ef2b9ca22c33882db9dc96d6a5dae9c48`.

All 73 historical diagnostic `inputs` and all 73 execution
`originalProtectedFiles` entries remain byte-identical to main. No other
manifest entry, startup-DDL inventory, or baseline is amended by this approval.

## Open Phase 6 item: historical fixture provenance

The fixture source commit `815465404f7e` declared in
`historical-source-fixture.ts` is not present on GitHub, so that fixture's
provenance is not reproducible from the remote. It does not currently block CI
because the identifier is compared only as a string and is never passed to Git.
The fixture and its declared source commit remain unchanged; remote
reproducibility is an open Phase 6 item.

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

## PR #35 gap closure: current-source amendment census

This is a new, owner-authorized batch after the earlier PR #35 amendment;
all previous provenance is retained unchanged. The pre-batch HEAD is
`4842d7f3c067c854212f531b0ccb7ddbc20dad58`. The computed
`git merge-base origin/main HEAD` remains
`44ccaabd1cccf22843bb588249f0e96ce149de73`.

Before any manifest edits, all 158 current-tier entries were rehashed from
actual working-tree bytes: D `currentInputs` (73), E `files` (85).
There were exactly eight mismatches, four files in each manifest. Every
mismatching file is changed against the branch merge base, including the
pending gap-closure edits; none is unrelated or untouched. Before edits, all
146 historical entries (73 D `inputs`, 73 E `originalProtectedFiles`) were
independently reproduced from `git show b8f30561:<path>` bytes, resolving to
`b8f30561d658d7a87d06d520002d4136855e85e1`. All matched, so neither stop
condition applied. Historical hashes are not checked against current source.

### Complete BEFORE mismatch table and eight source amendments

D = `docs/production-diagnostic-design/protected-input-manifest.json`.
E = `docs/production-evidence-execution-plan/protected-input-manifest.json`.
Rows are derived programmatically from the pre-edit manifests and SHA-256 of
file bytes. Each actual BEFORE hash is also the approved replacement hash.
The unchanged 150 current entries were checked too; the nested D entry among
them requires the separate authorized cascade below.

| Manifest | File | Tier | Old hash | Actual before amendment / new hash | Branch changed |
| --- | --- | --- | --- | --- | --- |
| D | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | currentInputs | `c052b95ee50525e25e458d51fab68f1bd551c3b6abfba645b805434b271078ec` | `97c6dfa0503dc4cf4975269a663031c0477d211c48edce91b13102208d19ee5a` | Yes |
| D | `scripts/src/migrations/migrations.integration.test.ts` | currentInputs | `c036038e457751b6c0daa37e16c94bb7b63b142daf5c3e06e5abe7655c5c59c3` | `6d35f2c94d68be26d51f803fd8a8633cf2137490f7fe41974ed402a9e7455afe` | Yes |
| D | `scripts/src/migrations/migrations.test.ts` | currentInputs | `fad1450b48f44120bf3c0edbce24be2a19d5138ef8bba3d0c493557b26e10490` | `59fea3cda8dfa52640ccfa0f926c8034fc87d2220b4c877b1a20e9e9dc20d130` | Yes |
| D | `scripts/src/migrations/runner.ts` | currentInputs | `cd563674d95e0e3eddb87312ef6a6ffc57fbeb6626c864e130c4d8ffaeb2bce5` | `811c486a2d360983da1a387ceea034b139f48fc3c4667708a180708308caad41` | Yes |
| E | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | files | `c052b95ee50525e25e458d51fab68f1bd551c3b6abfba645b805434b271078ec` | `97c6dfa0503dc4cf4975269a663031c0477d211c48edce91b13102208d19ee5a` | Yes |
| E | `scripts/src/migrations/migrations.integration.test.ts` | files | `c036038e457751b6c0daa37e16c94bb7b63b142daf5c3e06e5abe7655c5c59c3` | `6d35f2c94d68be26d51f803fd8a8633cf2137490f7fe41974ed402a9e7455afe` | Yes |
| E | `scripts/src/migrations/migrations.test.ts` | files | `fad1450b48f44120bf3c0edbce24be2a19d5138ef8bba3d0c493557b26e10490` | `59fea3cda8dfa52640ccfa0f926c8034fc87d2220b4c877b1a20e9e9dc20d130` | Yes |
| E | `scripts/src/migrations/runner.ts` | files | `cd563674d95e0e3eddb87312ef6a6ffc57fbeb6626c864e130c4d8ffaeb2bce5` | `811c486a2d360983da1a387ceea034b139f48fc3c4667708a180708308caad41` | Yes |

Reasons, applying to each corresponding D/E row:

- `PHASE-5B-RUNBOOK.md`: gap-closure migration identity and execution guidance.
- `migrations.integration.test.ts`: migration identity gap-closure regressions.
- `migrations.test.ts`: migration identity gap-closure unit regressions.
- `runner.ts`: unconditional target-identity verification at the top of apply
  and baseline adoption, including canonical, empty, and replay paths.

These are existing gap-closure source changes owned by the implementation
agent. This documentation batch changes none of their bytes.

### Ninth amendment: final diagnostic-manifest cascade

The nested diagnostic-manifest entry matched before this batch:

| Manifest | File | Tier | Old hash | Actual before amendment | Branch changed |
| --- | --- | --- | --- | --- | --- |
| E | `docs/production-diagnostic-design/protected-input-manifest.json` | files | `c487ac3398ec51fbdd570bbcb799dd04d6e83e7193b94e9527bac4e47b942308` | `c487ac3398ec51fbdd570bbcb799dd04d6e83e7193b94e9527bac4e47b942308` | Yes, earlier authorized PR #35 amendment |

Only after all four D current-source changes were final was its file rehashed:

| Manifest | File | Tier | Old hash | New hash | Branch changed | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| E | `docs/production-diagnostic-design/protected-input-manifest.json` | files | `c487ac3398ec51fbdd570bbcb799dd04d6e83e7193b94e9527bac4e47b942308` | `3cce68d8c934cd5e5fedf707ccb3a222cb29c3c225ac2ab0fe99819102767dc4` | Yes, including this explicitly authorized amendment | Cascade from four final D current-source replacements |

Exactly nine current hashes are amended in this batch: four D and five E.
Historical tiers, pins, path inventories, SQL, runtime code, validator logic,
and the parent-owned deployment-runtime memory file are outside this batch.

### Gap-closure documentation validation

Ran `pnpm --filter @workspace/scripts run test:reconstruction:docs` once after
the final manifest batch. Both validators passed: diagnostic validation
included 114 exact-rule negative cases; execution validation rejected all 65
negative fixtures with exact errors. The regression runner reported 13 passed,
zero failed, zero skipped. `git diff --check` passed.

The independent post-batch check confirmed all 158 current hashes match file
bytes, exactly nine current-tier values differ from pre-batch HEAD, both
historical blocks remain raw-byte-identical, every new source-table row matches
the pre-batch manifest and measured file hash, and all prior provenance remains
an unchanged prefix. No database operation, workflow, commit, or push was
performed by this documentation batch. Source tests running concurrently are
owned by the implementation agent; later source edits require another census.

## Public salon address — Stage A protected-input census

Authority: the public-salon-address instructions in attachments
`1790022190230` and `1790026199502`, requiring a complete current-source census
and historical byte preservation for each stage. This audit covers Stage A
only on `feature/public-salon-address`, before its commit and before Stage B.
The main baseline and pre-audit HEAD are
`c760ce098a632263d51160841b7defee85241d6b`.

All 158 current-source entries were independently SHA-256 hashed from file
bytes: 73 diagnostic `currentInputs` entries and 85 execution-plan `files`
entries. The complete mismatch list is empty (`[]`): **zero source amendments
and zero dependent manifest-cascade amendments**. No old/new hash rows exist
because no protected file drifted. The Stage A source, generated API, test,
release-chain and timing changes require no protected-input hash replacement.
Branch eligibility was checked against `git diff --name-only` from the main
baseline; any drift outside that changed-file set would have stopped the audit.

Both entire protected manifests are byte-identical to their main-baseline
versions, compared directly with `git show <baseline>:<manifest>`. Both
historical tiers were also explicitly compared as raw text bytes, not merely
as parsed objects. Their unchanged block SHA-256 values are:

| Manifest | Historical tier | Entries | Raw-block SHA-256, identical to main |
| --- | --- | --- | --- |
| `docs/production-diagnostic-design/protected-input-manifest.json` | inputs | 73 | `c00f5f9f73c32f816674bca87668414560edea564976f769f7d5de9875087680` |
| `docs/production-evidence-execution-plan/protected-input-manifest.json` | originalProtectedFiles | 73 | `1161b1c0cb6b8e2520e7993f88634e66c039b2d4babad8783ec399361c43ae17` |

Additionally, all 146 historical hashes were independently reproduced from
their pinned `b8f30561` Git file bytes. No historical pin, manifest entry, SQL,
runtime source, or validator logic was changed by this audit. Existing
provenance remains unchanged above.

Validation: ran `pnpm --filter @workspace/scripts run test:reconstruction:docs`
once after the Stage A census. Both validators passed: diagnostic validation
included 114 exact-rule negative cases; execution validation rejected all 65
negative fixtures with exact errors. The regression runner reported 13 passed,
zero failed, zero skipped. This audit makes no database connections, starts no
servers or workflows, and performs no commit or push. Stage B was not started.

## Public salon address — Stage B protected-input amendments

Authority: the public-salon-address instructions in attachments
`1790022190230` and `1790026199502`. This batch follows the Stage A commit
`c2ecfd2f0798bc4e1bc08e7a91e040f2bacd5bd1` and precedes the Stage B commit.
Branch eligibility and historical preservation are checked against **main**
`c760ce098a632263d51160841b7defee85241d6b`, not merely the Stage A commit.
All earlier provenance, including the Stage A zero-drift audit, is retained.

Before editing, independently hashing all 158 current-source entries found
exactly ten mismatches: five files in diagnostic `currentInputs` and the same
five in execution-plan `files`. All five files are changed on this branch
against main; no unrelated-file drift was found. Both historical tiers were
raw-byte-identical to main, and all 146 historical entries matched file bytes
at pinned `b8f30561`. Neither stop condition applied.

### Complete BEFORE mismatch table and ten source amendments

D = `docs/production-diagnostic-design/protected-input-manifest.json`.
E = `docs/production-evidence-execution-plan/protected-input-manifest.json`.
Each row is derived from manifest values and SHA-256 of actual file bytes.
The actual BEFORE hash is also the new approved current-source hash.

| Manifest | File | Tier | Old hash | Actual before amendment / new hash | Branch changed versus main |
| --- | --- | --- | --- | --- | --- |
| D | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | currentInputs | `97c6dfa0503dc4cf4975269a663031c0477d211c48edce91b13102208d19ee5a` | `b04526547e6e32e00c55dc0241cc18a69eef95235490ded190687ac3fd9fe251` | Yes |
| D | `scripts/src/migrations/manifest.ts` | currentInputs | `37c6b1ad27dc6b44edc7bb6ad1829f866d64448f2a4f5bf6f7461e4393671c5b` | `c5ced3b9b9fb486cdd4494b5347bd2caf47d8d37612f955b9c59ad765dde298f` | Yes |
| D | `scripts/src/migrations/migrations.integration.test.ts` | currentInputs | `6d35f2c94d68be26d51f803fd8a8633cf2137490f7fe41974ed402a9e7455afe` | `6418c5ff3ac6050187cc972546788bef8bbc92f97e0274a07f219119d4c3345c` | Yes |
| D | `scripts/src/migrations/migrations.test.ts` | currentInputs | `59fea3cda8dfa52640ccfa0f926c8034fc87d2220b4c877b1a20e9e9dc20d130` | `7dec6c6505da552438bb64b905d868f75215688575dc8c9a92e1e8811ab7d566` | Yes |
| D | `scripts/src/migrations/runner.ts` | currentInputs | `811c486a2d360983da1a387ceea034b139f48fc3c4667708a180708308caad41` | `ae6972ada8abb89cb21e0137be268ce3f7f0abdc0790b7cbc5e2f68eea58457f` | Yes |
| E | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | files | `97c6dfa0503dc4cf4975269a663031c0477d211c48edce91b13102208d19ee5a` | `b04526547e6e32e00c55dc0241cc18a69eef95235490ded190687ac3fd9fe251` | Yes |
| E | `scripts/src/migrations/manifest.ts` | files | `37c6b1ad27dc6b44edc7bb6ad1829f866d64448f2a4f5bf6f7461e4393671c5b` | `c5ced3b9b9fb486cdd4494b5347bd2caf47d8d37612f955b9c59ad765dde298f` | Yes |
| E | `scripts/src/migrations/migrations.integration.test.ts` | files | `6d35f2c94d68be26d51f803fd8a8633cf2137490f7fe41974ed402a9e7455afe` | `6418c5ff3ac6050187cc972546788bef8bbc92f97e0274a07f219119d4c3345c` | Yes |
| E | `scripts/src/migrations/migrations.test.ts` | files | `59fea3cda8dfa52640ccfa0f926c8034fc87d2220b4c877b1a20e9e9dc20d130` | `7dec6c6505da552438bb64b905d868f75215688575dc8c9a92e1e8811ab7d566` | Yes |
| E | `scripts/src/migrations/runner.ts` | files | `811c486a2d360983da1a387ceea034b139f48fc3c4667708a180708308caad41` | `ae6972ada8abb89cb21e0137be268ce3f7f0abdc0790b7cbc5e2f68eea58457f` | Yes |

Reasons, applying to both manifest rows for each file:

- `PHASE-5B-RUNBOOK.md`: required frontier now includes public salon entrance
  details migration 000003, without production authorization.
- `manifest.ts`: explicitly registers 000003 and its computed head metadata.
- `migrations.integration.test.ts`: Stage B full-chain migration regressions.
- `migrations.test.ts`: explicit updated manifest expectations for 000003.
- `runner.ts`: validates the completed catalog frontier for subsequent
  additive migrations and adoption replay while retaining admitted-transition
  checks for the supported data migration.

These source edits predate this hash batch and are owned by the implementation
agent. No source bytes, baseline pins, or migration SQL are edited here.

### Eleventh amendment: final diagnostic-manifest cascade

The nested entry was not a BEFORE mismatch:

| Manifest | File | Tier | Old hash | Actual before amendment | Branch changed before batch |
| --- | --- | --- | --- | --- | --- |
| E | `docs/production-diagnostic-design/protected-input-manifest.json` | files | `3cce68d8c934cd5e5fedf707ccb3a222cb29c3c225ac2ab0fe99819102767dc4` | `3cce68d8c934cd5e5fedf707ccb3a222cb29c3c225ac2ab0fe99819102767dc4` | No |

After all five diagnostic current-source changes were final, its file bytes
were rehashed and the explicitly authorized dependent entry amended:

| Manifest | File | Tier | Old hash | New hash | Branch changed | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| E | `docs/production-diagnostic-design/protected-input-manifest.json` | files | `3cce68d8c934cd5e5fedf707ccb3a222cb29c3c225ac2ab0fe99819102767dc4` | `cc5ca3028064bd35c6fbf10412f9f16b9853ff0481002f7583b20fd7222c186a` | Yes, via this authorized Stage B amendment | Cascade from five finalized diagnostic current-source replacements |

Exactly 11 current hashes are amended: five diagnostic and six execution-plan
entries. Historical blocks, their inventories, and historical pins remain
unchanged. Their raw-block SHA-256 values remain the two main-identical values
recorded in the Stage A audit above.

### Stage B documentation validation

Ran `pnpm --filter @workspace/scripts run test:reconstruction:docs` once after
the final manifest batch. Both validators passed: 114 diagnostic exact-rule
negative cases and 65 execution negative fixtures rejected with exact errors.
The regression runner reported 13 passed, zero failed, zero skipped.

An independent final check verified all 158 current hashes, exactly 11
current-tier amendments, both historical blocks byte-identical to main
`c760ce098a632263d51160841b7defee85241d6b`, all source table rows against
manifest/file bytes, and unchanged prior provenance. The final execution-plan
manifest SHA-256 is
`6c1ccffb4e9538fcd7ac7191b5c20db49b37667a961bfac303a6c351f8509804`.
`git diff --check` passed for these three documentation files. This batch
changed only the two protected manifests and this provenance document; it ran
no database tests or connections, servers, workflows, commits, or pushes.

## Public salon address — final CI scheduling audit

After Stage B commit `67bb260d409e70ca01b773ddfe9d65fd564021e7`, the CI
scheduling changes were audited separately. A fresh complete SHA-256 census
of all 158 current-tier entries found zero mismatches (`[]`), requiring zero
new hash amendments and zero cascade updates. Both manifests remain
byte-identical to that commit; the 11 approved Stage B amendments are preserved.

Both historical tiers (146 entries combined) remain raw-byte-identical to main
`c760ce098a632263d51160841b7defee85241d6b`. All 146 historical hashes were also
independently reproduced from pinned `b8f30561` Git file bytes. This audit
changes only this provenance document and does not run database operations,
servers, workflows, commits, or pushes.

Validation: `pnpm --filter @workspace/scripts run test:reconstruction:docs`
ran once after this audit note. Both validators passed (114 diagnostic negative
cases; 65 execution negative fixtures); all 13 regression tests passed with
zero failures and zero skipped tests.

## SEO part 2 — protected-input and path-scope audit

On `daily/2026-09-22`, the baseline and pre-audit HEAD are main
`a94abeeea316710c000629d4d78b8ce3c86bb5e8`. A complete SHA-256 census of
all 158 current-source entries (73 diagnostic `currentInputs`, 85 execution
`files`) found zero mismatches (`[]`). There are zero new amendments, no
old/new replacement rows, and no dependent cascade. Both entire manifests are
byte-identical to this main baseline, preserving the prior 11 amendments.

Both historical tiers were explicitly compared as raw text bytes with
`git show <main>:<manifest>` and are byte-identical. All 146 historical entries
were additionally reproduced from pinned `b8f30561` Git file bytes.

The complete tracked diff-name list against this main baseline and the
untracked-file list were checked directly, independently of tests. No changed
or new paths exist under `lib/db/` (including schema, migrations and
migration-runtime), `scripts/src/migrations/`, or `artifacts/api-server/`.
The same lists contain no path components naming booking, auth,
authorization, or baseline. This is a file-scope check, not an assertion about
every expression in changed frontend pages.

Only this audit note is added by the manifest audit. No manifest, source,
memory file, database, server, workflow, commit, or push is changed or operated
by this audit.

Validation: `pnpm --filter @workspace/scripts run test:reconstruction:docs`
ran once. Both validators passed (114 diagnostic negative cases and 65
execution negative fixtures); the regression runner reported 13 passed,
zero failed, zero skipped.

## Daily task 2 — city canonical and address-test follow-up audit

Authority: attachment `1790067612505`, with separate city-canonical/browser/
timing and address-test/provenance commits. The pre-audit HEAD is
`56a71599f41ccb5c378523e5b8f4e74319fcd3d6`; eligibility and historical parity
use main `a94abeeea316710c000629d4d78b8ce3c86bb5e8`.

A complete direct SHA-256 census checked all 158 current-source entries:
73 diagnostic `currentInputs` and 85 execution-plan `files`. The full drift
list is empty (`[]`): zero new current-hash amendments, zero old/new hash rows,
and zero manifest-cascade changes. Neither the canonical/browser/timing files
nor the two address-test files require a protected hash replacement. There is
therefore no first-commit hash subset to stage; this audit note accompanies
the second commit's existing Stage B provenance-reference correction.

Both entire manifests, including their historical tiers, remain byte-identical
to main a94. The 146 historical entries were also independently verified
against their pinned `b8f30561` Git file bytes. Prior approved hash amendments
are preserved without any manifest changes.

Direct inspection of all diff paths against main and all untracked paths found
no changes under `lib/db/` or `scripts/src/migrations/`. The only changed API
path is `artifacts/api-server/src/lib/appointment-routes.test.ts`, the expressly
authorized cross-salon-owner authorization regression test. No API
implementation, authentication/authorization engine, booking engine, database
schema, migration, or migration-runtime file is changed in those scopes.
`scripts/src/public-salon-address.test.ts` is the authorized whole-helper-result
test follow-up. This records file-scope evidence, not a substitute for the
implementation agent's test results.

This audit edits only this provenance document, preserving the worker's
correction to the real Stage B commit `67bb260d409e70ca01b773ddfe9d65fd564021e7`.
It performs no source/test edits, database operations, servers, workflows,
commits, or pushes.

Validation: `pnpm --filter @workspace/scripts run test:reconstruction:docs`
ran once for this task. Both validators passed (114 diagnostic negative cases;
65 execution negative fixtures), and all 13 regression tests passed with zero
failures and zero skipped tests.

## Job first publication — current-source hash amendment audit

Authority: the owner's first-publication task and explicit authorization to
amend changed current-source hashes with the full dependent manifest cascade.
Pre-audit HEAD is `43e0232770cb8c6d79735d781ab727a95265a808` on
`daily/2026-09-22`; historical parity uses main
`a94abeeea316710c000629d4d78b8ce3c86bb5e8`.

A complete direct census of all 158 current entries (73 diagnostic
`currentInputs`, 85 execution-plan `files`) identified exactly eight source
hash mismatches: the four branch-changed paths below in both manifests.
The new `000004` migration legitimately advances HEAD fingerprints/frontier;
baseline admission pins and previous migration entries are not rebaselined.
These are current-source amendments, not amendments to historical evidence.

| Changed source (amended in both current tiers) | Previous SHA-256 | Current SHA-256 |
| --- | --- | --- |
| `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | `b04526547e6e32e00c55dc0241cc18a69eef95235490ded190687ac3fd9fe251` | `34dcafd4006a51e5e04df0ec82c688b6578fefcd16d3e948ec51143cb6e2308d` |
| `scripts/src/migrations/manifest.ts` | `c5ced3b9b9fb486cdd4494b5347bd2caf47d8d37612f955b9c59ad765dde298f` | `e6f2ee512bf1938849ee73873ec6bf9809dfa7873823c92ee0a4fb1ac2eb2549` |
| `scripts/src/migrations/migrations.integration.test.ts` | `6418c5ff3ac6050187cc972546788bef8bbc92f97e0274a07f219119d4c3345c` | `4d7afaf96db9a01b3ac607c2facfd744bea98e64c027a965a46711c618cc4720` |
| `scripts/src/migrations/migrations.test.ts` | `7dec6c6505da552438bb64b905d868f75215688575dc8c9a92e1e8811ab7d566` | `8ddb6d2bbb7987e9bcafdce86b4955731b00bd054a823ddb187ebe5e1a6fd6d3` |

The ninth amendment is the dependent execution-plan `files` entry for
`docs/production-diagnostic-design/protected-input-manifest.json`:
`cc5ca3028064bd35c6fbf10412f9f16b9853ff0481002f7583b20fd7222c186a`
becomes
`dda1bbabb8f2ad72351a86546f50514f8b7db4437a5cbf28f0d650f403d3c13b`.
No other current entry is amended. Both immutable historical tiers remain
raw-byte-identical to main, with all 146 historical hashes independently
reproduced from pinned `b8f30561` Git bytes.

Final full-census and database-free documentation-validator results are
retained in ignored `recovery-backups/job-publication/protected-audit.json`
and `protected-docs-validators.log`. This audit owns only the two protected
manifests and this provenance note; it performs no application/migration code
edits, database operations, CI reads, deployments, Git staging, commits or
pushes.

Final census: all 158 current hashes match, with exactly nine approved
amendments and no residual drift; all 146 historical hashes match their
pinned Git bytes. Final execution-plan manifest SHA-256:
`f6f0a0aeeb493cc69d211d4e2bbbfc14a8623dbebac34656b9ce23cbc79ff99a`.
Validation: `pnpm --filter @workspace/scripts run test:reconstruction:docs`
passed all 13 regression tests, zero failures and zero skipped; both validators
passed their 114 diagnostic negative cases and 65 execution negative fixtures.
The protected-document diff passes `git diff --check`.

## Phase 7 target identity — protected current-source amendments

Authority: the owner's explicit authorization to amend protected current-source
hashes reported by the validators, including the final nested diagnostic-manifest
cascade. The branch and main baseline are
`phase7/target-identity-neon-branch` and
`f6e113e5aaec78fd27ff2ae4ca07c8bf61e420c2`, respectively.

Before editing, a complete direct SHA-256 census covered all 158 current-source
entries: 73 diagnostic `currentInputs` entries and 85 execution-plan `files`
entries. Exactly six entries mismatched, representing the same three source
files in both manifests. Each source file is changed by the branch relative to
`origin/main`; no drift involved an unchanged source file, so the stop condition
did not trigger.

### Complete source-amendment table

| Manifest | File | Tier | Old SHA-256 | New SHA-256 |
| --- | --- | --- | --- | --- |
| Diagnostic | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | `currentInputs` | `34dcafd4006a51e5e04df0ec82c688b6578fefcd16d3e948ec51143cb6e2308d` | `fcdc99105bc5bc43af7c21ce7161193f9f4e1624cbfccd8723a502b69e772819` |
| Diagnostic | `scripts/src/migrations/cli.ts` | `currentInputs` | `6ae1e4fa44fe6714fe0718322433f50a6718129b1bfb3f5d186b6792ed033771` | `d1cfd28d7e2067abd52133aede3a72630fa7560bb85c0ef413b89e22e4136333` |
| Diagnostic | `scripts/src/migrations/migrations.test.ts` | `currentInputs` | `8ddb6d2bbb7987e9bcafdce86b4955731b00bd054a823ddb187ebe5e1a6fd6d3` | `8eae2ec809853f6584d2541bb20d0826c5cc3d42e4dcc72df9dc2f7482f243b9` |
| Execution | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | `files` | `34dcafd4006a51e5e04df0ec82c688b6578fefcd16d3e948ec51143cb6e2308d` | `fcdc99105bc5bc43af7c21ce7161193f9f4e1624cbfccd8723a502b69e772819` |
| Execution | `scripts/src/migrations/cli.ts` | `files` | `6ae1e4fa44fe6714fe0718322433f50a6718129b1bfb3f5d186b6792ed033771` | `d1cfd28d7e2067abd52133aede3a72630fa7560bb85c0ef413b89e22e4136333` |
| Execution | `scripts/src/migrations/migrations.test.ts` | `files` | `8ddb6d2bbb7987e9bcafdce86b4955731b00bd054a823ddb187ebe5e1a6fd6d3` | `8eae2ec809853f6584d2541bb20d0826c5cc3d42e4dcc72df9dc2f7482f243b9` |

The runbook, CLI, and unit-test bytes are the already-completed Phase 7 target
identity changes. This documentation batch does not edit those source files.
The other branch-changed migration tests and target-identity files are not
members of either protected current-source inventory and therefore require no
manifest amendment.

### Final nested diagnostic-manifest cascade

The execution-plan `files` entry for the diagnostic protected-input manifest
matched its bytes before this batch. Only after the three diagnostic
`currentInputs` replacements were final was the diagnostic manifest rehashed,
and the explicitly authorized dependent entry was amended:

| Manifest | File | Tier | Old SHA-256 | New SHA-256 |
| --- | --- | --- | --- | --- |
| Execution | `docs/production-diagnostic-design/protected-input-manifest.json` | `files` | `dda1bbabb8f2ad72351a86546f50514f8b7db4437a5cbf28f0d650f403d3c13b` | `61be0fd4c590a9167c5938a5b0af5a69cdfb1a70600cd44745113d5479e84846` |

This batch therefore amends exactly seven current-tier hashes: three diagnostic,
three execution source hashes, and one execution cascade hash. Direct raw-byte
comparisons against `origin/main` prove that the complete 73-entry diagnostic
historical `inputs` block and complete 73-entry execution
`originalProtectedFiles` block are unchanged. Their compared raw-block sizes
and SHA-256 values are 8,954 bytes /
`f189dd413b3b6564faf10bd5c53d294483e6e05a4f21af5cbd72535bfe967a29`
and 8,968 bytes /
`1161b1c0cb6b8e2520e7993f88634e66c039b2d4babad8783ec399361c43ae17`,
respectively.

Validation: `pnpm --filter @workspace/scripts run test:reconstruction:docs`
completed without database access. The diagnostic validator passed its reusable
baseline and 114 exact-rule negative cases; the execution validator passed its
baseline and rejected all 65 negative fixtures with exact errors. The Node test
runner reported 13 passed, zero failed, zero cancelled, and zero skipped.

A final complete census found zero residual drift across all 158 current-source
entries. The final execution-plan manifest SHA-256 is
`f66f386878cf6c65ee05ca2a7ce8ed53309d67fa91de3b793410b5a777bdec47`.
The protected-document diff passes `git diff --check`. This batch edits only the
two protected manifests and this provenance document; it performs no source,
database, app-test, server, workflow, branch, commit, or push operation.