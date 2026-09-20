import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const read = (path) => JSON.parse(readFileSync(join(rootDir, path), 'utf8'));
const clone = (value) => structuredClone(value);
const allFiles = (path) => readdirSync(join(rootDir, path), { withFileTypes: true }).flatMap((entry) => {
  const child = `${path}/${entry.name}`;
  return entry.isDirectory() ? allFiles(child) : [child];
});
const approvedDirectories = [
  'docs/production-evidence-plan', 'docs/production-diagnostic-design', 'docs/ddl-resolution-readiness',
  'docs/ddl-resolution-pilot', 'docs/additional-operations-evidence'
];
const P = ['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06', 'P-07', 'P-08', 'P-09', 'P-10'];

export function loadAuditedCandidate() {
  return {
    executionPlan: read('docs/production-evidence-execution-plan/execution-plan.json'),
    coverageMatrix: read('docs/production-evidence-execution-plan/coverage-matrix.json'),
    evidenceCaptureTemplate: read('docs/production-evidence-execution-plan/evidence-capture-template.json'),
    protectedInputManifest: read('docs/production-evidence-execution-plan/protected-input-manifest.json')
  };
}

export function buildIndependentInputs() {
  const matrix = read('docs/production-evidence-plan/evidence-matrix.json');
  const procedures = read('docs/production-evidence-plan/collection-procedures.json');
  const catalog = read('docs/production-diagnostic-design/diagnostic-catalog.json');
  const sections = read('docs/production-diagnostic-design/sql-section-manifest.json');
  const originalProtectedFiles = read('docs/production-diagnostic-design/protected-input-manifest.json').inputs;
  const inventory = read('docs/ddl-resolution-readiness/inventory.json');
  const gaps = read('docs/ddl-resolution-readiness/evidence-gaps.json');
  const additionalEvidence = read('docs/additional-operations-evidence/complete-evidence.json');
  const targetManifest = read('docs/production-diagnostic-design/record-to-target-manifest.json');
  const targetById = Object.fromEntries(targetManifest.bindings.map((binding) => [binding.recordId, binding]));
  const groupRefs = {};
  for (const [ids, records, prefix] of [
    [inventory.mappingIds, inventory.records.mappings, 'mapping'],
    [inventory.additionalOperationIds, inventory.records.additionalOperations, 'additional-operation']
  ]) {
    ids.forEach((id, index) => {
      const recordId = `${prefix}:${id}`;
      const indexes = records[index][2];
      assert.deepEqual(indexes.map((i) => inventory.objectGroups[i][0]), targetById[recordId].objectGroups.map((group) => group.objectGroupId), `object-group identity resolves: ${recordId}`);
      groupRefs[recordId] = indexes.map((i) => `object-group:${i}`);
    });
  }
  const mappingRecords = matrix.records.filter((record) => record.family === 'mapping');
  const operationRecords = matrix.records.filter((record) => record.family === 'additional-operation');
  const expectedMappings = new Set(inventory.mappingIds.map((id) => `mapping:${id}`));
  const expectedOperations = new Set(inventory.additionalOperationIds.map((id) => `additional-operation:${id}`));
  const expectedEvidenceOperations = new Set(additionalEvidence.map((entry) => `additional-operation:${entry.id}`));
  assert.equal(mappingRecords.length, 1435, 'independent matrix mapping count');
  assert.equal(operationRecords.length, 110, 'independent matrix additional-operation count');
  assert.deepEqual(new Set(mappingRecords.map((record) => record.authoritativeRecordId)), expectedMappings, 'inventory mapping IDs reconcile');
  assert.deepEqual(new Set(operationRecords.map((record) => record.authoritativeRecordId)), expectedOperations, 'inventory operation IDs reconcile');
  assert.deepEqual(expectedEvidenceOperations, expectedOperations, 'complete additional-operation evidence reconciles');
  assert.equal(inventory.records.mappings.length, gaps.records.mappings.length, 'readiness gaps mapping partition reconciles');
  assert.equal(inventory.records.additionalOperations.length, gaps.records.additionalOperations.length, 'readiness gaps operation partition reconciles');
  assert.equal(Object.keys(originalProtectedFiles).length, 73, 'original protected baseline is exactly 73');
  const procedureRecordIds = Object.fromEntries(P.map((id) => [id, procedures.procedures[id].exactApplicableRecordIds]));
  for (const procedureId of P) {
    const expected = new Set(matrix.records.filter((record) => record.proposedCollectionProcedureIds.includes(procedureId)).map((record) => record.authoritativeRecordId));
    assert.deepEqual(new Set(procedureRecordIds[procedureId]), expected, `${procedureId} approved procedure set reconciles`);
  }
  const requiredPathInventory = [...new Set([
    ...approvedDirectories.flatMap(allFiles),
    ...Object.keys(originalProtectedFiles),
    'scripts/src/startup-migration-crosswalk.ts',
    'scripts/src/production-startup-ddl-inventory.ts',
    'scripts/src/production-startup-ddl-baseline.json',
    'lib/db/migrations/000001_canonical_schema/migration.sql'
  ])].sort();
  return {
    rootDir, requiredPathInventory, originalProtectedFiles, procedureRecordIds, procedures: procedures.procedures,
    records: Object.fromEntries(matrix.records.map((record) => [record.authoritativeRecordId, {
      ownerNames: record.startupOwners, occurrenceIds: record.relevantOccurrenceIds,
      family: record.family, objectGroupIds: groupRefs[record.authoritativeRecordId],
      requirements: record.missingEvidenceRequirementIds, prerequisites: record.prerequisites
    }])),
    occurrenceIds: [...new Set(matrix.records.flatMap((record) => record.relevantOccurrenceIds))],
    diagnostics: Object.fromEntries(catalog.diagnostics.map((diagnostic) => [diagnostic.diagnosticId, {
      parameterContract: diagnostic.parameterContract, outputSchema: diagnostic.outputSchema
    }])),
    sections: Object.fromEntries(sections.sections.map((section) => [section.diagnosticId, section])),
    reconciled: { inventory: true, gaps: true, additionalEvidence: true, procedures: true }
  };
}

