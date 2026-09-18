# Task #943 — DB-free verification report

## Boundary

This checker validates the production-evidence plan as static repository data.
It opens no database connection, executes no SQL, starts no application or
workflow, performs no network request, and writes no checker or temporary file.
It imports only Node built-ins plus the already audited static crosswalk loader
through the repository-local TSX executable. It does not import any startup
owner or application runtime module.

All 1,435 mappings and 110 additional operations must remain `UNRESOLVED`.
Production observations are absent and all production facts remain `UNKNOWN`.

## Reproduction command

Run from the repository root. The checker is supplied to Node on standard input.

```sh
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const docs = "docs/production-evidence-plan";
const readiness = "docs/ddl-resolution-readiness";
const initialHead = "a635594692bf85879c647a179e9672b9fe36c9e2";
const deliveryHead = "7de77df58161ad8a0b960d8a83d34f744d1e0745";
const originalSpecification =
  "attached_assets/Pasted-TASK-942-PRODUCTION-EVIDENCE-COLLECTION-PLAN-PHASE-5B-4_1789588997282.txt";
const correctionSpecification =
  "attached_assets/Pasted-TASK-943-CORRECT-F1-F2-AND-F3-ONLY-Implement-the-three-_1789591368938.txt";
const correctionSpecificationHash =
  "ba40be5f58eb77ba9bc92071b36e2cfca10ca5a923b942f73bb2674488f64c22";
const expectedFiles = [
  "README.md",
  "evidence-matrix.json",
  "evidence-matrix.md",
  "collection-procedures.json",
  "collection-procedures.md",
  "collection-sequence.md",
  "production-access-safety.md",
  "verification.md",
];
const fail = (condition, message) => {
  if (!condition) throw new Error(message);
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = (file) => crypto.createHash("sha256")
  .update(fs.readFileSync(file)).digest("hex");
const hashText = (text) => crypto.createHash("sha256")
  .update(text).digest("hex");
const duplicates = (values) => [...values.reduce((counts, value) => {
  counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}, new Map())].filter(([, count]) => count > 1).map(([value]) => value);
const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { encoding: "utf8", ...options });
  fail(!result.error, `${file}: ${result.error}`);
  return result;
};

// The original specification is an automatic Replit artifact already present
// in the pre-delivery commit. It predates, and is not one of, the eight plan
// documents delivered by Task #943.
const originalTreeEntry = run("git", [
  "ls-tree", initialHead, "--", originalSpecification,
]);
fail(
  originalTreeEntry.status === 0
    && originalTreeEntry.stdout.trim()
      === `100644 blob 53eb438c02034d419d6aa131ab9ee61aa7559f1a\t${
        originalSpecification}`,
  "original specification provenance mismatch",
);
const deliveryAncestry = run("git", [
  "merge-base", "--is-ancestor", initialHead, deliveryHead,
]);
fail(deliveryAncestry.status === 0,
  "original specification commit does not predate delivery");
const deliveryPaths = run("git", [
  "diff", "--name-only", initialHead, deliveryHead,
]).stdout.split("\n").filter(Boolean).sort();
fail(
  deliveryPaths.length === 8
    && JSON.stringify(deliveryPaths)
      === JSON.stringify(expectedFiles.map((file) => `${docs}/${file}`).sort())
    && !originalSpecification.startsWith(`${docs}/`)
    && !expectedFiles.includes(path.basename(originalSpecification)),
  `delivery provenance mismatch: ${deliveryPaths.join(", ")}`,
);
console.log("PASS provenance: automatic source artifact belongs to a6355946, predates 7de77df5, and is outside the eight delivered documents");

// Audit the only non-JSON import boundary before evaluating the static loader.
const crosswalkPath = "scripts/src/startup-migration-crosswalk.ts";
const crosswalkSource = fs.readFileSync(crosswalkPath, "utf8");
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
fail(fs.existsSync("scripts/node_modules/.bin/tsx"), "repository TSX missing");
const crosswalkProgram = [
  'import { loadRepositoryCrosswalk } from "./src/startup-migration-crosswalk.ts";',
  "console.log(JSON.stringify(loadRepositoryCrosswalk().crosswalk));",
].join("");
const loaded = run("./node_modules/.bin/tsx", ["--eval", crosswalkProgram], {
  cwd: "scripts",
  env: { ...process.env, TSX_DISABLE_CACHE: "1" },
  maxBuffer: 20 * 1024 * 1024,
});
fail(loaded.status === 0, `crosswalk load failed: ${loaded.stderr}`);
const crosswalk = JSON.parse(loaded.stdout);
console.log("PASS import boundary: audited static Node/TypeScript loader only");

const inventory = readJson(path.join(readiness, "inventory.json"));
const gaps = readJson(path.join(readiness, "evidence-gaps.json"));
const additionalEvidence = readJson(
  "docs/additional-operations-evidence/complete-evidence.json",
);
const matrix = readJson(path.join(docs, "evidence-matrix.json"));
const procedureDocument = readJson(path.join(docs, "collection-procedures.json"));
const deliveredProcedureResult = run("git", [
  "show", `${deliveryHead}:${docs}/collection-procedures.json`,
], { maxBuffer: 20 * 1024 * 1024 });
fail(deliveredProcedureResult.status === 0,
  `delivered procedure load failed: ${deliveredProcedureResult.stderr}`);
const deliveredProcedureDocument = JSON.parse(deliveredProcedureResult.stdout);
const withoutExactFacts = (document) => {
  const copy = JSON.parse(JSON.stringify(document));
  for (const procedure of Object.values(copy.procedures)) {
    delete procedure.exactFactsToEstablish;
  }
  return copy;
};
fail(
  JSON.stringify(withoutExactFacts(procedureDocument))
    === JSON.stringify(withoutExactFacts(deliveredProcedureDocument)),
  "procedure field outside exactFactsToEstablish changed from delivery",
);
const procedureEntries = procedureDocument.procedures;
const procedureIds = Object.keys(procedureEntries);
const requirementIds = matrix.evidenceRequirements.map((item) => item.id);
const ownerNames = inventory.owners.map((owner) => owner[0]);
const mappingIds = inventory.mappingIds;
const operationIds = inventory.additionalOperationIds;
const authoritativeIds = new Set([
  ...mappingIds.map((id) => `mapping:${id}`),
  ...operationIds.map((id) => `additional-operation:${id}`),
]);

fail(
  mappingIds.length === 1435
    && inventory.occurrences.length === 1459
    && operationIds.length === 110
    && ownerNames.length === 8
    && authoritativeIds.size === 1545,
  "authoritative inventory count/set mismatch",
);
fail(
  crosswalk.mappings.length === 1435
    && crosswalk.additionalOperations.length === 110
    && crosswalk.inventory.recordCount === 1459
    && crosswalk.inventory.ownerCount === 8
    && crosswalk.mappings.every((record) => record.status === "UNRESOLVED")
    && crosswalk.additionalOperations.every((record) => record.status === "UNRESOLVED"),
  "authoritative crosswalk count/status mismatch",
);
fail(
  additionalEvidence.length === 110
    && new Set(additionalEvidence.map((record) => record.id)).size === 110
    && operationIds.every((id) => additionalEvidence.some((record) => record.id === id)),
  "additional-operation evidence set mismatch",
);

// Rebuild exact primary object components. These are review assignments, not
// claims that every shared object is a semantic dependency.
const sourceRows = [
  ...inventory.records.mappings,
  ...inventory.records.additionalOperations,
];
const stableIds = [...authoritativeIds];
const parent = stableIds.map((_, index) => index);
const find = (index) => parent[index] === index
  ? index : (parent[index] = find(parent[index]));
const join = (left, right) => {
  left = find(left);
  right = find(right);
  if (left !== right) parent[right] = left;
};
const firstAtGroup = new Map();
sourceRows.forEach((record, recordIndex) => record[2].forEach((groupIndex) => {
  if (firstAtGroup.has(groupIndex)) join(recordIndex, firstAtGroup.get(groupIndex));
  else firstAtGroup.set(groupIndex, recordIndex);
}));
const components = new Map();
stableIds.forEach((recordId, index) => {
  const rootIndex = find(index);
  if (!components.has(rootIndex)) components.set(rootIndex, []);
  components.get(rootIndex).push(recordId);
});
const lifecycleAssignments = new Map([
  ["additional-operation:booking-command/transaction-and-advisory-lock",
    "B-08-booking-idempotency-scope/source-lifecycle"],
  ["additional-operation:education-bundle/transaction-and-advisory-lock",
    "B-02-bundle-payment-and-target-state/source-lifecycle"],
  ["additional-operation:marketplace/advisory-lock-and-session-state",
    "B-05-marketplace-concurrent-index-recovery/source-lifecycle"],
  ["additional-operation:referral/transaction-and-advisory-lock",
    "B-06-referral-tracking-invariant/source-lifecycle"],
  ["additional-operation:web-push/transaction-and-advisory-lock",
    "B-07-web-push-expiry-transition/source-lifecycle"],
]);
const ownerLifecycleIds = {
  ensureBusinessGrowthSchema:
    "business-growth/advisory-lock-and-session-state",
  ensureMediaSchema: "media/transaction-and-advisory-lock",
  ensureShippingConfigSchema: "shipping/duplicate-row-cleanup",
  ensureMarketplacePerformanceIndexes:
    "marketplace/advisory-lock-and-session-state",
  ensureReferralSchema: "referral/transaction-and-advisory-lock",
  ensureWebPushSchema: "web-push/transaction-and-advisory-lock",
  ensureBookingCommandSchema:
    "booking-command/transaction-and-advisory-lock",
  ensureEducationBundlePurchaseSchema:
    "education-bundle/transaction-and-advisory-lock",
};
const primaryAssignment = {};
for (const members of components.values()) {
  members.sort();
  const batch = lifecycleAssignments.get(members[0])
    ?? `B-09-object-component/${members[0]}`;
  for (const recordId of members) primaryAssignment[recordId] = batch;
}
fail(
  Object.keys(primaryAssignment).length === 1545
    && new Set(Object.values(primaryAssignment)).size === 960
    && firstAtGroup.size === 1044,
  "primary dependency/component assignment mismatch",
);

const gapFor = (family, index) => family === "mapping"
  ? gaps.records.mappings[index]
  : gaps.records.additionalOperations[index];
const selectorMappings = inventory.records.mappings.map((row, index) => ({
  recordId: `mapping:${mappingIds[index]}`,
  id: mappingIds[index],
  family: "mapping",
  ownerIndexes: row[0],
  operationKind: row[1],
  objectGroupIndexes: row[2],
}));
const selectorOperations = inventory.records.additionalOperations
  .map((row, index) => ({
    recordId: `additional-operation:${operationIds[index]}`,
    id: operationIds[index],
    family: "additional-operation",
    ownerIndex: row[0],
    category: row[1],
    objectGroupIndexes: row[2],
  }));
const selectorUniverse = [...selectorMappings, ...selectorOperations];
const selectorExact = (id) => selectorUniverse.filter((record) =>
  record.id === id);
const selectorKind = (kind) => selectorMappings.filter((record) =>
  record.operationKind === kind);
const selectorCategory = (category) => selectorOperations.filter((record) =>
  record.category === category);
const selectorUnion = (...sets) => [...new Map(sets.flat().map((record) =>
  [record.recordId, record])).values()];
const selectorNamedObject = (...names) => selectorUniverse.filter((record) =>
  record.objectGroupIndexes.some((groupIndex) => {
    const [groupId,, identity] = inventory.objectGroups[groupIndex];
    return names.some((name) => groupId.includes(name)
      || [identity?.name, identity?.parent].includes(name));
  }));
const selectorOwner = (name) => selectorUniverse.filter((record) =>
  (record.ownerIndexes || [record.ownerIndex]).some((ownerIndex) =>
    ownerNames[ownerIndex] === name));
const selectorDataOps = selectorUnion(
  selectorCategory("data-backfill"),
  selectorCategory("cleanup-reporting"),
);
const selectorOperationalOps = selectorCategory("operational-scaffolding");
const selectorFunctionOps = selectorCategory("function-replacement");
const selectorMarkerOps = selectorCategory("rollout-marker");
const selectorRecords = {
  "PE-01": selectorUniverse,
  "PE-02": selectorUnion(
    selectorMarkerOps,
    selectorExact("business-growth/advisory-lock-and-session-state"),
    selectorExact("business-growth/cleanup-report-read"),
    selectorExact("business-growth/rollout-marker-read"),
    selectorExact("business-growth/rollout-marker-write"),
    selectorNamedObject("business_growth_schema_rollout",
      "education_salon_cleanup_reports"),
  ),
  "PE-03": selectorUnion(
    selectorMappings,
    selectorFunctionOps,
    selectorNamedObject("education_bundle_purchases",
      "reject_bundle_payment_reference_change"),
  ),
  "PE-04": selectorUnion(
    selectorKind("create-index"),
    selectorKind("add-constraint"),
    selectorKind("validate-constraint"),
    selectorExact("shipping/duplicate-row-cleanup"),
    selectorExact("ensureWebPushSchema/source-discovered-82-dd7107a5f655438a"),
  ),
  "PE-05": selectorUnion(
    selectorDataOps,
    selectorKind("create-index"),
    selectorKind("add-constraint"),
    selectorKind("validate-constraint"),
    selectorKind("alter-table"),
    selectorKind("alter-type"),
    selectorExact("business-growth/bundle-payment-backfill"),
    selectorExact("education-bundle/payment-reference-backfill"),
    selectorExact("education-bundle/learner-id-backfill"),
    selectorExact("shipping/duplicate-row-cleanup"),
    selectorExact("ensureWebPushSchema/source-discovered-82-dd7107a5f655438a"),
    selectorExact("referral/tracking-start-backfill"),
  ),
  "PE-06": selectorUnion(
    selectorDataOps,
    selectorKind("drop-index"),
    selectorFunctionOps,
    selectorExact("education-bundle/payment-reference-backfill"),
    selectorExact("education-bundle/learner-id-backfill"),
  ),
  "PE-07": selectorUniverse,
  "PE-08": selectorUnion(
    selectorFunctionOps,
    selectorKind("create-trigger"),
    selectorKind("drop-index"),
    selectorKind("create-extension"),
  ),
  "PE-09": selectorUnion(
    selectorDataOps,
    selectorKind("drop-index"),
    selectorFunctionOps,
    selectorMarkerOps,
    selectorOwner("ensureMarketplacePerformanceIndexes"),
  ),
  "PE-10": selectorUniverse,
};
const selectorSets = Object.fromEntries(Object.entries(selectorRecords)
  .map(([id, selected]) =>
    [id, new Set(selected.map((record) => record.recordId))]));
const expectedRequirementsFor = (recordId) => requirementIds.filter((id) =>
  selectorSets[id].has(recordId));
const proceduresFor = (requirements) => requirements.map((id) =>
  id.replace("PE-", "P-"));
const recordContractFields = [
  "authoritativeRecordId", "operationType", "startupOwners",
  "sourceLocations", "sourceFingerprint", "relevantOccurrenceIds", "status",
  "existingEvidenceReferences", "missingEvidenceRequirementIds",
  "dependencyIds", "businessDecisionRequirement",
  "proposedCollectionProcedureIds", "expectedArtifact",
  "validationCriteria", "risks", "prerequisites", "approval", "phase",
  "uncertaintyBlockers",
];

const records = [];
for (let index = 0; index < mappingIds.length; index += 1) {
  const row = inventory.records.mappings[index];
  const sourceRecord = crosswalk.mappings[row[5]];
  const occurrences = inventory.occurrences
    .map((occurrence, globalIndex) => ({ occurrence, globalIndex }))
    .filter(({ occurrence }) => occurrence[0] === index);
  const gap = gapFor("mapping", index);
  const recordId = `mapping:${mappingIds[index]}`;
  const mappingRequirementIds = expectedRequirementsFor(recordId);
  const mappingProcedureIds = proceduresFor(mappingRequirementIds);
  records.push({
    authoritativeRecordId: recordId,
    family: "mapping",
    operationType: row[1],
    startupOwners: row[0].map((ownerIndex) => ownerNames[ownerIndex]),
    sourceLocations: occurrences.map(({ occurrence }) => ({
      ownerFile: inventory.owners[occurrence[2]][1],
      literalAndOperationPosition: occurrence[3],
      executionOrder: occurrence[4],
      phase: occurrence[5],
      callSite: occurrence[6],
    })),
    sourceFingerprint: mappingIds[index],
    relevantOccurrenceIds: occurrences.map(({ occurrence }) =>
      `occurrence:${mappingIds[index]}:${occurrence[1] + 1}`),
    status: "UNRESOLVED",
    existingEvidenceReferences: [
      `${readiness}/inventory.json:mapping:${index}`,
      `${readiness}/evidence-gaps.json:mapping:${index}`,
      `${crosswalkPath}:mapping:${row[5]}`,
    ],
    missingEvidenceRequirementIds: mappingRequirementIds,
    dependencyIds: [
      primaryAssignment[recordId],
      ...row[2].map((groupIndex) => `object-group:${groupIndex}`),
      ...row[0].map((ownerIndex) =>
        `owner-lifecycle:${ownerLifecycleIds[ownerNames[ownerIndex]]}`),
    ],
    businessDecisionRequirement: mappingRequirementIds.includes("PE-06")
      ? "REQUIRED:PE-06"
      : "NOT_APPLICABLE_WITH_INDEPENDENT_REVIEW",
    proposedCollectionProcedureIds: mappingProcedureIds,
    expectedArtifact: "redacted versioned evidence envelope with exact record/occurrence IDs and digest",
    validationCriteria: "authorized fact, exact scope, provenance, minimization, freshness, and independent disposition",
    risks: row[6],
    prerequisites: ["P-01 target/release attestation", "primary component review", ...gap[0]],
    approval: mappingRequirementIds.includes("PE-06")
      ? ["system/DB owner", "business/data owner", "independent reviewer"]
      : ["system/DB owner", "independent reviewer"],
    phase: mappingRequirementIds.includes("PE-05")
      ? "data-and-business" : "catalog-and-runtime",
    uncertaintyBlockers: ["production facts UNKNOWN", ...gap[1]],
  });
  fail(
    sourceRecord?.fingerprint === mappingIds[index]
      && sourceRecord.status === "UNRESOLVED"
      && occurrences.length === sourceRecord.occurrences.length,
    `mapping source join mismatch ${index}`,
  );
}
for (let index = 0; index < operationIds.length; index += 1) {
  const row = inventory.records.additionalOperations[index];
  const [crosswalkIndex, evidenceIndex] = row[4];
  const sourceRecord = crosswalk.additionalOperations[crosswalkIndex];
  const evidenceRecord = additionalEvidence[evidenceIndex];
  const gap = gapFor("additional-operation", index);
  const recordId = `additional-operation:${operationIds[index]}`;
  const operationRequirementIds = expectedRequirementsFor(recordId);
  const operationProcedureIds = proceduresFor(operationRequirementIds);
  records.push({
    authoritativeRecordId: recordId,
    family: "additional-operation",
    operationType: row[1],
    startupOwners: [ownerNames[row[0]]],
    sourceLocations: [evidenceRecord.sourcePath],
    sourceFingerprint: hashText(evidenceRecord.sourceEvidence
      .map((item) => item.sqlOrCode).join("\n")),
    relevantOccurrenceIds: [],
    status: "UNRESOLVED",
    existingEvidenceReferences: [
      `${readiness}/inventory.json:additional-operation:${index}`,
      `${readiness}/evidence-gaps.json:additional-operation:${index}`,
      `docs/additional-operations-evidence/complete-evidence.json:${evidenceIndex}`,
      `${crosswalkPath}:additional-operation:${crosswalkIndex}`,
    ],
    missingEvidenceRequirementIds: operationRequirementIds,
    dependencyIds: [
      primaryAssignment[recordId],
      ...row[2].map((groupIndex) => `object-group:${groupIndex}`),
      `owner-lifecycle:${ownerLifecycleIds[ownerNames[row[0]]]}`,
    ],
    businessDecisionRequirement: operationRequirementIds.includes("PE-06")
      ? "REQUIRED:PE-06"
      : "NOT_APPLICABLE_WITH_INDEPENDENT_REVIEW",
    proposedCollectionProcedureIds: operationProcedureIds,
    expectedArtifact: "redacted versioned evidence envelope with exact record ID and digest",
    validationCriteria: "authorized fact, exact scope, provenance, minimization, freshness, and independent disposition",
    risks: row[5],
    prerequisites: ["P-01 target/release attestation", "primary component review", ...gap[0]],
    approval: operationRequirementIds.includes("PE-06")
      ? ["system/DB owner", "business/data owner", "independent reviewer"]
      : ["system/DB owner", "independent reviewer"],
    phase: operationRequirementIds.includes("PE-05")
      ? "data-and-business" : "catalog-and-runtime",
    uncertaintyBlockers: ["production facts UNKNOWN", ...gap[1]],
  });
  fail(
    sourceRecord?.id === operationIds[index]
      && evidenceRecord?.id === operationIds[index]
      && sourceRecord.status === "UNRESOLVED"
      && evidenceRecord.status === "UNRESOLVED",
    `additional-operation source/evidence join mismatch ${index}`,
  );
}

// Attach the exact source-demonstrated DEP-* co-review relationships declared
// by the matrix. Object selectors use the inventory's exact structured
// identities; they do not infer a production dependency.
const semanticEdgeMembership = new Map();
for (const rule of matrix.sourceDemonstratedDependencyRules.rules) {
  const selected = new Set(rule.exactRecordIds ?? []);
  for (const recordId of selected) {
    fail(authoritativeIds.has(recordId),
      `${rule.id} names unknown authoritative record ${recordId}`);
  }
  for (const term of rule.containsObject ?? []) {
    inventory.objectGroups.forEach((group, groupIndex) => {
      if (JSON.stringify([group[0], group[2]]).includes(term)) {
        records.filter((record) =>
          record.dependencyIds.includes(`object-group:${groupIndex}`))
          .forEach((record) => selected.add(record.authoritativeRecordId));
      }
    });
  }
  if (rule.owner) {
    records.filter((record) => record.startupOwners.includes(rule.owner))
      .forEach((record) => selected.add(record.authoritativeRecordId));
  }
  fail(selected.size >= 2, `${rule.id} has fewer than two exact members`);
  semanticEdgeMembership.set(rule.id, [...selected].sort());
  for (const recordId of selected) {
    records.find((record) => record.authoritativeRecordId === recordId)
      .dependencyIds.push(rule.id);
  }
}
fail(
  semanticEdgeMembership.size === 15
    && [...semanticEdgeMembership.keys()].every((id) => /^DEP-\d{3}$/.test(id)),
  "source-demonstrated dependency registry mismatch",
);
const expectedSemanticEdgesByRecord = new Map(records.map((record) => [
  record.authoritativeRecordId,
  record.dependencyIds.filter((id) => id.startsWith("DEP-")).sort(),
]));
const expectedRecordById = new Map(records.map((record) =>
  [record.authoritativeRecordId, record]));
const persistedRecords = matrix.records;
fail(Array.isArray(persistedRecords), "matrix.records is not materialized");
const sameSet = (left, right) => JSON.stringify([...left].sort())
  === JSON.stringify([...right].sort());
for (const persisted of persistedRecords) {
  const expected = expectedRecordById.get(persisted.authoritativeRecordId);
  fail(expected, `persisted unknown record ${persisted.authoritativeRecordId}`);
  const checks = {
    family: persisted.family === expected.family,
    operationType: persisted.operationType === expected.operationType,
    sourceFingerprint: persisted.sourceFingerprint === expected.sourceFingerprint,
    status: persisted.status === "UNRESOLVED",
    startupOwners: sameSet(persisted.startupOwners, expected.startupOwners),
    occurrences: sameSet(persisted.relevantOccurrenceIds,
      expected.relevantOccurrenceIds),
    requirements: sameSet(persisted.missingEvidenceRequirementIds,
      expected.missingEvidenceRequirementIds),
    procedures: sameSet(persisted.proposedCollectionProcedureIds,
      expected.proposedCollectionProcedureIds),
    dependencies: sameSet(persisted.dependencyIds, expected.dependencyIds),
    businessDecision: persisted.businessDecisionRequirement
      === expected.businessDecisionRequirement,
    phase: persisted.phase === expected.phase,
    sourceLocations: persisted.sourceLocations.length
      === expected.sourceLocations.length,
  };
  fail(Object.values(checks).every(Boolean),
    `persisted record differs from expected profile ${persisted.authoritativeRecordId}: ${
      Object.entries(checks).filter(([, passed]) => !passed)
        .map(([name]) => name).join(", ")}`);
}

const expectedProcedureAccess = {
  "P-01": false,
  "P-02": true,
  "P-03": true,
  "P-04": true,
  "P-05": true,
  "P-06": false,
  "P-07": true,
  "P-08": true,
  "P-09": false,
  "P-10": false,
};
const mergedProcedure = (id, entry, document = procedureDocument) => ({
  ...entry,
  id,
});

const validate = (candidateRecords, candidateProcedureDocument) => {
  const candidateProcedureIds = Object.keys(candidateProcedureDocument.procedures);
  const recordIds = candidateRecords.map((record) => record.authoritativeRecordId);
  const occurrenceIds = candidateRecords.flatMap((record) => record.relevantOccurrenceIds);
  if (candidateRecords.length !== 1545
      || duplicates(recordIds).length
      || recordIds.some((id) => !authoritativeIds.has(id))
      || authoritativeIds.size !== new Set(recordIds).size
      || candidateRecords.filter((record) => record.authoritativeRecordId.startsWith("mapping:")).length !== 1435
      || candidateRecords.filter((record) => record.authoritativeRecordId.startsWith("additional-operation:")).length !== 110
      || occurrenceIds.length !== 1459
      || duplicates(occurrenceIds).length
      || candidateRecords.some((record) => record.status !== "UNRESOLVED")
      || candidateRecords.some((record) => recordContractFields
        .some((field) => record[field] === undefined || record[field] === null))
      || candidateRecords.some((record) => !record.missingEvidenceRequirementIds.length
        || !record.proposedCollectionProcedureIds.length
        || record.missingEvidenceRequirementIds.some((id) => !requirementIds.includes(id))
        || record.proposedCollectionProcedureIds.some((id) => !candidateProcedureIds.includes(id)))
      || candidateRecords.some((record) => {
        const expected = expectedSemanticEdgesByRecord
          .get(record.authoritativeRecordId);
        const actual = record.dependencyIds
          .filter((id) => id.startsWith("DEP-")).sort();
        return !expected || JSON.stringify(actual) !== JSON.stringify(expected);
      })
      || candidateRecords.some((record) => {
        const expected = expectedRecordById.get(record.authoritativeRecordId);
        return !expected
          || !sameSet(record.missingEvidenceRequirementIds,
            expected.missingEvidenceRequirementIds)
          || !sameSet(record.proposedCollectionProcedureIds,
            expected.proposedCollectionProcedureIds);
      })
      || candidateRecords.some((record) => "observedProductionResult" in record)) return false;
  for (const [id, entry] of Object.entries(candidateProcedureDocument.procedures)) {
    const expanded = mergedProcedure(id, entry, candidateProcedureDocument);
    const normalizedPurpose = expanded.purpose
      .replace(/\s+/g, " ").trim().toLowerCase();
    const exactFacts = expanded.exactFactsToEstablish;
    const normalizedFacts = Array.isArray(exactFacts)
      ? exactFacts.map((fact) => typeof fact === "string"
        ? fact.replace(/\s+/g, " ").trim().toLowerCase()
        : "")
      : [];
    if (!procedureDocument.perProcedureRequiredFields.every((field) =>
      expanded[field] !== undefined && expanded[field] !== null)
      || !Array.isArray(exactFacts)
      || exactFacts.length < 5
      || normalizedFacts.some((fact) => fact.length < 20)
      || new Set(normalizedFacts).size !== normalizedFacts.length
      || normalizedFacts.includes(normalizedPurpose)
      || normalizedFacts.join(" ") === normalizedPurpose
      || !expanded.exactApplicableRecordIds.length
      || expanded.exactApplicableRecordIds.some((recordId) => !authoritativeIds.has(recordId))
      || !sameSet(expanded.exactApplicableRecordIds,
        candidateRecords.filter((record) =>
          record.proposedCollectionProcedureIds.includes(id))
          .map((record) => record.authoritativeRecordId))
      || expanded.productionAccessRequired !== expectedProcedureAccess[id]
      || !expanded.approvalGate
      || !expanded.stopConditions.length
      || entry.evidenceRequirementIds.some((requirementId) =>
        !matrix.evidenceRequirements.some((requirement) =>
          requirement.id === requirementId && requirement.procedureIds.includes(id)))) return false;
  }
  return candidateProcedureIds.every((procedureId) =>
    candidateRecords.some((record) =>
      record.proposedCollectionProcedureIds.includes(procedureId)));
};

fail(validate(persistedRecords, procedureDocument), "matrix/procedure validation failed");
fail(
  persistedRecords.flatMap((record) => record.relevantOccurrenceIds).length === 1459
    && new Set(persistedRecords.flatMap((record) => record.relevantOccurrenceIds)).size === 1459
    && new Set(persistedRecords.flatMap((record) => record.startupOwners)).size === 8
    && requirementIds.length === 10
    && procedureIds.length === 10,
  "coverage or procedure cardinality mismatch",
);
const requiredValidityOperations = [
  "additional-operation:shipping/duplicate-row-cleanup",
  "additional-operation:ensureWebPushSchema/source-discovered-82-dd7107a5f655438a",
];
fail(
  requiredValidityOperations.every((recordId) => {
    const record = persistedRecords.find((candidate) =>
      candidate.authoritativeRecordId === recordId);
    return record?.missingEvidenceRequirementIds.includes("PE-04")
      && record.proposedCollectionProcedureIds.includes("P-04");
  })
    && Object.entries(selectorSets).every(([requirementId, expectedSet]) => {
      const actualSet = new Set(persistedRecords
        .filter((record) =>
          record.missingEvidenceRequirementIds.includes(requirementId))
        .map((record) => record.authoritativeRecordId));
      return expectedSet.size === actualSet.size
        && [...expectedSet].every((recordId) => actualSet.has(recordId));
    }),
  "authoritative production-evidence selector applicability mismatch",
);

const clone = (value) => JSON.parse(JSON.stringify(value));
const negativeCases = [
  ["missing mapping", () => {
    const copy = clone(persistedRecords);
    copy.splice(copy.findIndex((record) =>
      record.authoritativeRecordId.startsWith("mapping:")), 1);
    return !validate(copy, procedureDocument);
  }],
  ["duplicate mapping", () => {
    const copy = clone(persistedRecords);
    copy.push(clone(copy.find((record) =>
      record.authoritativeRecordId.startsWith("mapping:"))));
    return !validate(copy, procedureDocument);
  }],
  ["unknown additional operation", () => {
    const copy = clone(persistedRecords);
    copy.find((record) =>
      record.authoritativeRecordId.startsWith("additional-operation:"))
      .authoritativeRecordId = "additional-operation:not-authoritative";
    return !validate(copy, procedureDocument);
  }],
  ["missing occurrence", () => {
    const copy = clone(persistedRecords);
    copy.find((record) => record.relevantOccurrenceIds.length)
      .relevantOccurrenceIds.pop();
    return !validate(copy, procedureDocument);
  }],
  ["unknown procedure reference", () => {
    const copy = clone(persistedRecords);
    copy[0].proposedCollectionProcedureIds.push("P-UNKNOWN");
    return !validate(copy, procedureDocument);
  }],
  ["orphaned procedure", () => {
    const copy = clone(procedureDocument);
    copy.procedures["P-ORPHAN"] = clone(copy.procedures["P-10"]);
    return !validate(persistedRecords, copy);
  }],
  ["missing approval gate", () => {
    const copy = clone(procedureDocument);
    delete copy.procedures["P-01"].approvalGate;
    return !validate(persistedRecords, copy);
  }],
  ["incorrect production-access classification", () => {
    const copy = clone(procedureDocument);
    copy.procedures["P-10"].productionAccessRequired = true;
    return !validate(persistedRecords, copy);
  }],
  ["unauthorized READY or RESOLVED status", () => {
    const copy = clone(persistedRecords);
    copy[0].status = "RESOLVED";
    return !validate(copy, procedureDocument);
  }],
  ["fabricated production evidence", () => {
    const copy = clone(persistedRecords);
    copy[0].observedProductionResult = "object exists";
    return !validate(copy, procedureDocument);
  }],
  ["missing unique-index data invariant", () => {
    const copy = clone(persistedRecords);
    const record = copy.find((candidate) =>
      candidate.authoritativeRecordId
        === "mapping:c91656618e3ed810da898b8389d35bed601bffaf49e74b9523491f90d403ed48");
    record.missingEvidenceRequirementIds =
      record.missingEvidenceRequirementIds.filter((id) => id !== "PE-05");
    record.proposedCollectionProcedureIds =
      record.proposedCollectionProcedureIds.filter((id) => id !== "P-05");
    return !validate(copy, procedureDocument);
  }],
  ["missing constraint validity and invariant", () => {
    const copy = clone(persistedRecords);
    const record = copy.find((candidate) =>
      candidate.family === "mapping"
        && candidate.operationType === "add-constraint");
    record.missingEvidenceRequirementIds =
      record.missingEvidenceRequirementIds.filter((id) =>
        !["PE-04", "PE-05"].includes(id));
    record.proposedCollectionProcedureIds =
      record.proposedCollectionProcedureIds.filter((id) =>
        !["P-04", "P-05"].includes(id));
    return !validate(copy, procedureDocument);
  }],
  ["missing type-transition data invariant", () => {
    const copy = clone(persistedRecords);
    const record = copy.find((candidate) =>
      candidate.family === "mapping"
        && candidate.operationType === "alter-type");
    record.missingEvidenceRequirementIds =
      record.missingEvidenceRequirementIds.filter((id) => id !== "PE-05");
    record.proposedCollectionProcedureIds =
      record.proposedCollectionProcedureIds.filter((id) => id !== "P-05");
    return !validate(copy, procedureDocument);
  }],
  ["missing owner lifecycle evidence", () => {
    const copy = clone(persistedRecords);
    const record = copy.find((candidate) =>
      candidate.family === "mapping"
        && candidate.startupOwners.includes("ensureMediaSchema"));
    record.missingEvidenceRequirementIds =
      record.missingEvidenceRequirementIds.filter((id) => id !== "PE-07");
    record.proposedCollectionProcedureIds =
      record.proposedCollectionProcedureIds.filter((id) => id !== "P-07");
    record.dependencyIds = record.dependencyIds.filter((id) =>
      !id.startsWith("owner-lifecycle:"));
    return !validate(copy, procedureDocument);
  }],
];
fail(
  negativeCases.length === 14
    && negativeCases.every(([, detected]) => detected()),
  "one or more negative cases escaped detection",
);
const exactFactsNegativeCases = [
  ["purpose duplicated as exact facts", () => {
    const copy = clone(procedureDocument);
    copy.procedures["P-01"].exactFactsToEstablish =
      [copy.procedures["P-01"].purpose];
    return !validate(persistedRecords, copy);
  }],
  ["empty exact facts", () => {
    const copy = clone(procedureDocument);
    copy.procedures["P-10"].exactFactsToEstablish = [];
    return !validate(persistedRecords, copy);
  }],
];
fail(
  exactFactsNegativeCases.every(([, detected]) => detected()),
  "an exact-facts negative case escaped detection",
);

// Preserve every input pinned by the readiness inventory.
for (const [file, expectedHash] of Object.entries(inventory.inputPins)) {
  fail(sha256(file) === expectedHash, `protected input hash drift: ${file}`);
}
fail(
  sha256("lib/db/migrations/000001_canonical_schema/migration.sql")
    === "643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60",
  "canonical baseline hash drift",
);
const pilotVerification = fs.readFileSync(
  "docs/ddl-resolution-pilot/verification.md", "utf8",
);
const pilotPins = [...pilotVerification.matchAll(
  /^([a-f0-9]{64})  (.+)$/gm,
)].map((match) => ({ expectedHash: match[1], file: match[2] }));
fail(
  pilotPins.length === 25
    && pilotPins.every(({ file, expectedHash }) =>
      sha256(file) === expectedHash),
  "pilot pin mismatch",
);

const actualFiles = fs.readdirSync(docs)
  .filter((name) => fs.statSync(path.join(docs, name)).isFile()).sort();
fail(
  JSON.stringify(actualFiles) === JSON.stringify([...expectedFiles].sort()),
  `unexpected plan files: ${actualFiles.join(", ")}`,
);
const status = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
const changedPaths = status.stdout.split("\n").filter(Boolean)
  .map((line) => line.slice(3));
const committed = run("git", [
  "diff", "--name-only", `${deliveryHead}..HEAD`,
]);
const committedPaths = committed.stdout.split("\n").filter(Boolean);
const observedPaths = new Set([...changedPaths, ...committedPaths]);
const allowedCorrectionPath = (file) => file.startsWith(`${docs}/`)
  || file === correctionSpecification;
fail(
  [...observedPaths].every(allowedCorrectionPath)
    && changedPaths.every(allowedCorrectionPath)
    && committedPaths.every(allowedCorrectionPath)
    && observedPaths.has(correctionSpecification)
    && sha256(correctionSpecification) === correctionSpecificationHash,
  `write-scope breach: working=${changedPaths.join(", ")}; committed=${
    committedPaths.join(", ")}`,
);
for (const file of actualFiles) {
  const whitespace = run("git", [
    "diff", "--no-index", "--check", "/dev/null", path.join(docs, file),
  ]);
  fail(!whitespace.stdout && !whitespace.stderr,
    `whitespace diagnostic: ${file}`);
}

console.log("PASS coverage: mappings=1435; occurrences=1459; additional=110; owners=8; records=1545");
console.log(`PASS procedures: requirements=${requirementIds.length}; procedures=${procedureIds.length}; bidirectional references valid`);
console.log(`PASS dependencies: source-edges=${semanticEdgeMembership.size}; object-groups=${firstAtGroup.size}; primary-components=${new Set(Object.values(primaryAssignment)).size}; records-assigned=${Object.keys(primaryAssignment).length}`);
console.log(`PASS negatives: ${negativeCases.map(([name]) => name).join("; ")}`);
console.log(`PASS exact facts negatives: ${exactFactsNegativeCases.map(([name]) => name).join("; ")}`);
console.log(`PASS preservation: readiness-hashes=${Object.keys(inventory.inputPins).length}; pilot-pins=${pilotPins.length}; canonical preserved; authoritative UNRESOLVED=1545`);
console.log(`PASS repository write scope: delivery HEAD=${deliveryHead}; current HEAD=${run("git", ["rev-parse", "HEAD"]).stdout.trim()}; changed=${[...observedPaths].sort().join(", ")}`);
console.log("PASS safety: no database, SQL, network, migration, workflow, startup, push, merge, Publish, or Deploy");
NODE
```

