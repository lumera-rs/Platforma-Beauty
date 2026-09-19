# Pilot verification and preservation record

## Scope and provenance

Prepared by Replit Agent on 2026-09-16 for Task #938, replacing cancelled #937.
No independent review is claimed. This record reports local static/mock checks,
not production safety, completed migrations, or equivalence of transitions.

Initial HEAD:

```text
361c9a00e05fb54b87784193bf27a957e4dad670
```

Initial `git status --short --branch`:

```text
## fix-production-demo-seed-boundary...github/fix-production-demo-seed-boundary [ahead 27]
```

There were no initial tracked or untracked changes reported. No app workflow was
started or restarted for the pilot. No database, production endpoint, migration,
adoption, preflight, Publish, Deploy, push, merge, reset or rebase was used.
Documentation is the only deliverable. Existing unrelated running workflows
were not used as evidence or controlled by this task.

## Pre-execution no-database audit

The audit was completed before running the tests.

| Entry point | Inspected execution boundary | Conclusion |
|---|---|---|
| Evidence test | `scripts/src/additional-operations-evidence.test.ts:1-23,172-214` and `scripts/src/additional-operations-evidence-validation.ts` import filesystem/crypto/assert helpers and the static crosswalk; child processes read pinned objects using `git show` | Filesystem and Git-object reads; virtual mutations only |
| Crosswalk test | `scripts/src/startup-migration-crosswalk.test.ts:1-34,140-198`; builder runtime imports are Node helpers and TypeScript, with inventory imported as a type | SQL is source text, not sent to a database |
| Inventory test | `scripts/src/production-startup-ddl-inventory.test.ts:1-50` and inventory implementation | Reads/parses source and in-memory fixture strings; does not execute the application import graph |
| Startup safety test | `artifacts/api-server/src/lib/startup-ddl-safety.test.ts:15-45` defines FakeClient/fakePool; every ensure invocation supplies that override | Queries are collected as strings by the fake; no real client |
| Lazy pool boundary | `artifacts/api-server/src/lib/startup-ddl-pool.ts:5-9` returns the provided override before dynamic import of the default DB package | Default pool path not taken |
| Scripts typecheck | `scripts/package.json:29`, `scripts/tsconfig.json`, `tsconfig.base.json` | TypeScript compilation only; does not execute imported application code |

The safety suite imports seven owners, not referral's runtime module.
`referral-schema.ts` has a runtime default-pool import and was **not added** to
the suite. The report reads that source as text only. DB schema declarations
used by other owners are not the DB pool entry point.

The root and scripts package lifecycle definitions have no pre/post hooks for
these focused commands. Root typecheck/build and broad backend tests were not
run. Because the shared TS configuration enables incremental output, the
approved scripts typecheck was run with `--incremental false` in addition to
its existing `--noEmit`. This is a write-prevention restriction, not a change
to checked source or compiler diagnostics.

This is a static call/import audit, not syscall/network interception. It proves
the inspected focused code paths use fake clients; it does not certify arbitrary
future imports or unrelated running processes.

## Historical checks executed for the original pilot, not rerun for this correction

### Evidence validation

```sh
pnpm --filter @workspace/scripts run test:additional-operations-evidence
```

Exit **0**; **8 passed, 0 failed, 0 skipped, 0 cancelled**.

```text
PASS additional evidence is schema-normalized, pin-authoritative, and unresolved
PASS narrative bypasses from the independent review are all rejected
PASS source evidence is non-shrinkable and reviewed code excerpts remain valid
PASS record identity, count, and nested-schema attacks are rejected
PASS source locator parser requires a span and preserves comma continuations
PASS integrity manifest covers every package file and derived source statistics
PASS pinned canonical baseline, inventory, owners, and reviewed pin remain intact
PASS pinned literal census remains complete and byte-identical
```

The passing first test checks 122 evidence items: 31 exact source slices,
91 reviewed-contained slices, zero reverse-containment and zero invalid items.
The reviewed evidence and census pins are checked through read-only Git objects.

