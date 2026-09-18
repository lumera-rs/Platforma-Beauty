# DB-free verification and preservation record

## Scope and execution boundary

This is a reproducible, **non-authoritative** consistency check for the eight
new readiness documents. It does not resolve a mapping or additional operation:
all 1,435 mappings and 110 additional operations remain `UNRESOLVED`.

Before importing the static crosswalk, the checker reads
`scripts/src/startup-migration-crosswalk.ts` as text and accepts only its five
Node/TypeScript runtime imports (`node:crypto`, `node:fs`, `node:path`,
`node:url`, `typescript`) plus the erased type-only inventory import. It then
uses the already installed `scripts/node_modules/.bin/tsx`, with
`TSX_DISABLE_CACHE=1`, only to load the static source parser. It never imports
an owner module or application runtime. The delivered dependency and production
JavaScript projections are separately source-audited and evaluated in a Node
VM with a `require` limited to the inventory JSON; their results are compared
with independently rebuilt assignments/selectors. All other operations use
Node filesystem reads, SHA-256, JSON parsing, in-memory copies, and read-only
Git.

No database, network, workflow, test suite, installation, migration, browser,
or application startup is used. The checker is embedded below and writes no
checker file or other workspace output.

## Reproduction command

Run from the repository root after all eight documents exist. The `maxBuffer`
is deliberate: the source crosswalk JSON includes the complete SQL literals.

