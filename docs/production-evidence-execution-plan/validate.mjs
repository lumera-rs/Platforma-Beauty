// Database-free, read-only package validator. No collector or executor exists here.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const P = ['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06', 'P-07', 'P-08', 'P-09', 'P-10'];
const D = ['D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-07', 'D-08', 'D-09', 'D-10'];
const G = ['G-01', 'G-02', 'G-03', 'G-04', 'G-05', 'G-06', 'G-07', 'G-08', 'G-09', 'G-10'];
const PE = ['PE-01', 'PE-02', 'PE-03', 'PE-04', 'PE-05', 'PE-06', 'PE-07', 'PE-08', 'PE-09', 'PE-10'];
const canonicalPath = 'lib/db/migrations/000001_canonical_schema/migration.sql';
const canonicalHash = '643a649989c3658c96ae16d90c003eeeeee542f76d94cb3a8b00f6328002fc60';
const gatesByProcedure = {
  'P-01': ['G-01', 'G-02', 'G-03', 'G-07', 'G-08', 'G-09'],
  'P-02': ['G-01', 'G-02', 'G-03', 'G-04', 'G-07', 'G-08', 'G-09'],
  'P-03': ['G-01', 'G-02', 'G-03', 'G-04', 'G-07', 'G-08', 'G-09'],
  'P-04': ['G-01', 'G-02', 'G-03', 'G-04', 'G-07', 'G-08', 'G-09'],
  'P-05': ['G-01', 'G-02', 'G-03', 'G-04', 'G-07', 'G-08', 'G-09'],
  'P-06': ['G-01', 'G-02', 'G-07', 'G-08', 'G-09'],
  'P-07': ['G-01', 'G-02', 'G-03', 'G-04', 'G-07', 'G-08', 'G-09'],
  'P-08': ['G-01', 'G-02', 'G-03', 'G-04', 'G-07', 'G-08', 'G-09'],
  'P-09': ['G-01', 'G-02', 'G-03', 'G-07', 'G-08', 'G-09'],
  'P-10': ['G-01', 'G-02', 'G-07', 'G-08', 'G-09', 'G-10']
};
const gateContent = {
  'G-01': ['identity-inventory-authorization', ['target alias', 'environment', 'schema', 'revision', 'window', 'collector', 'time', 'retention', 'digest', '1435/110/1459/1044/1545 reconciliation']],
  'G-02': ['static-dependency-review', ['DEP-001 through DEP-015', 'canonical source pin', 'owner lifecycle review']],
  'G-03': ['target-ledger-reachability', ['written target attestation', 'ledger/marker provenance', 'release overlap']],
  'G-04': ['catalog-operational-state', ['approved identifiers', 'least privilege', 'active writers/workers', 'read-only precondition']],
  'G-05': ['p05-preflight', ['unique matching preflight', 'no scan preparation']],
  'G-06': ['p05-scan-independent-approval', ['manual independent phase approval', 'matching capture/chunk/record/environment/scope']],
  'G-07': ['business-policy-authorization', ['data/policy authorization', 'compensation/concurrency review']],
  'G-08': ['runtime-lock-recovery-readiness', ['worker overlap', 'lock/session state', 'GUC cleanup']],
  'G-09': ['restore-release-observability', ['verified restore test', 'dependent release', 'observability']],
  'G-10': ['independent-scope-and-disposition', ['initial independent scope approval', 'final independent disposition', 're-review triggers']]
};
const stageContract = [
  ['stage-0', 'manual approvals and operations readiness', ['P-06', 'P-07', 'P-09', 'P-10'], null, ['G-01', 'G-02', 'G-07', 'G-08', 'G-09', 'G-10']],
  ['stage-1', 'metadata', ['P-01', 'P-09'], null, ['G-01', 'G-02', 'G-03', 'G-07', 'G-08', 'G-09']],
  ['stage-2', 'schema', ['P-02', 'P-03', 'P-04'], null, ['G-01', 'G-02', 'G-03', 'G-04', 'G-07', 'G-08', 'G-09']],
  ['stage-3', 'functions and activity', ['P-08', 'P-07'], null, ['G-01', 'G-02', 'G-03', 'G-04', 'G-07', 'G-08', 'G-09']],
  ['stage-4', 'p05-preflight', ['P-05'], 'PREFLIGHT', ['G-01', 'G-02', 'G-03', 'G-04', 'G-07', 'G-08', 'G-09']],
  ['stage-5', 'p05-scan-separately-gated', ['P-05'], 'SCAN', ['G-01', 'G-02', 'G-03', 'G-04', 'G-05', 'G-06', 'G-07', 'G-08', 'G-09']],
  ['stage-6', 'p10-independent-review', ['P-10'], null, ['G-10']]
];
const dependencies = [
  'DEP-001:business-growth-4923-before-4928-before-target-check', 'DEP-002:business-growth-4939-and-education-co-review',
  'DEP-003:education-backfill-before-trigger', 'DEP-004:learner-postcondition', 'DEP-005:target-postcondition',
  'DEP-006:shared-business-growth-education-lock', 'DEP-007:webpush-add-before-backfill', 'DEP-008:webpush-backfill-before-not-null',
  'DEP-009:shipping-cleanup-before-unique-index', 'DEP-010:referral-column-before-backfill', 'DEP-011:booking-table-before-index',
  'DEP-012:media-type-before-image-assets', 'DEP-013:users-before-image-assets', 'DEP-014:marketplace-concurrent-index-recovery',
  'DEP-015:NO_SOURCE_EDGE_YET-is-a-finding-not-an-edge'
];
const diagnosticCounts = {
  'D-01': [1545, 0, 16, 1000], 'D-02': [3, 4, 1, 1000], 'D-03': [13, 1459, 1, 1000],
  'D-04': [19, 651, 1, 1000], 'D-05': [1, 1216, 1, 1], 'D-06': [0, 111, 0, 0],
  'D-07': [1545, 0, 16, 1000], 'D-08': [3, 71, 1, 500], 'D-09': [118, 0, 2, 1000], 'D-10': [0, 1545, 0, 0]
};
const failureCauses = ['unavailable database', 'insufficient privilege', 'timeout', 'lock contention', 'result cap', 'schema mismatch', 'state change', 'connection loss', 'partial capture', 'hash mismatch', 'P-05 preflight failure'];
const approvedAuthoritativeStatusRule = 'Capture statuses never alter authoritative UNRESOLVED records.';
const approvedInterpretation = {
  PASS: 'Establishes only the stated scoped observed fact.',
  FAIL: 'Never resolves an authoritative record.',
  UNKNOWN: 'Never resolves an authoritative record.'
};
const fail = (error) => { throw new Error(error); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys, error) => {
  if (!object(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail(error);
};
const sameSet = (actual, expected) => Array.isArray(actual) && Array.isArray(expected) &&
  new Set(actual).size === actual.length && new Set(expected).size === expected.length &&
  actual.length === expected.length && actual.every((item) => expected.includes(item));
const equalJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Reviewed preparation policy pins, not hashes supplied by the candidate.
// Changes to these policies require explicit re-review of the contract and prose.
const policyDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = (rootDir, path) => createHash('sha256').update(readFileSync(join(rootDir, path))).digest('hex');
const exactlyOne = (items, id, error) => {
  const matches = items.filter((item) => item === id).length;
  if (matches !== 1) fail(`${error}:${id}`);
};

function checkProtected(manifest, inputs) {
  exactKeys(manifest, ['schemaVersion', 'document', 'algorithm', 'immutableBaseline', 'snapshotBoundary', 'approvedDirectories', 'requiredPathInventory', 'originalProtectedFileCount', 'canonicalComparison', 'files', 'originalProtectedFiles'], 'E_PROTECTED_MANIFEST_FIELD_UNKNOWN');
  if (manifest.algorithm !== 'sha256' || manifest.immutableBaseline !== true || manifest.originalProtectedFileCount !== 73) fail('E_PROTECTED_MANIFEST_INVALID');
  if (!sameSet(manifest.requiredPathInventory, inputs.requiredPathInventory)) fail('E_PROTECTED_PATH_INVENTORY_MISMATCH');
  if (!sameSet(Object.keys(manifest.files), inputs.requiredPathInventory)) fail('E_PROTECTED_PATH_INVENTORY_MISMATCH');
  if (manifest.canonicalComparison?.path !== canonicalPath || manifest.canonicalComparison?.sha256 !== canonicalHash) fail('E_CANONICAL_PIN_MISMATCH');
  if (Object.keys(inputs.originalProtectedFiles).length !== 73 || !equalJson(manifest.originalProtectedFiles, inputs.originalProtectedFiles)) fail('E_PROTECTED_ORIGINAL73_MISMATCH');
  for (const path of inputs.requiredPathInventory) {
    const actual = inputs.rootDir ? digest(inputs.rootDir, path) : inputs.realHashes?.[path];
    if (manifest.files[path] !== actual) fail(`E_PROTECTED_HASH_DRIFT:${path}`);
  }
}

function checkPlan(plan, inputs) {
  exactKeys(plan, ['schemaVersion', 'document', 'planningOnly', 'executionAllowed', 'noSqlExecutor', 'authoritativeStatus', 'productionFacts', 'approvals', 'procedureToEvidenceToDiagnostic', 'procedures', 'diagnostics', 'gates', 'stages', 'requiredSourceEdges', 'executionEnvelope', 'failurePolicy'], 'E_PLAN_FIELD_UNKNOWN');
  if (plan.planningOnly !== true || plan.executionAllowed !== false || plan.noSqlExecutor !== true) fail('E_EXECUTION_NOT_APPROVED');
  if (plan.authoritativeStatus !== 'UNRESOLVED') fail('E_AUTHORITATIVE_STATUS_INVALID');
  exactKeys(plan.productionFacts, ['target', 'release', 'ledger', 'marker', 'schema', 'data', 'runtime', 'privilege', 'restore', 'independentReview'], 'E_PRODUCTION_CLAIM_NOT_ALLOWED');
  if (Object.values(plan.productionFacts).some((status) => status !== 'UNKNOWN')) fail('E_PRODUCTION_CLAIM_NOT_ALLOWED');
  exactKeys(plan.approvals, ['systemOwner', 'dataOwner', 'businessPolicyOwner', 'independentReviewer'], 'E_APPROVAL_STATUS_INVALID');
  if (Object.values(plan.approvals).some((status) => status !== 'UNKNOWN')) fail('E_APPROVAL_STATUS_INVALID');
  if (!sameSet(plan.requiredSourceEdges, dependencies)) fail('E_DEPENDENCY_LINKS_INVALID');
  if (plan.gates.length !== 10 || !sameSet(plan.gates.map((gate) => gate.id), G)) fail('E_GATE_CONTRACT_INVALID');
  for (const gate of plan.gates) {
    exactKeys(gate, ['id', 'name', 'required', 'checks'], `E_GATE_CONTRACT_INVALID:${gate.id}`);
    const expected = gateContent[gate.id];
    if (!expected || gate.required !== true || gate.name !== expected[0] || !equalJson(gate.checks, expected[1])) fail(`E_GATE_CONTRACT_INVALID:${gate.id}`);
  }
  if (plan.stages.length !== stageContract.length) fail('E_STAGE_ORDER_INVALID');
  for (let index = 0; index < stageContract.length; index += 1) {
    const [id, name, procedures, phase, gateIds] = stageContract[index];
    const stage = plan.stages[index];
    if (!stage || stage.id !== id || stage.name !== name || !sameSet(stage.procedures, procedures) || (stage.phase ?? null) !== phase || !sameSet(stage.gateIds, gateIds)) fail(`E_STAGE_ORDER_INVALID:${id}`);
    const expectedDiagnostics = [null, ['D-01', 'D-09'], ['D-02', 'D-03', 'D-04'], ['D-08', 'D-07'], ['D-05'], ['D-05'], ['D-10']][index];
    exactKeys(stage, ['id', 'name', 'procedures', 'gateIds', ...(expectedDiagnostics ? ['diagnostics'] : []), ...(phase ? ['phase'] : [])], `E_STAGE_FIELD_INVALID:${id}`);
    if (expectedDiagnostics && !sameSet(stage.diagnostics, expectedDiagnostics)) fail(`E_STAGE_DIAGNOSTICS_INVALID:${id}`);
  }
  if (plan.stages[4].gateIds.includes('G-05') || !plan.stages[5].gateIds.includes('G-05') || !plan.stages[5].gateIds.includes('G-06')) fail('E_P05_SCAN_REQUIRES_PREFLIGHT');
  if (!sameSet(plan.procedureToEvidenceToDiagnostic.map((item) => `${item.procedureId}/${item.evidenceRequirementId}/${item.diagnosticId}`), P.map((id, index) => `${id}/${PE[index]}/${D[index]}`))) fail('E_PROCEDURE_MAPPING_INVALID');
  if (plan.procedures.length !== 10 || !sameSet(plan.procedures.map((procedure) => procedure.id), P)) fail('E_PROCEDURE_DUPLICATE_OR_UNKNOWN');
  for (const procedure of plan.procedures) {
    const index = P.indexOf(procedure.id);
    if (procedure.diagnosticId !== D[index] || !sameSet(procedure.evidenceRequirementIds, [PE[index]])) fail(`E_PROCEDURE_MAPPING_INVALID:${procedure.id}`);
    if (!sameSet(procedure.requiredGateIds, gatesByProcedure[procedure.id])) fail(`E_PROCEDURE_GATES_INVALID:${procedure.id}`);
    if (!Array.isArray(procedure.exactApplicableRecordIds) || !sameSet(procedure.exactApplicableRecordIds, inputs.procedureRecordIds[procedure.id])) fail(`E_PROCEDURE_RECORD_SET_INVALID:${procedure.id}`);
    const source = inputs.procedures[procedure.id];
    exactKeys(procedure, [...Object.keys(source), 'diagnosticId', 'plannedEvidenceId', 'requiredGateIds', 'executionBranch', 'optionalSupportingObservation'], `E_PROCEDURE_FIELD_INVALID:${procedure.id}`);
    for (const key of Object.keys(source)) {
      if (!equalJson(procedure[key], source[key])) fail(`E_PROCEDURE_SOURCE_DRIFT:${procedure.id}:${key}`);
    }
    if (procedure.plannedEvidenceId !== `EC-${procedure.id.slice(2)}`) fail(`E_PLANNED_EVIDENCE_INVALID:${procedure.id}`);
  }
  if (plan.diagnostics.length !== 10 || !sameSet(plan.diagnostics.map((item) => item.diagnosticId), D)) fail('E_DIAGNOSTIC_DUPLICATE_OR_UNKNOWN');
  for (const item of plan.diagnostics) {
    exactKeys(item, ['diagnosticId', 'procedureId', 'evidenceRequirementId', 'noSql', 'executionAllowed', 'supportingObservationOnly', 'exactApplicableRecordCount', 'blockedRecordCount', 'chunkCount', 'parameterContract', 'outputSchema', 'resultFieldAllowlist', 'evidenceSatisfaction', 'statementLimitBytes', 'statementLimitRows', 'sourceSectionManifest', 'phaseContract'], `E_DIAGNOSTIC_FIELD_UNKNOWN:${item.diagnosticId}`);
    const index = D.indexOf(item.diagnosticId);
    if (index < 0 || item.procedureId !== P[index] || item.evidenceRequirementId !== PE[index]) fail(`E_DIAGNOSTIC_MAPPING_INVALID:${item.diagnosticId}`);
    const [applicable, blocked, chunks, rows] = diagnosticCounts[item.diagnosticId];
    if (item.exactApplicableRecordCount !== applicable || item.blockedRecordCount !== blocked || item.chunkCount !== chunks || item.statementLimitRows !== rows) fail(`E_DIAGNOSTIC_CAP_INVALID:${item.diagnosticId}`);
    if (!equalJson(item.sourceSectionManifest, inputs.sections[item.diagnosticId]) || !equalJson(item.parameterContract, inputs.diagnostics[item.diagnosticId].parameterContract) || !equalJson(item.outputSchema, inputs.diagnostics[item.diagnosticId].outputSchema)) fail(`E_DIAGNOSTIC_CONTRACT_MISMATCH:${item.diagnosticId}`);
    if (!sameSet(item.resultFieldAllowlist, item.outputSchema.map((column) => column.columnName))) fail(`E_RESULT_FIELD_UNKNOWN:${item.diagnosticId}`);
    const noSql = item.diagnosticId === 'D-06' || item.diagnosticId === 'D-10';
    if (item.supportingObservationOnly !== !noSql || item.evidenceSatisfaction !== (noSql ? 'BLOCKED_NON_DATABASE_ATTESTATION' : 'PARTIAL_OBSERVATION_WITH_BLOCKERS')) fail(`E_EVIDENCE_SATISFACTION_INVALID:${item.diagnosticId}`);
    if (item.executionAllowed !== false) fail(`E_DIAGNOSTIC_EXECUTION_NOT_APPROVED:${item.diagnosticId}`);
    if (item.noSql !== noSql || (noSql && (item.statementLimitRows !== 0 || item.statementLimitBytes !== 0 || item.outputSchema.length !== 0))) fail(`E_NOSQL_CONTRACT_INVALID:${item.diagnosticId}`);
    if (!noSql && item.statementLimitBytes !== 2097152) fail(`E_STATEMENT_BYTE_CAP_INVALID:${item.diagnosticId}`);
  }
  const d05 = plan.diagnostics.find((item) => item.diagnosticId === 'D-05').phaseContract;
  if (!d05 || d05.automaticTransition !== false || d05.preflight?.uniqueRequired !== true || d05.preflight?.targetExistsRequired !== true || d05.preflight?.scanPreparationForbidden !== true) fail('E_P05_PREFLIGHT_CONTRACT_INVALID');
  if (d05.scan?.manualIndependentApprovalRequired !== true || !sameSet(d05.preflight.captureBindingRequired, ['capture_id', 'chunk_id', 'record_id', 'environment_id', 'scope_digest'])) fail('E_P05_PREFLIGHT_APPROVAL_REQUIRED');
  if (policyDigest(d05) !== 'ca3d9f806f438b80e6a1c80b3cb973bc1846198115595ba551b92a309a2fbccd') fail('E_P05_FIXED_PHASE_CONTRACT_INVALID');
  for (const id of ['P-01', 'P-09']) {
    const procedure = plan.procedures.find((item) => item.id === id);
    if (procedure.executionBranch !== 'GOVERNANCE_OR_OPERATIONS_NO_DATABASE' || procedure.optionalSupportingObservation?.separatelyAuthorized !== true) fail(`E_GOVERNANCE_BRANCH_INVALID:${id}`);
  }
  const envelope = plan.executionEnvelope;
  if (!object(envelope) || envelope.statementTimeoutMs !== 15000 || envelope.lockTimeoutMs !== 1000 || envelope.idleInTransactionSessionTimeoutMs !== 10000 || envelope.connectionCap !== 1 || envelope.maxChunkRecordIds !== 100 || envelope.perSqlStatementResultBytes !== 2097152 || envelope.resultRowCap !== 1000 || envelope.transactionReadOnlyRequiredBeforeEveryStatement !== true || envelope.dedicatedLeastPrivilegeRoleRequired !== true) fail('E_ENVELOPE_LIMITS_INVALID');
  if (policyDigest(envelope) !== 'dfc88e6ee31afc8f4ef92fc42512d816d0729d8ebacfe536e52caf531af252e4') fail('E_ENVELOPE_SAFETY_POLICY_INVALID');
  if (!object(plan.failurePolicy) || !sameSet(plan.failurePolicy.causes, failureCauses) || !String(plan.failurePolicy.action).includes('do not repair')) fail('E_ABORT_PROCEDURE_MISSING');
  if (plan.failurePolicy.action !== 'BLOCKED; preserve UNKNOWN production facts and UNRESOLVED authoritative records; do not repair, retry, or advance automatically') fail('E_ABORT_ACTION_INVALID');
}

function checkCoverage(matrix, inputs) {
  exactKeys(matrix, ['schemaVersion', 'document', 'planningOnly', 'authoritativeStatus', 'counts', 'sourceReferences', 'records'], 'E_COVERAGE_FIELD_UNKNOWN');
  if (matrix.authoritativeStatus !== 'UNRESOLVED') fail('E_COVERAGE_STATUS_INVALID');
  if (matrix.planningOnly !== true) fail('E_COVERAGE_NOT_PREPARATION');
  if (!equalJson(matrix.counts, { ddlMappings: 1435, ddlOccurrences: 1459, additionalOperations: 110, startupOwners: 8, authoritativeRecords: 1545, primaryComponents: 960, objectGroups: 1044 })) fail('E_COVERAGE_COUNT_INVALID');
  const ids = [];
  const occurrences = [];
  for (const record of matrix.records) {
    exactKeys(record, ['authoritativeRecordId', 'family', 'ownerNames', 'occurrenceIds', 'objectGroupIds', 'authoritativeStatus', 'productionFacts', 'requirements'], 'E_RECORD_FIELD_UNKNOWN');
    ids.push(record.authoritativeRecordId);
    if (new Set(ids).size !== ids.length) fail(`E_RECORD_DUPLICATE:${record.authoritativeRecordId}`);
    const expected = inputs.records[record.authoritativeRecordId];
    if (!expected) fail(`E_RECORD_UNKNOWN:${record.authoritativeRecordId}`);
    if (!sameSet(record.ownerNames, expected.ownerNames)) fail(`E_OWNER_MISMATCH:${record.authoritativeRecordId}`);
    if (!sameSet(record.occurrenceIds, expected.occurrenceIds)) fail(`E_OCCURRENCE_MISMATCH:${record.authoritativeRecordId}`);
    if (record.family !== expected.family || !sameSet(record.objectGroupIds, expected.objectGroupIds)) fail(`E_RECORD_IDENTITY_MISMATCH:${record.authoritativeRecordId}`);
    if (record.authoritativeStatus !== 'UNRESOLVED' || record.productionFacts !== 'UNKNOWN') fail(`E_RECORD_STATUS_INVALID:${record.authoritativeRecordId}`);
    occurrences.push(...record.occurrenceIds);
    if (record.requirements.length !== expected.requirements.length) fail(`E_REQUIREMENT_COUNT_INVALID:${record.authoritativeRecordId}`);
    for (const item of record.requirements) {
      exactKeys(item, ['evidenceRequirementId', 'procedureId', 'diagnosticId', 'blocker', 'prerequisiteIds', 'gateIds', 'plannedEvidenceId'], `E_REQUIREMENT_FIELD_UNKNOWN:${record.authoritativeRecordId}`);
      const index = PE.indexOf(item.evidenceRequirementId);
      const expectedBlocker = ['D-06', 'D-10'].includes(D[index]) ? 'BLOCKED_NON_DATABASE_ATTESTATION' : 'PRODUCTION_EVIDENCE_REQUIRED';
      if (index < 0 || item.procedureId !== P[index] || item.diagnosticId !== D[index] || item.blocker !== expectedBlocker || !sameSet(item.prerequisiteIds, expected.prerequisites) || !sameSet(item.gateIds, gatesByProcedure[item.procedureId]) || item.plannedEvidenceId !== `EC-${item.procedureId.slice(2)}`) fail(`E_REQUIREMENT_MAPPING_INVALID:${record.authoritativeRecordId}`);
      exactlyOne(record.requirements.map((entry) => entry.evidenceRequirementId), item.evidenceRequirementId, 'E_REQUIREMENT_DUPLICATE');
    }
    for (const requirement of expected.requirements) exactlyOne(record.requirements.map((entry) => entry.evidenceRequirementId), requirement, `E_REQUIREMENT_MISSING:${record.authoritativeRecordId}`);
  }
  if (!sameSet(ids, Object.keys(inputs.records))) fail('E_RECORD_SET_MISMATCH');
  if (!sameSet(occurrences, inputs.occurrenceIds)) fail('E_OCCURRENCE_SET_MISMATCH');
  if (matrix.records.length !== 1545) fail('E_COVERAGE_COUNT_INVALID');
  if (!inputs.reconciled?.inventory || !inputs.reconciled?.gaps || !inputs.reconciled?.additionalEvidence || !inputs.reconciled?.procedures) fail('E_INDEPENDENT_RECONCILIATION_FAILED');
}

function checkTemplate(template, plan) {
  exactKeys(template, ['schemaVersion', 'document', 'planningOnly', 'authoritativeStatusRule', 'evidenceStatuses', 'authoritativeStatuses', 'emptyCapture', 'requiredFields', 'fieldContracts', 'resultFieldAllowlist', 'interpretation'], 'E_TEMPLATE_FIELD_UNKNOWN');
  if (template.authoritativeStatusRule !== approvedAuthoritativeStatusRule) fail('E_AUTHORITATIVE_STATUS_RULE_INVALID');
  exactKeys(template.interpretation, ['PASS', 'FAIL', 'UNKNOWN'], 'E_INTERPRETATION_FIELD_INVALID');
  for (const status of Object.keys(approvedInterpretation)) {
    if (template.interpretation[status] !== approvedInterpretation[status]) fail(`E_INTERPRETATION_INVALID:${status}`);
  }
  const required = ['evidenceId', 'parentAttemptId', 'captureId', 'diagnosticId', 'procedureId', 'phase', 'chunkId', 'authoritativeRecordIds', 'capturedAt', 'environmentId', 'parameters', 'parameterBounds', 'approval', 'evidenceStatus', 'result', 'observedFact', 'inferenceBoundary', 'decisionBoundary', 'provenance', 'scopeDigest', 'retention', 'freshness', 'independentReview', 'hashAlgorithm', 'evidenceHash', 'validationStatus', 'blockerOrAbortReason'];
  if (!sameSet(template.requiredFields, required) || !sameSet(Object.keys(template.fieldContracts), required) || !sameSet(template.evidenceStatuses, ['OBSERVED', 'PARTIAL', 'BLOCKED', 'UNKNOWN']) || !sameSet(template.authoritativeStatuses, ['UNRESOLVED']) || !object(template.emptyCapture) || Object.keys(template.emptyCapture).length !== 0) fail('E_TEMPLATE_CONTRACT_INVALID');
  if (template.fieldContracts.hashAlgorithm?.const !== 'SHA-256' || !String(template.fieldContracts.evidenceHash?.canonicalization).includes('recursively sorted UTF-8 JSON keys') || !String(template.fieldContracts.evidenceHash?.canonicalization).includes('excluding evidenceHash')) fail('E_TEMPLATE_HASH_CONTRACT_INVALID');
  if (template.planningOnly !== true || policyDigest(template.fieldContracts) !== '00f1f9818642801adbbb6f776eaae955fc763844e75487f01afd5582a8ccfec2') fail('E_TEMPLATE_FIELD_POLICY_INVALID');
  for (const diagnostic of plan.diagnostics) if (!sameSet(template.resultFieldAllowlist?.[diagnostic.diagnosticId], diagnostic.resultFieldAllowlist)) fail(`E_RESULT_FIELD_UNKNOWN:${diagnostic.diagnosticId}`);
}

export function validatePackage(candidate, inputs) {
  exactKeys(candidate, ['executionPlan', 'coverageMatrix', 'evidenceCaptureTemplate', 'protectedInputManifest'], 'E_PACKAGE_FIELD_UNKNOWN');
  if (!object(inputs) || !object(inputs.records) || !object(inputs.procedureRecordIds) || !object(inputs.sections) || !object(inputs.diagnostics) || !Array.isArray(inputs.requiredPathInventory)) fail('E_VALIDATION_INPUTS_INVALID');
  checkPlan(candidate.executionPlan, inputs);
  checkCoverage(candidate.coverageMatrix, inputs);
  checkTemplate(candidate.evidenceCaptureTemplate, candidate.executionPlan);
  checkProtected(candidate.protectedInputManifest, inputs);
  return { valid: true, records: 1545, diagnostics: 10 };
}

if (process.argv[1] && process.argv[1].endsWith('/validate.mjs')) {
  const { runAuditedSuite } = await import('./tests/validation-fixtures.mjs');
  const result = runAuditedSuite(validatePackage);
  for (const rejection of result.rejections) console.log(`REJECT [${rejection.name}]: ${rejection.message}`);
  console.log(`validate.mjs: baseline valid; ${result.negativeTests} negative fixtures rejected with exact errors; every mutation observed.`);
}