### Scripts typecheck

```sh
pnpm --filter @workspace/scripts run typecheck --incremental false
```

Actual compiler command: `tsc -p tsconfig.json --noEmit --incremental false`.
Exit **0**, no diagnostics. No build outputs or tsbuildinfo were requested.

### Crosswalk, inventory and startup safety regressions

```sh
pnpm --filter @workspace/scripts exec tsx --test ./src/startup-migration-crosswalk.test.ts ./src/production-startup-ddl-inventory.test.ts ../artifacts/api-server/src/lib/startup-ddl-safety.test.ts
```

Exit **0**; **34 passed, 0 failed, 0 skipped, 0 cancelled**.

```text
PASS shipping rolls back a timeout-setup failure before releasing the client
PASS web push rolls back an advisory-lock failure before releasing the client
PASS marketplace preserves an index failure when timeout restoration also fails
PASS marketplace surfaces timeout restoration failure after successful indexes
PASS marketplace restores both previous timeout values after success
PASS marketplace restores both previous timeout values after startup failure
PASS media executes all 26 operations on one client and commits after them
PASS media rolls back an injected mid-rollout failure without committing
PASS education bundle rolls back replacement failure without committing
PASS booking command rolls back index failure without committing
PASS business growth restores previous timeouts after success
PASS business growth restores previous timeouts after startup failure
PASS real repository startup DDL owners and fingerprints match the reviewed baseline
PASS mutation tests reject direct, transitive, barrel, literal dynamic, and nonliteral DDL edges
PASS mutation tests reject a new ensure-style call and missing or changed known owners
PASS mutation tests reject callback, constructor, and object-method DDL wrappers
PASS module evaluation follows indirect executable DDL without classifying dead functions
PASS module evaluation keeps nested SQL sink traversal without double counting
PASS accounts for all 1,459 records with one mapping per fingerprint
PASS fails closed instead of inventing canonical, future, or retired equivalence
PASS extracts an exact object identity and review evidence for every mapping
PASS records additional non-DDL operations for every owner
PASS pins every executable startup SQL literal, including the sixteen formerly missed aliases
PASS fails closed for comment-prefixed, nested, and count-preserving unclassified startup SQL
PASS derives trigger parents from executable source or marks them dynamic
PASS preserves exact source positions, source order, full SQL, and dynamic identity semantics
PASS owner report reconciles resolved and unresolved counts
PASS rejects missing, duplicate, unsupported, and inconsistent mappings
PASS rejects every unresolved-classification and canonical-evidence bypass
PASS rejects reordered mappings, reordered occurrences, and fabricated source positions
PASS rejects fabricated crosswalk metadata and canonical baseline identifiers
PASS rejects removal or fabrication of additional operations
PASS rejects canonical migration checksum drift
PASS JSON and owner report generation are deterministic
```

Application logger messages such as “schema is ready” appeared during fake-client
tests. They are emitted by tested functions after fake queries; **they do not
report a database operation or a real schema state**.

## Initial immutable-input SHA-256 inventory

Captured before report creation using `sha256sum` over the paths below. These
are evidence pins for this report, not changes to authoritative pins.