```sh
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const docs = "docs/ddl-resolution-readiness";
const correctionBase = "64a0d5fed01861079e2716e1766ffd13509293d7";
const automaticAttachedAsset =
  "attached_assets/Pasted--PHASE-5B-4-TASK-3-READ-ONLY-RESOLUTION-READINESS-AUDIT_1789585790248.txt";
const expectedDocuments = [
  "README.md", "inventory.json", "inventory.md", "evidence-gaps.json",
  "evidence-gaps.md", "dependency-batches.md", "production-evidence.md",
  "verification.md",
];
const fail = (condition, message) => {
  if (!condition) throw new Error(message);
};
const duplicates = (values) => [...values.reduce((counts, value) => {
  counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}, new Map())].filter(([, count]) => count > 1).map(([value]) => value);
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, docs, name), "utf8"));
const sha256 = (name) => crypto.createHash("sha256").update(fs.readFileSync(name)).digest("hex");
const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { encoding: "utf8", ...options });
  fail(!result.error, `${file}: ${result.error}`);
  return result;
};
const evaluateFencedReadOnlyProjection = (documentName, resultExpression) => {
  const text = fs.readFileSync(path.join(root, docs, documentName), "utf8");
  const projection = text.match(/```js\n([\s\S]*?)\n```/u)?.[1];
  fail(projection, `${documentName}: JavaScript projection missing`);
  const requires = [...projection.matchAll(/require\(([^)]+)\)/gu)].map((match) => match[1]);
  fail(
    requires.length === 1
      && requires[0] === '"./docs/ddl-resolution-readiness/inventory.json"'
      && !/\b(?:import|spawn|exec|writeFile|appendFile|fetch|https?)\b/iu.test(projection),
    `${documentName}: projection is not a read-only inventory evaluator`,
  );
  const context = {
    require: createRequire(path.join(root, "read-only-document-projection.cjs")),
  };
  context.globalThis = context;
  vm.runInNewContext(`${projection}\nglobalThis.result = ${resultExpression};`, context, {
    filename: path.join(docs, documentName),
  });
  return context.result;
};

// Import/call boundary audit happens before TSX can evaluate the crosswalk.
const crosswalkSource = fs.readFileSync("scripts/src/startup-migration-crosswalk.ts", "utf8");
const imports = [...crosswalkSource.matchAll(
  /^import\s+(type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["'];?$/gm,
)].map((match) => ({ typeOnly: Boolean(match[1]), specifier: match[2] }));
const allowedRuntime = new Set([
  "node:crypto", "node:fs", "node:path", "node:url", "typescript",
]);
fail(
  imports.length === 6
    && imports.every(({ typeOnly, specifier }) =>
      allowedRuntime.has(specifier)
      || (typeOnly && specifier === "./production-startup-ddl-inventory")),
  `unsafe crosswalk import boundary: ${JSON.stringify(imports)}`,
);
fail(fs.existsSync("scripts/node_modules/.bin/tsx"), "local TSX launcher is absent");
console.log("PASS import boundary: Node/TypeScript only; inventory import type-only; no owner/application/database runtime import");

const crosswalkProgram = [
  'import { loadRepositoryCrosswalk } from "./src/startup-migration-crosswalk.ts";',
  "console.log(JSON.stringify(loadRepositoryCrosswalk().crosswalk));",
].join("");
const crosswalkRun = run("./node_modules/.bin/tsx", ["--eval", crosswalkProgram], {
  cwd: "scripts",
  env: { ...process.env, TSX_DISABLE_CACHE: "1" },
  maxBuffer: 20 * 1024 * 1024,
});
fail(crosswalkRun.status === 0, `crosswalk failed: ${crosswalkRun.stderr}`);
const crosswalk = JSON.parse(crosswalkRun.stdout);
const inventory = readJson("inventory.json");
const gaps = readJson("evidence-gaps.json");
const completeEvidence = JSON.parse(fs.readFileSync(
  "docs/additional-operations-evidence/complete-evidence.json", "utf8",
));

// Initial pin versus final on-disk hash, including canonical SQL and owner sources.
fail(
  inventory.initialSnapshot.head === "e03e2acf8f300dee738d3dd5cb8aafcc0da4d6ab"
    && inventory.initialSnapshot.capturedBeforeReadinessWrites === true
    && inventory.initialSnapshot.canonicalSha256
      === "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60",
  "initial snapshot pin drift",
);
for (const [file, initialHash] of Object.entries(inventory.inputPins)) {
  fail(sha256(file) === initialHash, `input changed since initial pin: ${file}`);
}
fail(
  sha256("lib/db/migrations/000001_canonical_schema/migration.sql")
    === "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60",
  "canonical SHA-256 drift",
);

const mappingIds = inventory.mappingIds;
const operationIds = inventory.additionalOperationIds;
const records = [...inventory.records.mappings, ...inventory.records.additionalOperations];
fail(
  inventory.counts.owners === 8 && inventory.owners.length === 8
    && mappingIds.length === 1435 && inventory.counts.mappingIds === 1435
    && inventory.occurrences.length === 1459 && inventory.counts.occurrences === 1459
    && operationIds.length === 110 && inventory.counts.additionalOperationIds === 110
    && records.length === 1545,
  "inventory count drift",
);
fail(
  duplicates(mappingIds).length === 0 && duplicates(operationIds).length === 0
    && !mappingIds.some((id) => operationIds.includes(id))
    && mappingIds.every((id) => /^[a-f0-9]{64}$/u.test(id))
    && duplicates(inventory.objectGroups.map((group) => group[0])).length === 0,
  "unknown, duplicate, or overlapping inventory identity",
);
fail(
  crosswalk.inventory.ownerCount === 8 && crosswalk.inventory.recordCount === 1459
    && crosswalk.mappings.length === 1435 && crosswalk.additionalOperations.length === 110
    && crosswalk.mappings.every((record) => record.status === "UNRESOLVED")
    && crosswalk.additionalOperations.every((record) => record.status === "UNRESOLVED"),
  "source crosswalk count/status drift",
);

const ownerNames = inventory.owners.map((owner) => owner[0]);
const riskIds = new Set(Object.keys(inventory.catalog.operationalRiskProfiles));
const validateGroups = (indexes, label) => fail(
  Array.isArray(indexes) && duplicates(indexes).length === 0
    && indexes.every((index) => Number.isInteger(index)
      && index >= 0 && index < inventory.objectGroups.length),
  `${label}: invalid object-group reference`,
);

// Mapping tuples, their exact source crosswalk records, and every source SQL checksum.
const occurrenceKeys = new Set();
for (let index = 0; index < mappingIds.length; index += 1) {
  const row = inventory.records.mappings[index];
  const sourceRecord = crosswalk.mappings[row[5]];
  fail(
    Array.isArray(row) && row.length === 7
      && sourceRecord?.fingerprint === mappingIds[index]
      && row[1] === sourceRecord.operationKind
      && row[3] === sourceRecord.existingDataEffect,
    `mapping tuple/source mismatch at ${index}`,
  );
  fail(
    Array.isArray(row[0]) && row[0].length > 0 && duplicates(row[0]).length === 0
      && row[0].every((ownerIndex) => ownerNames[ownerIndex]),
    `mapping owner index mismatch at ${index}`,
  );
  validateGroups(row[2], `mapping ${index}`);
  fail(
    Array.isArray(row[4]) && row[4].length === sourceRecord.occurrences.length
      && duplicates(row[4]).length === 0
      && row[4].every((occurrenceIndex) => Number.isInteger(occurrenceIndex)
        && occurrenceIndex >= 0 && occurrenceIndex < sourceRecord.occurrences.length)
      && row[6].every((riskId) => riskIds.has(riskId)),
    `mapping occurrence/risk mismatch at ${index}`,
  );
}

// Additional-operation tuple slot 4 is the explicit [crosswalk,evidence] join.
for (let index = 0; index < operationIds.length; index += 1) {
  const row = inventory.records.additionalOperations[index];
  const [crosswalkIndex, evidenceIndex] = row[4] ?? [];
  const sourceRecord = crosswalk.additionalOperations[crosswalkIndex];
  const evidenceRecord = completeEvidence[evidenceIndex];
  fail(
    Array.isArray(row) && row.length === 6 && Array.isArray(row[4]) && row[4].length === 2
      && sourceRecord?.id === operationIds[index] && evidenceRecord?.id === operationIds[index]
      && ownerNames[row[0]] === sourceRecord.owner
      && row[1] === sourceRecord.category && row[3] === sourceRecord.existingDataEffect
      && row[5].every((riskId) => riskIds.has(riskId)),
    `additional-operation crosswalk/evidence join mismatch at ${index}`,
  );
  validateGroups(row[2], `additional operation ${index}`);
}
fail(
  completeEvidence.length === 110 && duplicates(completeEvidence.map((record) => record.id)).length === 0
    && operationIds.every((id) => completeEvidence.some((record) => record.id === id)),
  "complete-evidence identity mismatch",
);

for (const [globalIndex, occurrence] of inventory.occurrences.entries()) {
  const [mappingIndex, occurrenceIndex, ownerIndex, position, executionOrder, phase, callSite, literalHash] = occurrence;
  const sourceOccurrence = crosswalk.mappings[mappingIndex]?.occurrences[occurrenceIndex];
  fail(
    Array.isArray(occurrence) && occurrence.length === 8 && sourceOccurrence
      && ownerNames[ownerIndex] === sourceOccurrence.owner
      && JSON.stringify(position) === JSON.stringify([
        sourceOccurrence.sourcePosition.literalLine, sourceOccurrence.sourcePosition.literalColumn,
        sourceOccurrence.sourcePosition.operationLine, sourceOccurrence.sourcePosition.operationColumn,
      ])
      && executionOrder === sourceOccurrence.executionOrder
      && (phase === null ? sourceOccurrence.phase === undefined
        : phase === (sourceOccurrence.phase === "post-listen" ? 1 : 0))
      && (callSite === null ? sourceOccurrence.callSite === undefined : callSite === sourceOccurrence.callSite)
      && sourceOccurrence.sourceSqlChecksum
        === crypto.createHash("sha256").update(sourceOccurrence.sourceSql).digest("hex")
      && literalHash === crypto.createHash("sha256").update(sourceOccurrence.sourceSql).digest("hex"),
    `source SQL/locator checksum mismatch at occurrence ${globalIndex}`,
  );
  const key = `${mappingIndex}:${occurrenceIndex}`;
  fail(!occurrenceKeys.has(key), `duplicate occurrence identity ${key}`);
  occurrenceKeys.add(key);
}
fail(occurrenceKeys.size === 1459, "lost occurrence");
for (let index = 0; index < mappingIds.length; index += 1) {
  const fromOccurrenceTable = [...occurrenceKeys]
    .filter((key) => key.startsWith(`${index}:`))
    .map((key) => Number(key.split(":")[1])).sort((a, b) => a - b);
  const fromMappingTuple = [...inventory.records.mappings[index][4]].sort((a, b) => a - b);
  fail(JSON.stringify(fromOccurrenceTable) === JSON.stringify(fromMappingTuple),
    `mapping/occurrence join mismatch at ${index}`);
}
for (const [index, group] of inventory.objectGroups.entries()) {
  fail(
    Array.isArray(group) && group.length === 3 && typeof group[0] === "string" && group[0]
      && typeof group[1] === "string" && (group[2] === null || typeof group[2] === "object"),
    `object group encoding mismatch at ${index}`,
  );
}

// Gap records must be complete mechanical joins while retaining fail-closed source status.
const validTags = new Set([
  "SOURCE EVIDENCE COMPLETE", "SOURCE EVIDENCE INCOMPLETE",
  "PRODUCTION EVIDENCE REQUIRED", "BUSINESS DECISION REQUIRED", "BLOCKED BY DEPENDENCY",
]);
const validGapCodes = new Set(Object.keys(gaps.gapCatalog));
fail(
  gaps.counts.records === 1545 && gaps.counts.mappingIds === 1435
    && gaps.counts.additionalOperationIds === 110 && gaps.counts.occurrences === 1459
    && gaps.counts.sourceEvidenceComplete === 0 && gaps.counts.sourceEvidenceIncomplete === 1545
    && gaps.counts.authoritativeUnresolved === 1545
    && gaps.sourceChecklistProfile.status === "SOURCE EVIDENCE INCOMPLETE",
  "gap count/checklist drift",
);
for (const [family, gapRows, sourceRows] of [
  ["mapping", gaps.records.mappings, inventory.records.mappings],
  ["additional-operation", gaps.records.additionalOperations, inventory.records.additionalOperations],
]) {
  fail(gapRows.length === sourceRows.length, `${family} gap cardinality mismatch`);
  for (let index = 0; index < gapRows.length; index += 1) {
    const [codes, tags, groupIndexes] = gapRows[index];
    fail(
      Array.isArray(codes) && codes.length > 0 && duplicates(codes).length === 0
        && codes.every((code) => validGapCodes.has(code))
        && Array.isArray(tags) && duplicates(tags).length === 0
        && tags.includes("SOURCE EVIDENCE INCOMPLETE")
        && !tags.includes("SOURCE EVIDENCE COMPLETE")
        && tags.every((tag) => validTags.has(tag))
        && JSON.stringify(groupIndexes) === JSON.stringify(sourceRows[index][2]),
      `${family} gap/source-checklist join mismatch at ${index}`,
    );
  }
}

// Rebuild the dependency primary-assignment graph from actual group references.
const stableIds = [
  ...mappingIds.map((id) => `mapping:${id}`),
  ...operationIds.map((id) => `additional-operation:${id}`),
];
const parent = stableIds.map((_, index) => index);
const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
const join = (left, right) => {
  left = find(left); right = find(right);
  if (left !== right) parent[right] = left;
};
const firstRecordAtGroup = new Map();
records.forEach((record, recordIndex) => record[2].forEach((groupIndex) => {
  if (firstRecordAtGroup.has(groupIndex)) join(recordIndex, firstRecordAtGroup.get(groupIndex));
  else firstRecordAtGroup.set(groupIndex, recordIndex);
}));
const components = new Map();
stableIds.forEach((recordId, index) => {
  const component = find(index);
  if (!components.has(component)) components.set(component, []);
  components.get(component).push(recordId);
});
const lifecycleAssignments = new Map([
  ["additional-operation:booking-command/transaction-and-advisory-lock", "B-08-booking-idempotency-scope/source-lifecycle"],
  ["additional-operation:education-bundle/transaction-and-advisory-lock", "B-02-bundle-payment-and-target-state/source-lifecycle"],
  ["additional-operation:marketplace/advisory-lock-and-session-state", "B-05-marketplace-concurrent-index-recovery/source-lifecycle"],
  ["additional-operation:referral/transaction-and-advisory-lock", "B-06-referral-tracking-invariant/source-lifecycle"],
  ["additional-operation:web-push/transaction-and-advisory-lock", "B-07-web-push-expiry-transition/source-lifecycle"],
]);
const assignment = {};
for (const component of components.values()) {
  component.sort();
  const batch = lifecycleAssignments.get(component[0]) ?? `B-09-object-component/${component[0]}`;
  for (const recordId of component) assignment[recordId] = batch;
}
const dependencyDocument = fs.readFileSync(path.join(root, docs, "dependency-batches.md"), "utf8");
const deliveredBatches = evaluateFencedReadOnlyProjection(
  "dependency-batches.md", "{ assignment, overlays, records }",
);
const requiredOverlayIds = {
  "B-01-bg-branch-lifecycle": [
    "additional-operation:business-growth/advisory-lock-and-session-state",
    "additional-operation:business-growth/rollout-marker-read",
    "additional-operation:business-growth/rollout-marker-write",
  ],
  "B-02-bundle-payment-and-target-state": [
    "mapping:71356fcc77dddd2144fb41cb69726fe91c2d02ea2dfef815982bdbb67ace0f6a",
    "mapping:be6bde8a84510897975617bca5afd3855e1c6c10220d634e9dc6b04b930436f3",
    "additional-operation:education-bundle/learner-id-backfill",
  ],
  "B-03-media-asset-relations": ["additional-operation:media/transaction-and-advisory-lock"],
  "B-04-shipping-singleton-transition": ["additional-operation:shipping/duplicate-row-cleanup"],
  "B-05-marketplace-concurrent-index-recovery": ["additional-operation:marketplace/advisory-lock-and-session-state"],
  "B-06-referral-tracking-invariant": ["additional-operation:referral/tracking-start-backfill"],
  "B-07-web-push-expiry-transition": ["additional-operation:web-push/transaction-and-advisory-lock"],
  "B-08-booking-idempotency-scope": ["additional-operation:booking-command/transaction-and-advisory-lock"],
};
fail(
  Object.keys(assignment).length === 1545 && new Set(Object.values(assignment)).size === 960
    && [...lifecycleAssignments].every(([id, batch]) => assignment[id] === batch)
    && records.every((record) => record[2].length > 0)
    && records.reduce((total, record) => total + record[2].length, 0) === 1656
    && inventory.objectGroups.length === 1044 && firstRecordAtGroup.size === 1044
    && JSON.stringify(deliveredBatches.assignment) === JSON.stringify(assignment)
    && deliveredBatches.records.length === 1545
    && Object.entries(requiredOverlayIds).every(([batch, ids]) =>
      Array.isArray(deliveredBatches.overlays[batch])
      && duplicates(deliveredBatches.overlays[batch].map((record) => record.recordId)).length === 0
      && deliveredBatches.overlays[batch].every((record) => stableIds.includes(record.recordId))
      && ids.every((id) => deliveredBatches.overlays[batch].some((record) => record.recordId === id)))
    && [...dependencyDocument.matchAll(/`DEP-\d{3}`/gu)].length === 15
    && dependencyDocument.includes("B-09-object-component-partition"),
  "dependency graph/batch integrity mismatch",
);

// Rebuild the production selectors; every selected stable ID must exist exactly once.
const mappings = inventory.records.mappings.map((row, index) => ({
  id: mappingIds[index], recordId: `mapping:${mappingIds[index]}`, kind: row[1],
  groups: row[2], ownerIndexes: row[0],
}));
const additional = inventory.records.additionalOperations.map((row, index) => ({
  id: operationIds[index], recordId: `additional-operation:${operationIds[index]}`,
  category: row[1], groups: row[2], ownerIndex: row[0],
}));
const allRecords = [...mappings, ...additional];
const exact = (id) => allRecords.filter((record) => record.id === id);
const kind = (value) => mappings.filter((record) => record.kind === value);
const category = (value) => additional.filter((record) => record.category === value);
const owner = (name) => allRecords.filter((record) =>
  (record.ownerIndexes ?? [record.ownerIndex]).some((index) => ownerNames[index] === name));
const union = (...sets) => [...new Map(sets.flat().map((record) => [record.recordId, record])).values()];
const namedObject = (...names) => allRecords.filter((record) => record.groups.some((index) => {
  const [groupId, , identity] = inventory.objectGroups[index];
  return names.some((name) => groupId.includes(name) || [identity?.name, identity?.parent].includes(name));
}));
const selectors = {
  "PE-01-target-and-release": stableIds,
  "PE-02-ledger-marker-reachability": union(category("rollout-marker"), exact("business-growth/advisory-lock-and-session-state"),
    exact("business-growth/cleanup-report-read"), exact("business-growth/rollout-marker-read"),
    exact("business-growth/rollout-marker-write"),
    namedObject("business_growth_schema_rollout", "education_salon_cleanup_reports")).map((x) => x.recordId),
  "PE-03-catalog-definition-and-binding": union(mappings, category("function-replacement"),
    namedObject("education_bundle_purchases", "reject_bundle_payment_reference_change")).map((x) => x.recordId),
  "PE-04-index-and-constraint-validity": union(kind("create-index"), kind("validate-constraint"),
    exact("shipping/duplicate-row-cleanup"),
    exact("ensureWebPushSchema/source-discovered-82-dd7107a5f655438a")).map((x) => x.recordId),
  "PE-05-data-invariants-and-backfills": union(category("data-backfill"), category("cleanup-reporting"),
    exact("business-growth/bundle-payment-backfill"), exact("education-bundle/payment-reference-backfill"),
    exact("education-bundle/learner-id-backfill"), exact("shipping/duplicate-row-cleanup"),
    exact("ensureWebPushSchema/source-discovered-82-dd7107a5f655438a"),
    exact("referral/tracking-start-backfill")).map((x) => x.recordId),
  "PE-06-business-authorization-and-compensation": union(category("data-backfill"), category("cleanup-reporting"), kind("drop-index"),
    category("function-replacement"), exact("education-bundle/payment-reference-backfill"),
    exact("education-bundle/learner-id-backfill")).map((x) => x.recordId),
  "PE-07-transaction-lock-session-recovery": union(category("operational-scaffolding"),
    exact("business-growth/advisory-lock-and-session-state"),
    owner("ensureMarketplacePerformanceIndexes")).map((x) => x.recordId),
  "PE-08-privileges-and-dependent-release-compatibility": union(category("function-replacement"), kind("create-trigger"),
    kind("drop-index"), kind("create-extension")).map((x) => x.recordId),
  "PE-09-restore-and-observability": union(category("data-backfill"), category("cleanup-reporting"), kind("drop-index"),
    category("function-replacement"), category("rollout-marker"),
    owner("ensureMarketplacePerformanceIndexes")).map((x) => x.recordId),
  "PE-10-independent-review-disposition": stableIds,
};
const productionDocument = fs.readFileSync(path.join(root, docs, "production-evidence.md"), "utf8");
const deliveredSelectorIds = evaluateFencedReadOnlyProjection(
  "production-evidence.md", "selectorIds",
);
for (const [selector, ids] of Object.entries(selectors)) {
  fail(ids.length > 0 && duplicates(ids).length === 0
    && ids.every((id) => stableIds.includes(id))
    && productionDocument.includes(selector)
    && JSON.stringify([...ids].sort()) === JSON.stringify(deliveredSelectorIds[selector]),
  `production selector integrity failure: ${selector}`);
}
fail(
  selectors["PE-01-target-and-release"].length === 1545
    && selectors["PE-10-independent-review-disposition"].length === 1545
    && productionDocument.includes("**All production facts in this register are `UNKNOWN`.**"),
  "production scope/state drift",
);

// Negative cases mutate only detached in-memory copies and must be detectable.
const clone = (value) => JSON.parse(JSON.stringify(value));
const validIdentityUniverse = (candidateMappings, candidateOperations) =>
  candidateMappings.length === 1435 && candidateOperations.length === 110
  && duplicates(candidateMappings).length === 0 && duplicates(candidateOperations).length === 0
  && !candidateMappings.some((id) => candidateOperations.includes(id))
  && candidateMappings.every((id) => crosswalk.mappings.some((record) => record.fingerprint === id))
  && candidateOperations.every((id) => completeEvidence.some((record) => record.id === id));
const validOccurrenceTable = (candidateOccurrences) =>
  candidateOccurrences.length === 1459 && candidateOccurrences.every((occurrence) => {
    const [mappingIndex, occurrenceIndex, , , , , , literalHash] = occurrence;
    const sourceOccurrence = crosswalk.mappings[mappingIndex]?.occurrences[occurrenceIndex];
    return sourceOccurrence
      && literalHash === crypto.createHash("sha256").update(sourceOccurrence.sourceSql).digest("hex");
  });
const validSourceTags = (tags) => tags.includes("SOURCE EVIDENCE INCOMPLETE")
  && !tags.includes("SOURCE EVIDENCE COMPLETE") && duplicates(tags).length === 0
  && tags.every((tag) => validTags.has(tag));
const validGapCodeList = (codes) => codes.length > 0 && duplicates(codes).length === 0
  && codes.every((code) => validGapCodes.has(code));
const validAssignment = (candidate) => Object.keys(candidate).length === 1545
  && stableIds.every((id) => typeof candidate[id] === "string");
const validProductionSelector = (ids) => ids.length > 0 && duplicates(ids).length === 0
  && ids.every((id) => stableIds.includes(id));
const negative = [
  ["duplicate mapping", () => {
    const copy = clone(mappingIds); copy.push(copy[0]);
    return !validIdentityUniverse(copy, operationIds);
  }],
  ["unknown additional ID", () => {
    const copy = clone(operationIds); copy[0] = "not-a-real-operation";
    return !validIdentityUniverse(mappingIds, copy);
  }],
  ["lost occurrence", () => !validOccurrenceTable(clone(inventory.occurrences).slice(1))],
  ["bad source checksum", () => {
    const copy = clone(inventory.occurrences); copy[0][7] = "00".repeat(32);
    return !validOccurrenceTable(copy);
  }],
  ["source-label conflict", () => {
    const tags = [...gaps.records.mappings[0][1], "SOURCE EVIDENCE COMPLETE"];
    return !validSourceTags(tags);
  }],
  ["unknown gap code", () => !validGapCodeList([...gaps.records.mappings[0][0], "invented-gap-code"])],
  ["lost batch assignment", () => {
    const copy = { ...assignment };
    delete copy[stableIds[0]];
    return !validAssignment(copy);
  }],
  ["unknown production reference", () => !validProductionSelector([
    ...selectors["PE-04-index-and-constraint-validity"], "mapping:not-a-real-fingerprint",
  ])],
];
fail(negative.every(([, detected]) => detected()), "an in-memory negative case escaped detection");

const gitStatus = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
const correctionDiff = run("git", ["diff", "--name-status", correctionBase]);
const changedPaths = [...correctionDiff.stdout.split("\n"), ...gitStatus.stdout.split("\n")]
  .map((line) => line.trim().split(/\s+/u).at(-1)).filter(Boolean);
const uniqueChangedPaths = [...new Set(changedPaths)];
const expectedCorrectionPaths = new Set([
  `${docs}/README.md`, `${docs}/verification.md`,
]);
fail(
  uniqueChangedPaths.length === expectedCorrectionPaths.size
    && uniqueChangedPaths.every((file) => expectedCorrectionPaths.has(file)),
  `correction write-scope breach: ${uniqueChangedPaths.join(", ")}`,
);
const attachedAssetAtInitialCommit = run("git", [
  "ls-tree", "-r", "--name-only", "e03e2acf8f300dee738d3dd5cb8aafcc0da4d6ab",
  "--", automaticAttachedAsset,
]);
fail(
  attachedAssetAtInitialCommit.status === 0
    && attachedAssetAtInitialCommit.stdout.trim() === automaticAttachedAsset
    && !expectedDocuments.includes(path.basename(automaticAttachedAsset)),
  "automatic attached-assets provenance drift",
);
const actualDocuments = fs.readdirSync(docs).filter((name) =>
  fs.statSync(path.join(docs, name)).isFile()).sort();
fail(JSON.stringify(actualDocuments) === JSON.stringify([...expectedDocuments].sort()),
  `final document list mismatch: ${actualDocuments.join(", ")}`);
for (const name of actualDocuments) {
  const whitespace = run("git", ["diff", "--no-index", "--check", "/dev/null", path.join(docs, name)]);
  fail(!whitespace.stdout && !whitespace.stderr, `whitespace diagnostic in ${name}`);
}
const pilotMatrix = run("git", ["diff", "--exit-code",
  "334711049ebe23e62745f290f40abd280c9f8cbe", "--",
  "docs/ddl-resolution-pilot/dependency-matrix.md"]);
fail(pilotMatrix.status === 0, "corrected pilot dependency-matrix differs from planning pin");

console.log(`PASS parity: 8 owners; ${mappingIds.length} mapping IDs; ${inventory.occurrences.length} occurrences; ${operationIds.length} additional-operation IDs; ${stableIds.length} records`);
console.log(`PASS source: ${Object.keys(inventory.inputPins).length} initial/final SHA-256 pins; canonical SHA-256 preserved; ${occurrenceKeys.size} full-SQL checksums and locators`);
console.log(`PASS gaps: COMPLETE=0; INCOMPLETE=${gaps.counts.sourceEvidenceIncomplete}; authoritative UNRESOLVED=${gaps.counts.authoritativeUnresolved}; unknown/duplicate identities=0`);
console.log(`PASS graph/batches: ${inventory.objectGroups.length} groups; 1656 memberships; 960 primary assignments; 15 documented source edges`);
console.log(`PASS production selectors: ${Object.entries(selectors).map(([key, ids]) => `${key}=${ids.length}`).join(", ")}; all references valid`);
console.log(`PASS negatives: ${negative.length} in-memory failures detected; Git HEAD=${run("git", ["rev-parse", "HEAD"]).stdout.trim()}; changed paths=${uniqueChangedPaths.length}; files=${actualDocuments.length}`);
NODE
```

