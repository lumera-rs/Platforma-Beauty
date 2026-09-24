# Local provenance

## PR #41 ledger-fix current-source amendment census

Authority: the owner's explicit current-tier-only manifest and provenance
instruction after the PR #41 source fix stabilized. No source file was changed
by this amendment work, and no database or production call was made.

The required documentation validator was run before any edit. It failed closed
at the first drift with the exact message
`Error: protected hash drift: scripts/src/migrations/migrations.integration.test.ts`.
Exact stdout, stderr, and exit code are preserved in
`.local/ledger-fix/hashes/docvalidators-before.*`.

The complete direct-byte census covered all 158 current-tier entries: 73 D
`currentInputs` plus 85 E `files`. Before amendment, 154 matched and exactly
four entries mismatched across two files; every mismatch was a working-tree
source change and there were zero unrelated mismatches.

| Path | Old current hash | Actual byte hash / new current hash | Current tiers | Reason |
| --- | --- | --- | --- | --- |
| `scripts/src/migrations/migrations.integration.test.ts` | `b67c1049062066350c9ffb4520b80f4c03dcffbe5dda7ac5ebef4fd831cc162f` | `cd67046171376c988977b9ebbf51baa6678701b95633d93ba6571e80ac2b2528` | D `currentInputs`; E `files` | Adds legacy seven-column ledger read, refusal non-mutation, and transactional rollback coverage. |
| `scripts/src/migrations/read-only-ledger.ts` | `000ba6a0551bc966d56cf640dae60b99f5748a1d4adf6d78e2e13a21b40c811d` | `56b95c66410137cb8c666b359b52ebb24a458a19e5a2db8c4d2ee5cf2062c5ab` | D `currentInputs`; E `files` | Recognizes both the legacy seven-column and identity-extended ledger shapes in read-only preflight. |

The third stabilized source change,
`scripts/src/schema-drift/eligibility-cli.test.ts`, is not a path in either
current-tier inventory, so it correctly requires no protected hash amendment.
The two protected source files produce four current-tier amendments. Finalizing
D requires one enclosing E `files` cascade amendment for
`docs/production-diagnostic-design/protected-input-manifest.json`:
`b65f40e7ec6fe6f49999f69cc86317c255e41ae042e7fea78f25e935461fc75f`
to
`077982b28392b35dfdc42504f19c808b20d5dbc7cca862ece5098fef72f56822`.
The batch therefore contains exactly five current-tier hash amendments.

All 146 historical entries reproduce from `git show b8f30561:<path>`. The D
historical `inputs` raw block is byte-identical to `origin/main` (8,954 bytes,
SHA-256
`f189dd413b3b6564faf10bd5c53d294483e6e05a4f21af5cbd72535bfe967a29`);
the E historical `originalProtectedFiles` raw block is also byte-identical
(8,971 bytes, SHA-256
`74a5b036d043d0a8071e52d7d0bc4824797cd1429d05e0691319740c375dfd9f`).
No historical tier was amended.

The full documentation suite then passed with the exact summary lines
`PASS: reusable authoritative validator and 114 exact-rule deep-cloned negative cases`,
`validate.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.`,
`validation.test.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.`,
`ℹ tests 13`, `ℹ pass 13`, `ℹ fail 0`, and `ℹ skipped 0`.
Exact stdout, empty stderr, and zero exit code are preserved in
`.local/ledger-fix/hashes/docvalidators-final.*`.

## Ledger-identity current-source amendment census

Authority: the owner's explicit current-tier-only manifest and provenance
instruction. The finalized source runbook and ledger-identity implementation
were inputs to this amendment; no source file was changed by this work.

The required validator command was run before any edit and stopped at the first
measured drift with the exact error
`Error: protected hash drift: scripts/src/migrations/PHASE-5B-RUNBOOK.md`.
Its complete stdout, stderr, and exit code are preserved under
`.local/ledger-identity/hashes/docvalidators-before.*`.

An independent full byte census then hashed all 158 current-tier entries:
73 diagnostic `currentInputs` and 85 execution `files`. There were exactly 18
pre-amendment mismatches across nine source files, and 140 matches. Every
mismatching path was present in `git diff --name-only $(git merge-base
origin/main HEAD)` including working-tree changes; there were zero unrelated
mismatches.