```text
7d7917b2a948858d77bdcb00767e4098ef9c2d1f56faac37914eef4e3dcdbb17  scripts/src/startup-migration-crosswalk.ts
a8bcfc8731d8017f901dde01e04d5fd78ad1f930b0562a6a642d980483f465e2  scripts/src/production-startup-ddl-baseline.json
c144af7eac62a020a2f5e7edc5e54d07abdac8df077c9c76878eb07ced31ada7  docs/additional-operations-evidence/bg-data.json
e2f3f86a8701c2c400689e3c5dd8770b9d74ffb82c96b7c6d3626d80b3880969  docs/additional-operations-evidence/bg-data.md
b1cb0e2453f24c8b8bcc2b09146db0f1767f3f396c16c2a9783031ccd17f976c  docs/additional-operations-evidence/bg-functions.json
76c297cc5fdbb8e78186d700c4e2574deb3ec3d9dde32b7dd45176875bc414fe  docs/additional-operations-evidence/bg-functions.md
485e0200ec8a8e620a35c0509c095abc13572966029f85c8ba3f9158cee0e5ed  docs/additional-operations-evidence/census.json
a0c92596b2ef854323486aa4ceb69759009e0db9e1b62c6e7f5c7a701d319f42  docs/additional-operations-evidence/census.md
c9c16b327c5174ba4388c14f4d37efc2ff75d4b4b781d19ee26a4a62b6b212d1  docs/additional-operations-evidence/complete-evidence.json
fa77a4eec94e8701f0edaf622f6ee3e99c5f2dc22d35a2604b22d7f19fd85ead  docs/additional-operations-evidence/complete-report.md
f34f4eae2227bdf7241ade5bdb424a093170906807d9a8d78c7070e9b7ad3928  docs/additional-operations-evidence/context.md
dcbb262ade0aded130ec874d3fa177b050a6b88487296eac5ecb66c57adb60da  docs/additional-operations-evidence/DDL-RESOLUTION-METHODOLOGY.md
c0821e45ecebabbdaeafef6fdcb30b7de136b60b42c72edc7c3e3f2d7179d75e  docs/additional-operations-evidence/other-owners.json
9d0ea5bfb6d20339d98db11dd5e854398886226edbc1f9b862762be3969f3a36  docs/additional-operations-evidence/other-owners.md
f534b18c0d42c58c36c79a61377ac8f91193f5bbd34355477f7f05bc629bdbfd  docs/additional-operations-evidence/README.md
50524b64494afe79dbe556481c06ad7c4b20697f9205f43cecd8d36540a347bf  docs/additional-operations-evidence/verification.json
643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60  lib/db/migrations/000001_canonical_schema/migration.sql
000e7e2b564e450c6a16808bab372871c721d5faf9cd50d702cd76c90e573b30  artifacts/api-server/src/lib/business-growth-schema.ts
313ca81d6c08c7ca75973173d1ffa5b7b7a2fe47877f98a1ded3de0781d7cfe0  artifacts/api-server/src/lib/media-schema.ts
65bd907013564ae640dfce6c63c7c093ef42208d3ec262433a38b499c5a1bc1b  artifacts/api-server/src/lib/shipping-config.ts
892f271abcee6b6e20c2fcd4a38c17e53e3c7a78aaa19e363647e485036b890b  artifacts/api-server/src/lib/marketplace-performance-schema.ts
9a93ccf452ed78869a970bf5fe3d2878eeacdf878ceace07131efdefa675a9e5  artifacts/api-server/src/lib/referral-schema.ts
5a27699abeebda158e129c120fb7380f1f362c16637e602e7d246ffe89efd051  artifacts/api-server/src/lib/web-push-schema.ts
c2609996bf939510960ffb228248cf9463465ad3875b291907c85ba4c6f8566b  artifacts/api-server/src/lib/booking-command-schema.ts
53cb4b3499f1bb369a9be3a50a45cfda7813d9c2d4a9ad4f481f75d97e8f5017  artifacts/api-server/src/lib/education-bundle-purchase-schema.ts
```

## Meaning and limits

The tests prove the current inventory has eight owners, 1,459 occurrences and
1,435 unique unresolved DDL mappings, and that the 110 additional operations
and reviewed evidence remain unresolved and internally consistent.
They do not prove PostgreSQL acceptance, fresh-database semantic equivalence,
production preconditions, row correctness, duration of locks, real rollback,
actual extension versions, deployed revision overlap or historical retirement.
All required production-state gates in this pilot are **NOT SATISFIED**.

## Final document checks and Git state