## Executed result

Executed from the repository root by extracting the shell fence to standard
input; no checker file was created. Exit status: **0**.

```text
PASS provenance: automatic source artifact belongs to a6355946, predates 7de77df5, and is outside the eight delivered documents
PASS import boundary: audited static Node/TypeScript loader only
PASS coverage: mappings=1435; occurrences=1459; additional=110; owners=8; records=1545
PASS procedures: requirements=10; procedures=10; bidirectional references valid
PASS dependencies: source-edges=15; object-groups=1044; primary-components=960; records-assigned=1545
PASS negatives: missing mapping; duplicate mapping; unknown additional operation; missing occurrence; unknown procedure reference; orphaned procedure; missing approval gate; incorrect production-access classification; unauthorized READY or RESOLVED status; fabricated production evidence; missing unique-index data invariant; missing constraint validity and invariant; missing type-transition data invariant; missing owner lifecycle evidence
PASS exact facts negatives: purpose duplicated as exact facts; empty exact facts
PASS preservation: readiness-hashes=32; pilot-pins=25; canonical preserved; authoritative UNRESOLVED=1545
PASS repository write scope: delivery HEAD=7de77df58161ad8a0b960d8a83d34f744d1e0745; current HEAD=d33e055c6af2fd4420199c3489f077a75c860dc0; changed=attached_assets/Pasted-TASK-943-CORRECT-F1-F2-AND-F3-ONLY-Implement-the-three-_1789591368938.txt, docs/production-evidence-plan/README.md, docs/production-evidence-plan/collection-procedures.json, docs/production-evidence-plan/collection-procedures.md, docs/production-evidence-plan/verification.md
PASS safety: no database, SQL, network, migration, workflow, startup, push, merge, Publish, or Deploy
```