The complete source-hash amendments are:

| Path | Old current hash | Actual byte hash / new current hash | Current tiers |
| --- | --- | --- | --- |
| `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | `ac91ce554de4001c6572f46220684b1b7df44e573f86349fe77ff957731b6faf` | `832392d292ff377d47538d40d3e24908a0daf650f11aae73fdc2147b13bef9ec` | D `currentInputs`; E `files` |
| `scripts/src/migrations/cli.ts` | `e166821057a679feba8f043ed7f053e0a006158569705cfb13b3ea6b5d0b6070` | `31a5fe124772a6ef54be67bd96e37ef11cc1c6f3d59cb0ba3f251cc637511429` | D `currentInputs`; E `files` |
| `scripts/src/migrations/index.ts` | `b5f45f9657442748d34c68850773e72954a52d6aee5cdbab44dea745615d1c8e` | `cfe65b428ab40e8427b45f3ff623a2a12f5b71e497ec145cb504b0e97cbe3bcf` | D `currentInputs`; E `files` |
| `scripts/src/migrations/ledger.ts` | `efd64df8d8968eedcd83d9bf4ff948c084462a0fef742e6a41dc7b405f73451c` | `7aed7a5d699cc74acc6b05ad7b65c1f59351c406c6b1b4f12e0511d3da03a026` | D `currentInputs`; E `files` |
| `scripts/src/migrations/migrations.integration.test.ts` | `4d7afaf96db9a01b3ac607c2facfd744bea98e64c027a965a46711c618cc4720` | `b67c1049062066350c9ffb4520b80f4c03dcffbe5dda7ac5ebef4fd831cc162f` | D `currentInputs`; E `files` |
| `scripts/src/migrations/migrations.test.ts` | `5e4788a7f896581518fde50cbb21a55fe4942a26f74a3c5a5a22356d445ee95f` | `fa0e88f0352003f30310f96a9de8d8fd979a50611fb2e779cdafe30bf59ea378` | D `currentInputs`; E `files` |
| `scripts/src/migrations/read-only-ledger.ts` | `4ab94212812b8a897d989b837f628935ed5ec83eab35489ef15ff88f808a7b61` | `000ba6a0551bc966d56cf640dae60b99f5748a1d4adf6d78e2e13a21b40c811d` | D `currentInputs`; E `files` |
| `scripts/src/migrations/runner.ts` | `ae6972ada8abb89cb21e0137be268ce3f7f0abdc0790b7cbc5e2f68eea58457f` | `66db1519141f507d70ee4561346a4be61a1a5f48d5ec83fe4c6aecf296b4d796` | D `currentInputs`; E `files` |
| `scripts/src/migrations/types.ts` | `7f01d8bdea395c225cab03a83c91285f7e76af098cd78811e36b3c3d5de86871` | `32382f2fc32a80abfd8e0eb7c4c6f4b0ad11761469b8e62a169d8b4d6ee521a5` | D `currentInputs`; E `files` |

These are 18 current-tier source amendments. After finalizing D, the necessary
dependent E `files` amendment for
`docs/production-diagnostic-design/protected-input-manifest.json` is
`54b1e3901ba893db332da4f2f01aa30b2b57a231eb2d38f5bba683592a722e69`
to
`b65f40e7ec6fe6f49999f69cc86317c255e41ae042e7fea78f25e935461fc75f`.
The batch therefore has exactly 19 current-tier hash amendments.

All 146 historical entries were independently reproduced from
`git show b8f30561:<path>` bytes and matched. The D historical `inputs` raw
block is byte-identical to `origin/main` (8,954 bytes, SHA-256
`f189dd413b3b6564faf10bd5c53d294483e6e05a4f21af5cbd72535bfe967a29`);
the E historical `originalProtectedFiles` raw block is likewise byte-identical
(8,971 bytes, SHA-256
`74a5b036d043d0a8071e52d7d0bc4824797cd1429d05e0691319740c375dfd9f`).
No historical tier or source was amended.

The full documentation command then passed. Its exact summary messages include
`PASS: reusable authoritative validator and 114 exact-rule deep-cloned negative cases`,
`validate.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.`,
`validation.test.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.`,
`ℹ tests 13`, `ℹ pass 13`, `ℹ fail 0`, and `ℹ skipped 0`.
Exact stdout, empty stderr, and zero exit code are preserved under
`.local/ledger-identity/hashes/docvalidators-final.*`.

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

## PR #39 follow-up — independently verifiable Neon identity hashes

Authority: the follow-up attachment's `HASHES` instruction, authorizing only
current-source amendments for branch-changed files and the dependent manifest
cascade. The pre-amendment HEAD is
`b2a106588de1ae1f67a658ed1595adbcd2bc727c`; the `origin/main` comparison point
is `f6e113e5aaec78fd27ff2ae4ca07c8bf61e420c2`.

Before amendment, the documentation command failed closed on protected hash
drift at `scripts/src/migrations/PHASE-5B-RUNBOOK.md`. A direct census then
hashed every current-tier file byte: all 73 diagnostic `currentInputs` entries
and all 85 execution-plan `files` entries. Exactly six entries drifted, covering
the same three source files in both manifests. Every one of those source files
differs from `origin/main`; no unchanged-file drift was present.

### Complete source-amendment table

| Manifest | File | Tier | Old SHA-256 | New SHA-256 |
| --- | --- | --- | --- | --- |
| Diagnostic | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | `currentInputs` | `fcdc99105bc5bc43af7c21ce7161193f9f4e1624cbfccd8723a502b69e772819` | `fdbf7cfb9a3565c9a3c1abcfa60b83debe5aec391ca36fe8d68b0f075e4ead43` |
| Diagnostic | `scripts/src/migrations/cli.ts` | `currentInputs` | `d1cfd28d7e2067abd52133aede3a72630fa7560bb85c0ef413b89e22e4136333` | `711a76f7f2c5b028f3f9fcf4f151d32a9a1b33db2e5eb28d905982e318842470` |
| Diagnostic | `scripts/src/migrations/migrations.test.ts` | `currentInputs` | `8eae2ec809853f6584d2541bb20d0826c5cc3d42e4dcc72df9dc2f7482f243b9` | `5e4788a7f896581518fde50cbb21a55fe4942a26f74a3c5a5a22356d445ee95f` |
| Execution | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | `files` | `fcdc99105bc5bc43af7c21ce7161193f9f4e1624cbfccd8723a502b69e772819` | `fdbf7cfb9a3565c9a3c1abcfa60b83debe5aec391ca36fe8d68b0f075e4ead43` |
| Execution | `scripts/src/migrations/cli.ts` | `files` | `d1cfd28d7e2067abd52133aede3a72630fa7560bb85c0ef413b89e22e4136333` | `711a76f7f2c5b028f3f9fcf4f151d32a9a1b33db2e5eb28d905982e318842470` |
| Execution | `scripts/src/migrations/migrations.test.ts` | `files` | `8eae2ec809853f6584d2541bb20d0826c5cc3d42e4dcc72df9dc2f7482f243b9` | `5e4788a7f896581518fde50cbb21a55fe4942a26f74a3c5a5a22356d445ee95f` |

These are the already-completed follow-up changes for the independently
verifiable Neon project/branch discriminator, its command-line flags and unit
regressions. This hash batch changes none of those source bytes. Other
branch-changed source and test files are outside both protected inventories.

### Dependent diagnostic-manifest cascade

After the three diagnostic current-source replacements were final, the
diagnostic manifest was rehashed and its enclosing execution-plan entry was
amended:

| Manifest | File | Tier | Old SHA-256 | New SHA-256 |
| --- | --- | --- | --- | --- |
| Execution | `docs/production-diagnostic-design/protected-input-manifest.json` | `files` | `61be0fd4c590a9167c5938a5b0af5a69cdfb1a70600cd44745113d5479e84846` | `4736bc587d191649bfccfa22833571a80ed87d398241c91418b2d54ebe77ca1b` |

This follow-up therefore amends exactly seven current-tier hashes: three
diagnostic source entries, the same three execution source entries, and one
execution cascade entry.

Both complete historical JSON object blocks were extracted from working-tree
bytes and directly compared with the corresponding `git show origin/main:...`
bytes. Each comparison was raw-byte-identical. Excluding property names and
indentation, each 73-entry object is 8,940 bytes with SHA-256
`3c4a2766d5d728e4bfb35cda5cfdeea563be9218169979abcd61e95d6205b31d`.
No historical value, path inventory, pin, SQL, validator, or source file is
amended by this batch.

The final complete census has zero residual drift across all 158 current-tier
entries. The final diagnostic and execution-plan manifest SHA-256 values are
`4736bc587d191649bfccfa22833571a80ed87d398241c91418b2d54ebe77ca1b`
and `6c697edfcd8029d499c2340713d86b3c5f4d9acbe0a2a99e3d6361524616888d`.
Documentation validation passed both validators and all 13 regression tests:
zero failed, zero cancelled and zero skipped; the diagnostic validator covered
114 exact-rule negative cases and the execution validator rejected all 65
negative fixtures with exact errors. The protected-document diff passes
`git diff --check`. This batch edits only the two protected manifests and this
provenance append; it performs no database, secret, workflow, source, commit or
push operation.

## Operator-measured restore evidence — documentation-only amendment

The operator supplied a real Restore from history observation on the `probni`
Neon project: branch `br-falling-surf-b1mlfio0`, named `production`, retained its
ID after restore, while Neon created a separate `production_old_...` backup.
The runbook and follow-up report now attribute this measured evidence to the
operator and require re-reading the branch ID in the console after every
restore before migrations. No new restore or database connection was performed.

A complete census of 73 diagnostic and 85 execution current entries found only
the changed runbook drifting, once in each tier. The documentation-only change
requires these current-tier amendments and its dependent manifest cascade:

| Entry | Old SHA-256 | New SHA-256 |
| --- | --- | --- |
| Diagnostic `currentInputs`: runbook | `fdbf7cfb9a3565c9a3c1abcfa60b83debe5aec391ca36fe8d68b0f075e4ead43` | `9146cfa96f8b30f9fe9fe97ad35c17ebab57dcb6a568a249eca61075e25a6809` |
| Execution `files`: runbook | `fdbf7cfb9a3565c9a3c1abcfa60b83debe5aec391ca36fe8d68b0f075e4ead43` | `9146cfa96f8b30f9fe9fe97ad35c17ebab57dcb6a568a249eca61075e25a6809` |
| Execution `files`: diagnostic manifest | `4736bc587d191649bfccfa22833571a80ed87d398241c91418b2d54ebe77ca1b` | `f3cc0da821e992ce133aa14227bd739bd3c5fb7a3a05a8aa5d5cea85c8980c42` |

Historical tiers are unchanged. No executable source, tests, SQL, or validators
were modified.
Validation passed all 13 documentation tests and both documentation validators.
The final census matches all 158 current hashes, and both historical object
blocks remain raw-byte-identical to `origin/main`. `git diff --check` passed.

## Task 4 external database — protected current-source amendments

Authority: the owner's explicit Task 4 instruction to complete the full
protected-document census, amend only branch-changed current-source entries,
carry the nested manifest cascade, and preserve historical bytes. Source was
declared frozen before this census. The branch is `phase7/external-database`;
the pre-amendment HEAD and `origin/main` comparison point are both
`397670ef781e9a21d7f63cbac2881c857ce07d38`.

Before manifest edits, every current entry was independently SHA-256 hashed:
all 73 diagnostic `currentInputs` entries and all 85 execution-plan `files`
entries. Exactly four entries drifted, representing the same two protected
source files in both manifests. Both files differ from `origin/main`; no
unchanged-file drift was present.

### Complete source-amendment table

| Manifest | File | Tier | Old SHA-256 | New SHA-256 |
| --- | --- | --- | --- | --- |
| Diagnostic | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | `currentInputs` | `9146cfa96f8b30f9fe9fe97ad35c17ebab57dcb6a568a249eca61075e25a6809` | `ac91ce554de4001c6572f46220684b1b7df44e573f86349fe77ff957731b6faf` |
| Diagnostic | `scripts/src/migrations/cli.ts` | `currentInputs` | `711a76f7f2c5b028f3f9fcf4f151d32a9a1b33db2e5eb28d905982e318842470` | `52aca56792e3d608f64a53a5e3dbdab6d02f887c1dea3bc3170ecd8cd9754722` |
| Execution | `scripts/src/migrations/PHASE-5B-RUNBOOK.md` | `files` | `9146cfa96f8b30f9fe9fe97ad35c17ebab57dcb6a568a249eca61075e25a6809` | `ac91ce554de4001c6572f46220684b1b7df44e573f86349fe77ff957731b6faf` |
| Execution | `scripts/src/migrations/cli.ts` | `files` | `711a76f7f2c5b028f3f9fcf4f151d32a9a1b33db2e5eb28d905982e318842470` | `52aca56792e3d608f64a53a5e3dbdab6d02f887c1dea3bc3170ecd8cd9754722` |

The runbook change limits the previously recorded restore observation to the
Neon root branch and states that child branches do not support point-in-time
restore. The CLI change rejects unrecognized `--expected-*` target-identity
flags. These are already-frozen branch source changes; this documentation batch
does not edit their bytes.

### Dependent diagnostic-manifest cascade

The execution-plan entry for the diagnostic manifest matched before this batch.
After both diagnostic current-source replacements were final, the diagnostic
manifest was rehashed and the authorized enclosing entry was amended:

| Manifest | File | Tier | Old SHA-256 | New SHA-256 |
| --- | --- | --- | --- | --- |
| Execution | `docs/production-diagnostic-design/protected-input-manifest.json` | `files` | `f3cc0da821e992ce133aa14227bd739bd3c5fb7a3a05a8aa5d5cea85c8980c42` | `33dba74c15c296eb85aa55fe0684dc493fa36dfa2f1a46216924fe35b130912e` |

This batch therefore amends exactly five current-tier hashes: two diagnostic,
the same two execution source entries, and one execution cascade entry.

Both complete 73-entry historical objects were extracted as raw bytes and
compared directly with `git show origin/main:...`; both are byte-identical.
Each object is 8,940 bytes with SHA-256
`3c4a2766d5d728e4bfb35cda5cfdeea563be9218169979abcd61e95d6205b31d`.
All 146 historical values were also checked against the corresponding file
bytes at pinned commit `b8f30561`. No historical hash, path inventory, pin,
SQL, validator, source file, database, secret, deployment, or workflow is
amended by this documentation batch.

The final complete census has zero residual drift across all 158 current
entries. Final manifest SHA-256 values are
`33dba74c15c296eb85aa55fe0684dc493fa36dfa2f1a46216924fe35b130912e`
for the diagnostic manifest and
`7ab6e77bff13725c3dc42302ccb91804337e1205ec497577f5eb80d5c4a764a6`
for the execution-plan manifest.

After the final root-script freeze, documentation validation passed both
validators: 114 diagnostic exact-rule negative cases and 65 execution negative
fixtures. All 13 regression tests passed with zero failures, cancellations, or
skips. `git diff --check` passed for the owned documentation files. The new root
integration script and the final duplicate-`?host=` runtime fix are outside the
protected inventories and required no additional manifest amendment.

## Task 4 contract correction — protected current-source amendments

Authority: the owner's explicit instruction after the CLI worker declared its
edits final to run the complete protected census, amend only branch-changed
current-source entries, carry the final nested-manifest cascade, and preserve
both historical tiers byte-identical to `origin/main`. The branch is
`phase7/external-database`; HEAD was
`d46370bbdfcb5944bfe0acb77d398bca869cc43d` and the `origin/main` comparison
point was `397670ef781e9a21d7f63cbac2881c857ce07d38`.

Before manifest edits, all 73 diagnostic `currentInputs` entries and all 85
execution-plan `files` entries were independently SHA-256 hashed from current
file bytes. Exactly two entries drifted: the same branch-changed
`scripts/src/migrations/cli.ts` path in both current tiers. The protected
runbook entry and every other current entry matched. No unchanged-file drift was
present.

### Complete amendment table

| Manifest | File | Tier | Old SHA-256 | New SHA-256 |
| --- | --- | --- | --- | --- |
| Diagnostic | `scripts/src/migrations/cli.ts` | `currentInputs` | `52aca56792e3d608f64a53a5e3dbdab6d02f887c1dea3bc3170ecd8cd9754722` | `24811339e61e712f40c4a0f9506de07f5cccdba9650188e122ddd2eb004fa716` |
| Execution | `scripts/src/migrations/cli.ts` | `files` | `52aca56792e3d608f64a53a5e3dbdab6d02f887c1dea3bc3170ecd8cd9754722` | `24811339e61e712f40c4a0f9506de07f5cccdba9650188e122ddd2eb004fa716` |
| Execution | `docs/production-diagnostic-design/protected-input-manifest.json` | `files` | `33dba74c15c296eb85aa55fe0684dc493fa36dfa2f1a46216924fe35b130912e` | `71746b6bf78fc41e0a1be49595988844bb905dc33f1d69a9d2e5b445e169c8f7` |

The CLI correction makes colon-delimited unknown `--expected-*` target-identity
flags fail closed as intended. After both direct current-tier replacements were
final, the diagnostic manifest was rehashed and only then was its enclosing
execution-plan `files` entry amended. This batch therefore amends exactly three
current-tier hashes: two direct entries and one dependent cascade.

Both complete 73-entry historical objects were extracted as raw bytes and
compared with `git show origin/main:...`. Both are 8,940 bytes, have SHA-256
`3c4a2766d5d728e4bfb35cda5cfdeea563be9218169979abcd61e95d6205b31d`,
and are raw-byte-identical to `origin/main`. All 146 historical values were also
independently checked against their corresponding file bytes at pinned commit
`b8f30561`, with zero mismatches.

The final complete census has zero residual drift across all 158 current
entries. Final manifest SHA-256 values are
`71746b6bf78fc41e0a1be49595988844bb905dc33f1d69a9d2e5b445e169c8f7`
for the diagnostic manifest and
`843c6675a00b7643c6626de7820d8933993616e72941f17bfe849348f5100a30`
for the execution-plan manifest.

Validation command
`pnpm --filter @workspace/scripts run test:reconstruction:docs` passed both
validators: 114 diagnostic exact-rule negative cases and 65 execution negative
fixtures. All 13 documentation regression tests passed with zero failures,
cancellations, or skips. This amendment performs no historical-tier, source,
SQL, database, secret, deployment, workflow, staging, or commit operation.

## Task 4 second correction — protected current-source amendments

Authority: the owner's instruction after the CLI implementation was declared
final to run a complete protected-input census, amend only branch-changed
current-source entries, apply the dependent manifest cascade, and preserve both
historical tiers raw-byte-identical to `origin/main`. The branch is
`phase7/external-database`; the pre-amendment HEAD is
`9abb2f557d3c4eac0c65c011d8a49d1065b5e808`, and the `origin/main`
comparison point is `397670ef781e9a21d7f63cbac2881c857ce07d38`.

Before manifest edits, all 73 diagnostic `currentInputs` entries and all 85
execution-plan `files` entries were independently hashed from current file
bytes. Exactly two entries drifted: `scripts/src/migrations/cli.ts` in the two
current tiers. That path is changed by this branch relative to `origin/main`;
every other current entry matched, so no unchanged-file stop condition applied.

| Manifest | File | Tier | Old SHA-256 | New SHA-256 |
| --- | --- | --- | --- | --- |
| Diagnostic | `scripts/src/migrations/cli.ts` | `currentInputs` | `24811339e61e712f40c4a0f9506de07f5cccdba9650188e122ddd2eb004fa716` | `91fd907aeea08fffc2b40175e28b51f6248b9a6b097d1d24b95a476a5c3c453e` |
| Execution | `scripts/src/migrations/cli.ts` | `files` | `24811339e61e712f40c4a0f9506de07f5cccdba9650188e122ddd2eb004fa716` | `91fd907aeea08fffc2b40175e28b51f6248b9a6b097d1d24b95a476a5c3c453e` |
| Execution | `docs/production-diagnostic-design/protected-input-manifest.json` | `files` | `71746b6bf78fc41e0a1be49595988844bb905dc33f1d69a9d2e5b445e169c8f7` | `046c4fa06f15c99e4dba7a139f2fac1f1247bfa42b8abf568630c65381a53b3a` |

The finalized CLI gives every unrecognized `--expected-*` spelling the generic
`Unrecognized --expected- argument at position N` failure. Focused CLI coverage
reported 12 passes, and guard coverage reported 6 passes. After the two direct
current-tier replacements, the diagnostic manifest was rehashed and only then
was its enclosing execution-plan entry amended. This batch therefore changes
exactly three current-tier hashes.

Both complete 73-entry historical objects were extracted from the working-tree
files and compared as raw bytes with their corresponding `git show
origin/main:...` objects. Both are 8,940 bytes with SHA-256
`3c4a2766d5d728e4bfb35cda5cfdeea563be9218169979abcd61e95d6205b31d`
and are byte-identical to `origin/main`. All 146 historical values were also
independently checked against their pinned `b8f30561` file bytes with zero
mismatches. No historical value, inventory, pin, source, SQL, database, secret,
workflow, staging, commit, or deployment is changed by this batch.

The post-cascade census found zero residual drift across all 158 current
entries. Final manifest SHA-256 values are
`046c4fa06f15c99e4dba7a139f2fac1f1247bfa42b8abf568630c65381a53b3a`
for the diagnostic manifest and
`c4edaf95b871ca9d6adf16bd8e875ea076e3fec955e37fa911859880b4e35eaf`
for the execution-plan manifest.

Database-free documentation validation passed both validators: 114 diagnostic
exact-rule negative cases and 65 execution negative fixtures. All 13
documentation regression tests passed with zero failures, cancellations, or
skips. `git diff --check` passed at this stage. The concurrent full Phase 5 run
is deliberately not claimed here; its final evidence belongs in the external
database verification record after the implementation owner reports completion.

## Final CLI correction — protected current-source amendments

Authority: the owner's instruction after the CLI implementation was declared
final to run the complete 158-entry protected-input census, amend only
branch-changed current-source entries, apply the dependent diagnostic-manifest
cascade, and preserve both historical tiers raw-byte-identical to
`origin/main`. The pre-amendment HEAD is
`9f87856694da3a2230c3faabda1376542e4fdad3`, and the `origin/main`
comparison point is `397670ef781e9a21d7f63cbac2881c857ce07d38`.

Before manifest edits, all 73 diagnostic `currentInputs` entries and all 85
execution-plan `files` entries were independently SHA-256 hashed from current
file bytes. Exactly two entries drifted: `scripts/src/migrations/cli.ts` in the
two current tiers. That path is changed by this branch relative to
`origin/main`; every other current entry matched, so no unchanged-file stop
condition applied.

| Manifest | File | Tier | Old SHA-256 | New SHA-256 |
| --- | --- | --- | --- | --- |
| Diagnostic | `scripts/src/migrations/cli.ts` | `currentInputs` | `91fd907aeea08fffc2b40175e28b51f6248b9a6b097d1d24b95a476a5c3c453e` | `e166821057a679feba8f043ed7f053e0a006158569705cfb13b3ea6b5d0b6070` |
| Execution | `scripts/src/migrations/cli.ts` | `files` | `91fd907aeea08fffc2b40175e28b51f6248b9a6b097d1d24b95a476a5c3c453e` | `e166821057a679feba8f043ed7f053e0a006158569705cfb13b3ea6b5d0b6070` |
| Execution | `docs/production-diagnostic-design/protected-input-manifest.json` | `files` | `046c4fa06f15c99e4dba7a139f2fac1f1247bfa42b8abf568630c65381a53b3a` | `54b1e3901ba893db332da4f2f01aa30b2b57a231eb2d38f5bba683592a722e69` |

The finalized CLI reports the exact generic
`Unrecognised --expected- argument at position N` failure without disclosing
the unrecognised argument. Focused CLI coverage reported 13 passes, and the
migration credential/capability contract reported 60 passes. After the two
direct current-tier replacements were final, the diagnostic manifest was
rehashed and only then was its enclosing execution-plan entry amended. This
batch therefore changes exactly three current-tier hashes.

Both complete 73-entry historical objects were extracted from the working-tree
files and compared as raw bytes with their corresponding
`git show origin/main:...` objects. Both are 8,940 bytes with SHA-256
`3c4a2766d5d728e4bfb35cda5cfdeea563be9218169979abcd61e95d6205b31d`
and are byte-identical to `origin/main`. All 146 historical values were also
independently checked against their pinned `b8f30561` file bytes with zero
mismatches. No historical value, inventory, pin, source, SQL, database, secret,
workflow, staging, commit, or deployment is changed by this batch.

The post-cascade census found zero residual drift across all 158 current
entries. Final manifest SHA-256 values are
`54b1e3901ba893db332da4f2f01aa30b2b57a231eb2d38f5bba683592a722e69`
for the diagnostic manifest and
`0f42aa918c2bd889b4d75e72c2d98a3662b46d1bb727b46b1c6fe121b373d0e1`
for the execution-plan manifest.

Database-free documentation validation passed both validators: 114 diagnostic
exact-rule negative cases and 65 execution negative fixtures. All 13
documentation regression tests passed with zero failures, cancellations, or
skips. The independent post-cascade census again found zero mismatches across
all 158 current entries.

## Phase 7 data transfer — protected-input census

Authority: the owner required a complete protected-input census for the data
transfer branch, amendments only for branch-changed protected current sources,
the dependent manifest cascade when applicable, and preservation of both
historical tiers. The pre-census HEAD and `origin/main` comparison point were
both merge commit `f13ddcb803425e749dd19425eb3084da550c6007`.

Before any manifest edit, all 73 diagnostic `currentInputs` entries and all 85
execution-plan `files` entries were independently SHA-256 hashed from current
file bytes. All 158 matched. None of the 26 branch-changed tracked or untracked
paths was present in either protected current-source inventory. The two
database-free validators therefore passed before amendment rather than
reporting protected drift:

```text
PASS: reusable authoritative validator and 114 exact-rule deep-cloned negative cases
validate.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.
```

Consequently this batch contains zero direct current-source hash amendments
and zero manifest-cascade amendments. Both protected manifests remain
byte-for-byte unchanged, with SHA-256 values:

```text
077982b28392b35dfdc42504f19c808b20d5dbc7cca862ece5098fef72f56822  docs/production-diagnostic-design/protected-input-manifest.json
aa571f342da682d785dfde5ab898f23f025f843a3282ed94c225e75363c6a821  docs/production-evidence-execution-plan/protected-input-manifest.json
```

Both complete 73-entry historical objects were extracted from the
working-tree manifests and compared as raw bytes with their corresponding
`git show origin/main:...` objects. Both are 8,940 bytes with SHA-256
`3c4a2766d5d728e4bfb35cda5cfdeea563be9218169979abcd61e95d6205b31d`
and are byte-identical to `origin/main`. All 146 historical values were also
independently reproduced from the corresponding file bytes at pinned commit
`b8f30561d658d7a87d06d520002d4136855e85e1`, with zero mismatches.

No historical value, protected inventory, hash, source, SQL, database, secret,
deployment, or publication is changed by this census. This provenance section
records the required zero-amendment result; the data-transfer implementation,
tests, proof reports, CI wiring, and their operational evidence are owned by
their respective verification records.

## Phase 7 data transfer guard correction — final protected-input census

This section supersedes the preceding data-transfer census because the branch
subsequently changed `scripts/src/destructive-harness-registry.ts`,
`scripts/src/run-api-regressions-lifecycle.test.ts`, and unit-command package
wiring. The earlier zero-amendment evidence remains above as an accurate record
of the earlier tree, but is not the final branch census.

The diagnostic and execution validators were run before any new manifest edit.
Both exited zero, so there was no protected-drift failure to quote:

```text
PASS: reusable authoritative validator and 114 exact-rule deep-cloned negative cases
validate.mjs: baseline valid; 65 negative fixtures rejected with exact errors; every mutation observed.
```

The complete recomputation independently hashed all 73 diagnostic
`currentInputs` entries and all 85 execution-plan `files` entries from the
current file bytes. All 158 matched. None of the 33 branch-changed tracked or
untracked paths, including the two corrected guard sources and package wiring,
is present in either protected current-source inventory. The authorized
amendment count is therefore exactly zero: no direct current-source
replacement and no nested manifest cascade.

Both protected manifests remain byte-for-byte unchanged:

```text
077982b28392b35dfdc42504f19c808b20d5dbc7cca862ece5098fef72f56822  docs/production-diagnostic-design/protected-input-manifest.json
aa571f342da682d785dfde5ab898f23f025f843a3282ed94c225e75363c6a821  docs/production-evidence-execution-plan/protected-input-manifest.json
```

Both complete historical objects remain raw-byte-identical to `origin/main`.
Each is 8,940 bytes with SHA-256
`3c4a2766d5d728e4bfb35cda5cfdeea563be9218169979abcd61e95d6205b31d`.
All 146 historical values also reproduce from pinned commit
`b8f30561d658d7a87d06d520002d4136855e85e1`, with zero mismatches. No
historical value, protected inventory, source, test, workflow, database,
secret, deployment, or publication is amended by this final census.