The final document-specific checks used only the already-audited static builder,
filesystem reads and hashes. No validator source file was created or modified.
The following inline check was executed:

```sh
pnpm --filter @workspace/scripts exec tsx -e '
import {readFileSync} from "node:fs";
import {loadRepositoryCrosswalk} from "./src/startup-migration-crosswalk.ts";
const {crosswalk}=loadRepositoryCrosswalk(); let total=0;
for(const name of ["business-growth.md","other-owners.md","booking-push-bundle.md"]){
 const text=readFileSync("../docs/ddl-resolution-pilot/"+name,"utf8");
 const mappings=crosswalk.mappings.filter(m=>text.includes(m.fingerprint)); total+=mappings.length;
 const norm=(s:string)=>s.replace(/\s+/g," ").trim();
 for(const m of mappings) for(const o of m.occurrences){
  if(!text.includes(o.sourcePath)||!text.includes(o.sourceSqlChecksum))throw Error("Missing source evidence "+m.fingerprint);
  if(!norm(text).includes(norm(o.sourceSql))&&!text.includes(JSON.stringify(o.sourceSql)))throw Error("Missing full SQL "+m.fingerprint);
 }
 for(const [prefix,count] of [["CB",7],["FM",7],["RH",6]] as const) for(let i=1;i<=count;i++){
  const re=new RegExp("^\\| (?:\\*\\*)?"+prefix+i+"(?:\\*\\*)?(?: \\|| —)","gm");
  if([...text.matchAll(re)].length!==mappings.length)throw Error("Gate count "+name+prefix+i);
 }
}
if(total!==11)throw Error("Pilot count");
if(crosswalk.mappings.some(m=>m.status!=="UNRESOLVED")||crosswalk.additionalOperations.some(m=>m.status!=="UNRESOLVED"))throw Error("Status drift");
console.log("PASS: 11 fingerprints; exact locators/checksums; complete SQL; 220 gate rows; all authoritative statuses UNRESOLVED");
'
node <<'NODE'
const fs=require('fs'),crypto=require('crypto');const text=fs.readFileSync('docs/ddl-resolution-pilot/verification.md','utf8');let n=0;for(const m of text.matchAll(/^([a-f0-9]{64})  (.+)$/gm)){if(crypto.createHash('sha256').update(fs.readFileSync(m[2])).digest('hex')!==m[1])throw Error('Changed '+m[2]);n++;}console.log('PASS: initial pins unchanged',n);
NODE
for file in docs/ddl-resolution-pilot/*.md; do git diff --no-index --check /dev/null "$file"; done
git diff --check
git diff --name-only 361c9a00e05fb54b87784193bf27a957e4dad670
git rev-parse HEAD
git status --short --branch --untracked-files=all
```

Results:

```text
PASS: 11 fingerprints; exact locators/checksums; complete SQL; 220 gate rows; all authoritative statuses UNRESOLVED
PASS: initial pins unchanged 25
```

Both whitespace checks produced no diagnostics. The no-index check includes
new untracked documents, which ordinary `git diff --check` alone would miss.
The tracked-file comparison against the initial HEAD produced no paths.
The historical document check verifies selected evidence presence and gate-row
counts, **not dependency completeness**, the truth of prose, or semantic
equivalence. It did not independently derive expected dependency sets, detect
missing cross-owner edges, or require all owner-transaction backfills. Its
`text.includes(fingerprint)` selection also treats a supplementary fingerprint
as a core selection, so it must not be reused unchanged after F3. The original
passing result remains historical evidence only. The correction instead selects
the 11 explicit README table rows and compares dependency sets derived from
owner sources and complete-evidence, including in-memory omission checks.
Independent review must still challenge the bounded source interpretation.

A preliminary document check found Business Growth locators/ordinals copied
from other appearances of the same SQL. They were corrected against exact
fingerprint occurrences before delivery. Final source ordinals for the selected
Business Growth rename/extension/drop/validation are respectively 355/3/5/1348.
No authoritative input was changed to accommodate a report mismatch.