## Executed result

The fenced code was executed from the repository root as in-memory input (the
fence was selected with `awk` and piped to `node --input-type=module`; no
checker file was created). Exit status: **0**. Actual output:

```text
PASS import boundary: Node/TypeScript only; inventory import type-only; no owner/application/database runtime import
PASS parity: 8 owners; 1435 mapping IDs; 1459 occurrences; 110 additional-operation IDs; 1545 records
PASS source: 32 initial/final SHA-256 pins; canonical SHA-256 preserved; 1459 full-SQL checksums and locators
PASS gaps: COMPLETE=0; INCOMPLETE=1545; authoritative UNRESOLVED=1545; unknown/duplicate identities=0
PASS graph/batches: 1044 groups; 1656 memberships; 960 primary assignments; 15 documented source edges
PASS production selectors: PE-01-target-and-release=1545, PE-02-ledger-marker-reachability=7, PE-03-catalog-definition-and-binding=1472, PE-04-index-and-constraint-validity=585, PE-05-data-invariants-and-backfills=68, PE-06-business-authorization-and-compensation=111, PE-07-transaction-lock-session-recovery=11, PE-08-privileges-and-dependent-release-compatibility=74, PE-09-restore-and-observability=118, PE-10-independent-review-disposition=1545; all references valid
PASS negatives: 8 in-memory failures detected; Git HEAD=64a0d5fed01861079e2716e1766ffd13509293d7; changed paths=2; files=8
```