## F1–F3 correction provenance and final pre-completion state

The original uploaded specification is the automatic Replit artifact
`attached_assets/Pasted-TASK-942-PRODUCTION-EVIDENCE-COLLECTION-PLAN-PHASE-5B-4_1789588997282.txt`.
The `git ls-tree` assertion above fixes its blob identity in commit
`a635594692bf85879c647a179e9672b9fe36c9e2`. The ancestry and exact delivery
diff assertions prove that this commit predates
`7de77df58161ad8a0b960d8a83d34f744d1e0745` and that the artifact is not one
of the eight documents delivered under `docs/production-evidence-plan/`.

The F1–F3 correction request was already committed by automatic task
bookkeeping at correction-start HEAD
`d33e055c6af2fd4420199c3489f077a75c860dc0`. It is compared by exact path and
SHA-256; `attached_assets/` is not ignored or categorically exempted. Any other
changed path outside `docs/production-evidence-plan/` fails the repository-wide
scope assertion.

The exact pre-completion changed paths relative to delivery HEAD are:

```text
A attached_assets/Pasted-TASK-943-CORRECT-F1-F2-AND-F3-ONLY-Implement-the-three-_1789591368938.txt
M docs/production-evidence-plan/README.md
M docs/production-evidence-plan/collection-procedures.json
M docs/production-evidence-plan/collection-procedures.md
M docs/production-evidence-plan/verification.md
```

The first path predates the implementation edits and is the pinned correction
request. The four modified documentation paths are the complete F1–F3
implementation. The final pre-completion HEAD and full status are:

```text
d33e055c6af2fd4420199c3489f077a75c860dc0
## fix-production-demo-seed-boundary...github/fix-production-demo-seed-boundary [ahead 37]
 M docs/production-evidence-plan/README.md
 M docs/production-evidence-plan/collection-procedures.json
 M docs/production-evidence-plan/collection-procedures.md
 M docs/production-evidence-plan/verification.md
```

No database was accessed; no SQL, migration, startup DDL, push, merge,
Publish, Deploy, application restart, or production evidence collection was
performed. No independent review is claimed here. Stop after this report for
independent Claude Code review.

## Final interpretation

Passing this checker proves documentation coverage and internal consistency
only. It does not prove any production fact, authorize collection, establish
migration readiness, or permit a status change. The package must stop for an
independent Claude Code review.