Final captured HEAD before the platform completion/checkpoint:

```text
361c9a00e05fb54b87784193bf27a957e4dad670
```

Final captured Git status:

```text
## fix-production-demo-seed-boundary...github/fix-production-demo-seed-boundary [ahead 27]
?? docs/ddl-resolution-pilot/README.md
?? docs/ddl-resolution-pilot/booking-push-bundle.md
?? docs/ddl-resolution-pilot/business-growth.md
?? docs/ddl-resolution-pilot/other-owners.md
?? docs/ddl-resolution-pilot/verification.md
```

These five new documentation files were the complete changed-file list in the
**pre-completion working-tree snapshot above**, not the eventual committed
delivery. The earlier summary must not be read as a count of the final commit.
Read-only comparison of initial revision
`361c9a00e05fb54b87784193bf27a957e4dad670` with delivery revision
`f1ca85a8f7795c92453ee6bc52ba32d11a26515d` shows **six changed paths**:
the five added pilot documents and modified
`.agents/agent_assets_metadata.toml`. The extra path is asset-registration
metadata, not a sixth pilot document. Its placement in the delivery is
established by Git; the diff alone does not prove which actor wrote it.
Application code, authoritative evidence, canonical migration and owner sources
were unchanged in that comparison. No historical commit or metadata is
modified to make the count agree with the former summary.

Reproduction (read-only):

```sh
git diff --name-status 361c9a00e05fb54b87784193bf27a957e4dad670 f1ca85a8f7795c92453ee6bc52ba32d11a26515d
```

```text
M .agents/agent_assets_metadata.toml
A docs/ddl-resolution-pilot/README.md
A docs/ddl-resolution-pilot/booking-push-bundle.md
A docs/ddl-resolution-pilot/business-growth.md
A docs/ddl-resolution-pilot/other-owners.md
A docs/ddl-resolution-pilot/verification.md
```

## Documentation correction: new evidence, separate from historical tests

Correction #940 follows the **user-supplied summary** of findings F2–F5.
The complete independent review was not supplied or claimed as read.
The starting revision was
`f1ca85a8f7795c92453ee6bc52ba32d11a26515d`, with a clean worktree and branch
`fix-production-demo-seed-boundary` ahead 28. All 25 pins above matched before
corrections. No previous suite result is represented as newly executed.

### Findings addressed

| Finding | Correction and location |
|---|---|
| F2 | `business-growth.md` and `booking-push-bundle.md` distinguish conditional first-owner validation, marker/full/recovery paths, payment function/trigger replacement and eighth-owner target-check replacement. Postconditions are scoped to statements, owners and successful later startup, not inferred from identical object names. |
| F3 | `business-growth.md` records selected `71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a` (`validate-constraint`) and supplementary `07e226d17976f0897da49e2a34fa14dd6a0534297bbb2b3d09187eecdaebbcc9` (`alter-table`), with full same-literal SQL, checksum, positions and separate ordinals. No merging/reclassification or expansion of the 11 core selections. |
| F4 | `booking-push-bundle.md` includes all four Education Bundle additional operations. The later learner-ID backfill is indirect same-transaction evidence, not excluded because it modifies other columns. `dependency-matrix.md` distinguishes the full BG payment update IDs from curated fast-path records. |
| F5 | `other-owners.md` explains the conditional timeout → INVALID index → later `IF NOT EXISTS` skip, absence of a validity postcondition/repair path, and why a later ready log can be misleading. Neither every timeout nor a production incident is asserted. |
| Dependency check | `dependency-matrix.md` derives bounded expected relationships from all eight owner sources and complete-evidence, compares all 11 rows, documents exclusions and supplements the individual reports. It checks missing/unknown/duplicate IDs and mapping-specific cross-owner/prerequisite sets. Negative cases mutate in-memory documented rows only. |
| File accounting | Original six-path commit evidence is above. This follow-up has six documentation paths below; original metadata is not modified by the follow-up. |