export function runAuditedSuite(validatePackage) {
  const candidate = loadAuditedCandidate();
  const inputs = buildIndependentInputs();
  assert.equal(candidate.evidenceCaptureTemplate.authoritativeStatusRule, 'Capture statuses never alter authoritative UNRESOLVED records.', 'approved authoritative-status rule fixture');
  assert.deepEqual(candidate.evidenceCaptureTemplate.interpretation, {
    PASS: 'Establishes only the stated scoped observed fact.',
    FAIL: 'Never resolves an authoritative record.',
    UNKNOWN: 'Never resolves an authoritative record.'
  }, 'approved interpretation fixture');
  assert.deepEqual(validatePackage(clone(candidate), inputs), { valid: true, records: 1545, diagnostics: 10 });
  const cases = [
    ['N1 original hash mutated', (c) => { c.protectedInputManifest.originalProtectedFiles['scripts/src/startup-migration-crosswalk.ts'] = '0'.repeat(64); }, 'E_PROTECTED_ORIGINAL73_MISMATCH'],
    ['N2 original entry removed', (c) => { delete c.protectedInputManifest.originalProtectedFiles['scripts/src/startup-migration-crosswalk.ts']; }, 'E_PROTECTED_ORIGINAL73_MISMATCH'],
    ['N3 immutable baseline disabled', (c) => { c.protectedInputManifest.immutableBaseline = false; }, 'E_PROTECTED_MANIFEST_INVALID'],
    ['N4 current crosswalk corrupted', (c) => { c.protectedInputManifest.files['scripts/src/startup-migration-crosswalk.ts'] = '0'.repeat(64); }, 'E_PROTECTED_HASH_DRIFT:scripts/src/startup-migration-crosswalk.ts'],
    ['N5 stale historical hash in current tier', (c) => { const p = 'scripts/src/startup-migration-crosswalk.ts'; c.protectedInputManifest.files[p] = c.protectedInputManifest.originalProtectedFiles[p]; }, 'E_PROTECTED_HASH_DRIFT:scripts/src/startup-migration-crosswalk.ts'],
    ['N6 original replaced with current hash', (c) => { const p = 'scripts/src/startup-migration-crosswalk.ts'; c.protectedInputManifest.originalProtectedFiles[p] = c.protectedInputManifest.files[p]; }, 'E_PROTECTED_ORIGINAL73_MISMATCH'],
    ['missing procedure', (c) => c.executionPlan.procedures.splice(2, 1), 'E_PROCEDURE_DUPLICATE_OR_UNKNOWN'],
    ['missing diagnostic', (c) => c.executionPlan.diagnostics.splice(3, 1), 'E_DIAGNOSTIC_DUPLICATE_OR_UNKNOWN'],
    ['wrong record ID', (c) => { c.coverageMatrix.records[0].authoritativeRecordId = 'mapping:not-authoritative'; }, 'E_RECORD_UNKNOWN:mapping:not-authoritative'],
    ['unapproved execution', (c) => { c.executionPlan.executionAllowed = true; }, 'E_EXECUTION_NOT_APPROVED'],
    ['diagnostic execution unapproved', (c) => { c.executionPlan.diagnostics[4].executionAllowed = true; }, 'E_DIAGNOSTIC_EXECUTION_NOT_APPROVED:D-05'],
    ['skipped gate', (c) => c.executionPlan.gates.splice(4, 1), 'E_GATE_CONTRACT_INVALID'],
    ['hollow gate', (c) => { c.executionPlan.gates[0].checks = []; }, 'E_GATE_CONTRACT_INVALID:G-01'],
    ['swapped procedure diagnostic', (c) => { c.executionPlan.procedureToEvidenceToDiagnostic[0].diagnosticId = 'D-02'; }, 'E_PROCEDURE_MAPPING_INVALID'],
    ['P05 automatic bypass', (c) => { c.executionPlan.diagnostics[4].phaseContract.automaticTransition = true; }, 'E_P05_PREFLIGHT_CONTRACT_INVALID'],
    ['P05 phase approval bypass', (c) => { c.executionPlan.diagnostics[4].phaseContract.scan.manualIndependentApprovalRequired = false; }, 'E_P05_PREFLIGHT_APPROVAL_REQUIRED'],
    ['fake production result', (c) => { c.executionPlan.productionFacts.target = 'OBSERVED'; }, 'E_PRODUCTION_CLAIM_NOT_ALLOWED'],
    ['authoritative status rule claims resolution', (c) => { c.evidenceCaptureTemplate.authoritativeStatusRule = 'OBSERVED implies RESOLVED'; }, 'E_AUTHORITATIVE_STATUS_RULE_INVALID'],
    ['authoritative status rule empty', (c) => { c.evidenceCaptureTemplate.authoritativeStatusRule = ''; }, 'E_AUTHORITATIVE_STATUS_RULE_INVALID'],
    ['PASS interpretation claims resolution', (c) => { c.evidenceCaptureTemplate.interpretation.PASS = 'Resolves the authoritative record.'; }, 'E_INTERPRETATION_INVALID:PASS'],
    ['FAIL interpretation claims resolution', (c) => { c.evidenceCaptureTemplate.interpretation.FAIL = 'Resolves the authoritative record.'; }, 'E_INTERPRETATION_INVALID:FAIL'],
    ['invalid evidence status', (c) => { c.evidenceCaptureTemplate.evidenceStatuses[0] = 'PASS'; }, 'E_TEMPLATE_CONTRACT_INVALID'],
    ['missing abort policy', (c) => { c.executionPlan.failurePolicy.causes = []; }, 'E_ABORT_PROCEDURE_MISSING'],
    ['inconsistent envelope limit', (c) => { c.executionPlan.executionEnvelope.lockTimeoutMs = 999; }, 'E_ENVELOPE_LIMITS_INVALID'],
    ['duplicate record', (c) => c.coverageMatrix.records.push(clone(c.coverageMatrix.records[0])), `E_RECORD_DUPLICATE:${candidate.coverageMatrix.records[0].authoritativeRecordId}`],
    ['orphan record', (c) => c.coverageMatrix.records.pop(), 'E_RECORD_SET_MISMATCH'],
    ['owner mismatch', (c) => { c.coverageMatrix.records[0].ownerNames = ['forged-owner']; }, `E_OWNER_MISMATCH:${candidate.coverageMatrix.records[0].authoritativeRecordId}`],
    ['occurrence mismatch', (c) => { c.coverageMatrix.records[0].occurrenceIds = []; }, `E_OCCURRENCE_MISMATCH:${candidate.coverageMatrix.records[0].authoritativeRecordId}`],
    ['protected hash drift', (c) => { c.protectedInputManifest.files['scripts/src/startup-migration-crosswalk.ts'] = '0'.repeat(64); }, 'E_PROTECTED_HASH_DRIFT:scripts/src/startup-migration-crosswalk.ts'],
    ['D06 noSQL', (c) => { c.executionPlan.diagnostics[5].statementLimitRows = 1; }, 'E_DIAGNOSTIC_CAP_INVALID:D-06'],
    ['unapproved result field', (c) => c.executionPlan.diagnostics[0].outputSchema.push({ columnName: 'forged', postgresType: 'text', nullable: true }), 'E_DIAGNOSTIC_CONTRACT_MISMATCH:D-01'],
    ['missing approval', (c) => { delete c.executionPlan.approvals.systemOwner; }, 'E_APPROVAL_STATUS_INVALID'],
    ['missing timestamp contract', (c) => c.evidenceCaptureTemplate.requiredFields.splice(c.evidenceCaptureTemplate.requiredFields.indexOf('capturedAt'), 1), 'E_TEMPLATE_CONTRACT_INVALID'],
    ['missing parameter contract', (c) => { delete c.evidenceCaptureTemplate.fieldContracts.parameters; }, 'E_TEMPLATE_CONTRACT_INVALID'],
    ['missing status contract', (c) => { delete c.evidenceCaptureTemplate.fieldContracts.evidenceStatus; }, 'E_TEMPLATE_CONTRACT_INVALID'],
    ['missing hash contract', (c) => { delete c.evidenceCaptureTemplate.fieldContracts.evidenceHash; }, 'E_TEMPLATE_CONTRACT_INVALID'],
    ['reordered stage', (c) => ([c.executionPlan.stages[1], c.executionPlan.stages[2]] = [c.executionPlan.stages[2], c.executionPlan.stages[1]]), 'E_STAGE_ORDER_INVALID:stage-1'],
    ['dependency omission', (c) => c.executionPlan.requiredSourceEdges.pop(), 'E_DEPENDENCY_LINKS_INVALID'],
    ['wrong stage diagnostic', (c) => { c.executionPlan.stages[1].diagnostics[0] = 'D-05'; }, 'E_STAGE_DIAGNOSTICS_INVALID:stage-1'],
    ['forged procedure result', (c) => { c.executionPlan.procedures[0].observedResult = 'success'; }, 'E_PROCEDURE_FIELD_INVALID:P-01'],
    ['procedure approval prose weakened', (c) => { c.executionPlan.procedures[0].approvalGate = 'No approval needed'; }, 'E_PROCEDURE_SOURCE_DRIFT:P-01:approvalGate'],
    ['P05 fixed target weakened', (c) => { c.executionPlan.diagnostics[4].phaseContract.scan.fixedTarget = 'public.users'; }, 'E_P05_FIXED_PHASE_CONTRACT_INVALID'],
    ['P05 inner cap broadened', (c) => { c.executionPlan.diagnostics[4].phaseContract.scan.innerSampleRowCap = 2000; }, 'E_P05_FIXED_PHASE_CONTRACT_INVALID'],
    ['D08 row cap broadened', (c) => { c.executionPlan.diagnostics[7].statementLimitRows = 1000; }, 'E_DIAGNOSTIC_CAP_INVALID:D-08'],
    ['automatic retry policy removed', (c) => { c.executionPlan.executionEnvelope.retryRequires = []; }, 'E_ENVELOPE_SAFETY_POLICY_INVALID'],
    ['contradictory abort instruction', (c) => { c.executionPlan.failurePolicy.action += '; but repair automatically now'; }, 'E_ABORT_ACTION_INVALID'],
    ['evidence validation status confused', (c) => { c.evidenceCaptureTemplate.fieldContracts.validationStatus.enum = ['OBSERVED']; }, 'E_TEMPLATE_FIELD_POLICY_INVALID'],
    ['capture time type weakened', (c) => { c.evidenceCaptureTemplate.fieldContracts.capturedAt = {}; }, 'E_TEMPLATE_FIELD_POLICY_INVALID'],
    ['forged capture contents', (c) => { c.evidenceCaptureTemplate.emptyCapture.result = { observed: true }; }, 'E_TEMPLATE_CONTRACT_INVALID'],
    ['protected path removed from both lists', (c) => {
      const path = 'scripts/src/startup-migration-crosswalk.ts';
      c.protectedInputManifest.requiredPathInventory = c.protectedInputManifest.requiredPathInventory.filter((item) => item !== path);
      delete c.protectedInputManifest.files[path];
    }, 'E_PROTECTED_PATH_INVENTORY_MISMATCH'],
    ['read-only precondition removed', (c) => { c.executionPlan.executionEnvelope.transactionReadOnlyRequiredBeforeEveryStatement = false; }, 'E_ENVELOPE_LIMITS_INVALID'],
    ['restore gate skipped before metadata', (c) => { c.executionPlan.stages[1].gateIds = c.executionPlan.stages[1].gateIds.filter((gate) => gate !== 'G-09'); }, 'E_STAGE_ORDER_INVALID:stage-1'],
    ['authoritative status changed', (c) => { c.coverageMatrix.records[0].authoritativeStatus = 'RESOLVED'; }, `E_RECORD_STATUS_INVALID:${candidate.coverageMatrix.records[0].authoritativeRecordId}`]
    ,['coverage authoritative status changed', (c) => { c.coverageMatrix.authoritativeStatus = 'RESOLVED'; }, 'E_COVERAGE_STATUS_INVALID']
  ];
  for (const cause of candidate.executionPlan.failurePolicy.causes) {
    cases.push([`missing failure cause ${cause}`, (c) => c.executionPlan.failurePolicy.causes.splice(c.executionPlan.failurePolicy.causes.indexOf(cause), 1), 'E_ABORT_PROCEDURE_MISSING']);
  }
  for (const [name, mutate, message] of cases) {
    const fixture = clone(candidate);
    const before = JSON.stringify(fixture);
    mutate(fixture);
    assert.notEqual(JSON.stringify(fixture), before, `${name}: fixture mutation must occur`);
    assert.throws(() => validatePackage(fixture, inputs), { message }, name);
  }
  return { negativeTests: cases.length, rejections: cases.map(([name, , message]) => ({ name, message })) };
}