`inventory.json.initialSnapshot` records the initial, pre-readiness-write
HEAD as `e03e2acf8f300dee738d3dd5cb8aafcc0da4d6ab` and its 32 initial
SHA-256 input pins. The executed checker recomputed every one at the end:
**32/32 matched**. This includes the canonical migration's required,
unchanged SHA-256:

```text
643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60
```

The Replit-generated input artifact
`attached_assets/Pasted--PHASE-5B-4-TASK-3-READ-ONLY-RESOLUTION-READINESS-AUDIT_1789585790248.txt`
is explicitly present in commit
`e03e2acf8f300dee738d3dd5cb8aafcc0da4d6ab`. It therefore predates the
readiness delivery commit
`64a0d5fed01861079e2716e1766ffd13509293d7` and is not one of the eight new
documents under `docs/ddl-resolution-readiness/`. The repository-wide Git
status check below still observes it and every other path; the provenance
assertion does not exempt `attached_assets/` from write-scope checking.

Final read-only Git capture used:

```sh
git rev-parse HEAD
git diff --name-status 64a0d5fed01861079e2716e1766ffd13509293d7
git status --short --untracked-files=all
```

Actual output:

```text
64a0d5fed01861079e2716e1766ffd13509293d7

M	docs/ddl-resolution-readiness/README.md
M	docs/ddl-resolution-readiness/verification.md

 M docs/ddl-resolution-readiness/README.md
 M docs/ddl-resolution-readiness/verification.md
```