Gate assessments remain evidence-scoped: no production-dependent CB/FM/RH
gate is promoted to satisfied; all authoritative statuses remain UNRESOLVED.
The dependency checker is a **documentation consistency check**, not an
authoritative validator or an exhaustive SQL semantics engine. Source-anchor
selection and prerequisite interpretations are explicit, manually reviewable
assumptions; matching them does not prove production preconditions or
completeness beyond the matrix's stated dependency boundary.

### DB-free execution audit for this correction

Read-only Git, Node filesystem/crypto/JSON operations and the static crosswalk
builder were the execution boundary. The builder imports Node helpers and
TypeScript; its inventory import is type-only. `loadRepositoryCrosswalk`
reads the baseline/canonical and parses owner SQL as text; no owner module or
database package executes. Its CLI writes JSON to stdout, not the workspace.
The matrix's fenced checker imports only `node:fs` and `node:path`; it reads
source/evidence and mutates copied arrays, not files or database state.
No application, database, workflow, browser, installation, migration, network
or Git mutation was used. No new authoritative validator was created.

### Newly executed checks and reproduction

The matrix checker was executed from the repository root:

```sh
awk '/^```js$/{f=1;next} f && /^```$/{exit} f' docs/ddl-resolution-pilot/dependency-matrix.md | node --input-type=module
```

Result, exit 0:

```text
PASS source derivation and negative tests: 11 mappings; 20 evidence IDs
DOCUMENTED REPORT DIFFERENCES: none (missing=0 unknown=0 duplicate=0 missingEdges=0 missingPrerequisites=0)
```

The 20-ID count is the matrix's evidence universe, not a replacement for the
110 authoritative operations. Negative checks include missing learner,
cross-owner and prerequisite edges, unknown/duplicate IDs, known IDs and edges
attached to the wrong mapping, fast/full substitution and duplicate rows.
These are synthetic omissions, not edits to authoritative evidence.

The following static final check uses the **explicit core table**, not every
fingerprint mentioned anywhere in prose:

