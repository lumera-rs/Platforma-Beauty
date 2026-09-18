import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const allowedStatuses = ['VERIFIED', 'DOCUMENTED_ONLY', 'UNKNOWN', 'BLOCKED'];
const expectedIds = [
  'ENV-01','ENV-02','ENV-03','ENV-04','DB-01','DB-02','DB-03','DB-04','DB-05','DB-06','DB-07','DB-08',
  'TOP-01','TOP-02','TOP-03','TOP-04','TOP-05','BKP-01','BKP-02','BKP-03','BKP-04','BKP-05',
  'OPS-01','OPS-02','OPS-03','OPS-04','OPS-05','AUTH-01','AUTH-02','AUTH-03','AUTH-04','STATUS-01'
];
const expectedStatuses = {
  'ENV-01':'VERIFIED','ENV-02':'BLOCKED','ENV-03':'UNKNOWN','ENV-04':'UNKNOWN',
  'DB-01':'UNKNOWN','DB-02':'DOCUMENTED_ONLY','DB-03':'DOCUMENTED_ONLY','DB-04':'DOCUMENTED_ONLY',
  'DB-05':'DOCUMENTED_ONLY','DB-06':'DOCUMENTED_ONLY','DB-07':'DOCUMENTED_ONLY','DB-08':'DOCUMENTED_ONLY',
  'TOP-01':'VERIFIED','TOP-02':'UNKNOWN','TOP-03':'UNKNOWN','TOP-04':'UNKNOWN','TOP-05':'BLOCKED',
  'BKP-01':'UNKNOWN','BKP-02':'UNKNOWN','BKP-03':'UNKNOWN','BKP-04':'BLOCKED','BKP-05':'UNKNOWN',
  'OPS-01':'UNKNOWN','OPS-02':'VERIFIED','OPS-03':'UNKNOWN','OPS-04':'UNKNOWN','OPS-05':'UNKNOWN',
  'AUTH-01':'VERIFIED','AUTH-02':'BLOCKED','AUTH-03':'BLOCKED','AUTH-04':'BLOCKED','STATUS-01':'VERIFIED'
};
// Independently pinned to the approved matrix; never derived from a candidate.
const expectedApprovals = {
  'ENV-01':'B','ENV-02':'B','ENV-03':'B','ENV-04':'B',
  'DB-01':'C','DB-02':'C','DB-03':'C','DB-04':'D','DB-05':'D','DB-06':'D','DB-07':'D','DB-08':'D',
  'TOP-01':'B','TOP-02':'B','TOP-03':'B','TOP-04':'B','TOP-05':'D',
  'BKP-01':'B','BKP-02':'B','BKP-03':'B','BKP-04':'B','BKP-05':'B',
  'OPS-01':'B','OPS-02':'D','OPS-03':'D','OPS-04':'D','OPS-05':'D',
  'AUTH-01':'A','AUTH-02':'B','AUTH-03':'C','AUTH-04':'E','STATUS-01':'A'
};
const exactKeys = (value, keys, code) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      Object.keys(value).some((key) => !keys.includes(key))) throw new Error(code);
};
const sameSet = (actual, expected) =>
  Array.isArray(actual) && actual.length === new Set(actual).size &&
  actual.length === expected.length && actual.every((item) => expected.includes(item));
const stringValues = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringValues);
  return [];
};

export function validateReadiness(matrix, options = {}) {
  exactKeys(matrix, ['schemaVersion','document','planningOnly','globalStatus','authoritativeRecordStatus','productionFacts','authorizedActivities','notAuthorizedActivities','statusVocabulary','conditions'], 'E_MATRIX_FIELD_INVALID');
  if (matrix.planningOnly !== true) throw new Error('E_NOT_PREPARATION');
  if (matrix.globalStatus !== 'BLOCKED') throw new Error('E_GLOBAL_STATUS_INVALID');
  if (matrix.authoritativeRecordStatus !== 'UNRESOLVED' || matrix.productionFacts !== 'UNKNOWN') throw new Error('E_AUTHORITATIVE_STATUS_INVALID');
  if (!sameSet(matrix.authorizedActivities, ['A']) || !sameSet(matrix.notAuthorizedActivities, ['B','C','D','E','F','G','H'])) throw new Error('E_AUTHORIZATION_INVALID');
  if (!sameSet(matrix.statusVocabulary, allowedStatuses)) throw new Error('E_STATUS_VOCABULARY_INVALID');
  if (!Array.isArray(matrix.conditions) || !sameSet(matrix.conditions.map((item) => item.id), expectedIds)) throw new Error('E_CONDITION_SET_INVALID');
  for (const item of matrix.conditions) {
    exactKeys(item, ['id','description','sourceEvidence','status','responsibleRole','missingEvidence','failureConsequence','requiredApproval'], `E_CONDITION_FIELD_INVALID:${item.id}`);
    if (!allowedStatuses.includes(item.status)) throw new Error(`E_CONDITION_STATUS_INVALID:${item.id}`);
    if (item.status !== expectedStatuses[item.id]) throw new Error(`E_CONDITION_STATUS_DRIFT:${item.id}`);
    if (!Array.isArray(item.sourceEvidence) || item.sourceEvidence.length === 0) throw new Error(`E_SOURCE_REFERENCE_INVALID:${item.id}`);
    for (const path of item.sourceEvidence) {
      const present = options.existingPaths ? options.existingPaths.has(path) : existsSync(join(root, path));
      if (!present) throw new Error(`E_SOURCE_REFERENCE_INVALID:${item.id}`);
    }
    if (!['A','B','C','D','E','F','G','H'].includes(item.requiredApproval)) throw new Error(`E_REQUIRED_APPROVAL_INVALID:${item.id}`);
    if (item.requiredApproval !== expectedApprovals[item.id]) throw new Error(`E_REQUIRED_APPROVAL_DRIFT:${item.id}`);
  }
  for (const id of ['TOP-05','BKP-04','AUTH-02','AUTH-03','AUTH-04']) {
    if (matrix.conditions.find((item) => item.id === id)?.status !== 'BLOCKED') throw new Error(`E_MANDATORY_BLOCKER_INVALID:${id}`);
  }
  const secretValuePatterns = [
    /postgres(?:ql)?:\/\/[^"\s]+:[^"\s]+@/i,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
    /(?:api[_-]?key|token|password|secret)\s*[=:]\s*["']?[^"'\s]+/i
  ];
  if (stringValues(matrix).some((value) => secretValuePatterns.some((pattern) => pattern.test(value)))) throw new Error('E_SECRET_VALUE_DETECTED');
  return { valid: true, globalStatus: 'BLOCKED', conditions: expectedIds.length };
}

function load() {
  return JSON.parse(readFileSync(join(root, 'docs/production-pre-access-readiness/readiness-matrix.json'), 'utf8'));
}

if (process.argv[1]?.endsWith('/validate.mjs')) {
  const { runSuite } = await import('./tests/validation.test.mjs');
  const result = runSuite(validateReadiness, load());
  console.log(`validate.mjs: baseline valid; ${result.negativeTests} exact-error negative fixtures rejected.`);
}