This Git-state output is a historical snapshot captured before the correction
commit was created. Its `64a0d5fed01861079e2716e1766ffd13509293d7` HEAD and
modified-worktree status therefore differ from the post-commit state at
`17d43ed110b076767413ba6e9ecedcb230e62032`.

The first two path lines are the complete correction diff against the readiness
delivery commit; the final two are the complete, repository-wide porcelain
status. The final file list in the readiness directory remains exactly the
eight expected documents, while only `README.md` and `verification.md` are
changed. No tracked or untracked path elsewhere in the repository was reported.
The checker also ran
`git diff --no-index --check /dev/null` for each of those eight paths with no
whitespace diagnostics, and confirmed the corrected pilot dependency matrix is
identical to `334711049ebe23e62745f290f40abd280c9f8cbe`.

## Limits

The automated check proves only documentation/source consistency: cardinality,
joins, checksums, status inheritance, bounded graph/selector references,
negative-case detection, and write scope. It cannot prove SQL semantic
equivalence, completeness of manually interpreted dependencies, historical
execution, data invariants, authorization, lock behavior, recovery, or any
production fact. Those facts remain `UNKNOWN` and require the independent
semantic and separately authorized production review described by this package.

**STOP — deliver for independent review; do not start a batch or change an
authoritative status.**