```sh
pnpm --filter @workspace/scripts exec tsx -e '
import {readFileSync} from "node:fs";
import {loadRepositoryCrosswalk} from "./src/startup-migration-crosswalk.ts";
const {crosswalk:c}=loadRepositoryCrosswalk();
const root="../docs/ddl-resolution-pilot/";
const ids=[...readFileSync(root+"README.md","utf8").matchAll(/^\| `([a-f0-9]{64})` \|/gm)].map(m=>m[1]);
if(ids.length!==11||new Set(ids).size!==11)throw Error("Core selection drift");
const norm=(s:string)=>s.replace(/\s+/g," ").trim();
let rows=0;
for(const name of ["business-growth.md","other-owners.md","booking-push-bundle.md"]){
 const text=readFileSync(root+name,"utf8");
 const selected=c.mappings.filter(m=>ids.includes(m.fingerprint)&&text.includes(m.fingerprint));
 rows+=selected.length;
 for(const m of selected)for(const o of m.occurrences){
  if(!text.includes(o.sourcePath)||!text.includes(o.sourceSqlChecksum))throw Error("Missing source identity "+m.fingerprint);
  if(!norm(text).includes(norm(o.sourceSql))&&!text.includes(JSON.stringify(o.sourceSql)))throw Error("Missing SQL "+m.fingerprint);
 }
 for(const [p,n] of [["CB",7],["FM",7],["RH",6]] as const)for(let i=1;i<=n;i++){
  if([...text.matchAll(new RegExp("^\\| (?:\\*\\*)?"+p+i+"(?:\\*\\*)?(?: \\|| —)","gm"))].length!==selected.length)throw Error("Gate count "+name+p+i);
 }
}
if(rows!==11)throw Error("Duplicate/missing selected report");
const alias=c.mappings.find(m=>m.fingerprint==="07e226d17976f0897da49e2a34fa14dd6a0534297bbb2b3d09187eecdaebbcc9")!;
const bg=readFileSync(root+"business-growth.md","utf8");
if(!bg.includes(alias.fingerprint)||!bg.includes(alias.operationKind))throw Error("Missing supplementary identity");
for(const o of alias.occurrences)if(!bg.includes(o.sourcePath)||!bg.includes(o.sourceSqlChecksum)||!norm(bg).includes(norm(o.sourceSql)))throw Error("Missing supplementary evidence");
if(c.mappings.length!==1435||c.additionalOperations.length!==110||c.mappings.some(m=>m.status!=="UNRESOLVED")||c.additionalOperations.some(m=>m.status!=="UNRESOLVED"))throw Error("Status/count drift");
console.log("PASS: 11 core mappings + supplementary alias; exact SQL/locators/checksums; 220 gate rows; 1435/110 UNRESOLVED");
'
node <<'NODE'
const fs=require('fs'),crypto=require('crypto');
const text=fs.readFileSync('docs/ddl-resolution-pilot/verification.md','utf8');
let n=0;
for(const m of text.matchAll(/^([a-f0-9]{64})  (.+)$/gm)){
 if(crypto.createHash('sha256').update(fs.readFileSync(m[2])).digest('hex')!==m[1])throw Error('Changed '+m[2]);
 n++;
}
console.log('PASS: preserved initial SHA-256 pins',n);
NODE
git diff --check
node <<'NODE'
const fs=require('fs'),{spawnSync}=require('child_process');
for(const name of fs.readdirSync('docs/ddl-resolution-pilot').filter(n=>n.endsWith('.md'))){
 const path='docs/ddl-resolution-pilot/'+name;
 const r=spawnSync('git',['diff','--no-index','--check','/dev/null',path],{encoding:'utf8'});
 if(r.error||![0,1].includes(r.status)||r.stdout||r.stderr)throw Error('Whitespace check '+path+': '+r.stdout+r.stderr);
}
console.log('PASS: whitespace checks include all six documents');
NODE
git diff --name-status f1ca85a8f7795c92453ee6bc52ba32d11a26515d
git ls-files --others --exclude-standard
git rev-parse HEAD
git status --short --branch --untracked-files=all
```

Final results: source/document check and 25-pin comparison passed; whitespace
checks produced no diagnostics, including the untracked matrix. Read-only
Git checks found no changed tracked or untracked path outside the permitted
directory. No canonical, evidence, validator, source, memory, configuration or
metadata file was changed by this correction.

The first combined shell wrapper stopped at the no-index comparison's exit 1,
after the source and pin checks had passed. It emitted no whitespace
diagnostic: a no-index comparison against `/dev/null` may report file
differences with exit 1. The corrected wrapper above explicitly permits 0/1
only when stdout/stderr are empty, rather than swallowing whitespace errors.
Only the remaining whitespace/Git checks were then executed; the already
passing source and pin checks were not rerun.

### Final pre-completion worktree capture

HEAD remains `f1ca85a8f7795c92453ee6bc52ba32d11a26515d`. Five tracked documents
are modified and one matrix document is new: **six follow-up paths**.
The tracked diff alone therefore lists five, not the whole delivery.

```text
## fix-production-demo-seed-boundary...github/fix-production-demo-seed-boundary [ahead 28]
 M docs/ddl-resolution-pilot/README.md
 M docs/ddl-resolution-pilot/booking-push-bundle.md
 M docs/ddl-resolution-pilot/business-growth.md
 M docs/ddl-resolution-pilot/other-owners.md
 M docs/ddl-resolution-pilot/verification.md
?? docs/ddl-resolution-pilot/dependency-matrix.md
```

This is the observed snapshot **before** task completion/platform checkpoint
bookkeeping; it does not predict any later commit or metadata change.

**STOP. Await independent Claude Code review. No next task is authorized or
started by this report.**