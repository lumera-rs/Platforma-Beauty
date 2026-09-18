import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const clone = (value) => structuredClone(value);
const packagePath = 'docs/production-pre-access-readiness/readiness-matrix.json';

export function runSuite(validateReadiness, supplied) {
  const candidate = supplied ?? JSON.parse(readFileSync(join(root, packagePath), 'utf8'));
  assert.deepEqual(Object.fromEntries(candidate.conditions.map((item) => [item.id, item.requiredApproval])), {
    'ENV-01':'B','ENV-02':'B','ENV-03':'B','ENV-04':'B',
    'DB-01':'C','DB-02':'C','DB-03':'C','DB-04':'D','DB-05':'D','DB-06':'D','DB-07':'D','DB-08':'D',
    'TOP-01':'B','TOP-02':'B','TOP-03':'B','TOP-04':'B','TOP-05':'D',
    'BKP-01':'B','BKP-02':'B','BKP-03':'B','BKP-04':'B','BKP-05':'B',
    'OPS-01':'B','OPS-02':'D','OPS-03':'D','OPS-04':'D','OPS-05':'D',
    'AUTH-01':'A','AUTH-02':'B','AUTH-03':'C','AUTH-04':'E','STATUS-01':'A'
  }, 'positive fixture retains all 32 approved approval classes');
  assert.deepEqual(validateReadiness(clone(candidate)), { valid: true, globalStatus: 'BLOCKED', conditions: 32 }, 'original approved matrix passes');
  const cases = [
    ['AUTH-03 approval weakened C to A', (c) => { c.conditions.find((x) => x.id === 'AUTH-03').requiredApproval = 'A'; }, 'E_REQUIRED_APPROVAL_DRIFT:AUTH-03'],
    ['AUTH-04 approval weakened E to A', (c) => { c.conditions.find((x) => x.id === 'AUTH-04').requiredApproval = 'A'; }, 'E_REQUIRED_APPROVAL_DRIFT:AUTH-04'],
    ['all 32 approvals assigned A', (c) => { c.conditions.forEach((x) => { x.requiredApproval = 'A'; }); }, 'E_REQUIRED_APPROVAL_DRIFT:ENV-01'],
    ['unknown approval class', (c) => { c.conditions.find((x) => x.id === 'AUTH-03').requiredApproval = 'I'; }, 'E_REQUIRED_APPROVAL_INVALID:AUTH-03'],
    ['missing requiredApproval', (c) => { delete c.conditions.find((x) => x.id === 'AUTH-03').requiredApproval; }, 'E_CONDITION_FIELD_INVALID:AUTH-03'],
    ['global ready claim', (c) => { c.globalStatus = 'VERIFIED'; }, 'E_GLOBAL_STATUS_INVALID'],
    ['authoritative resolution claim', (c) => { c.authoritativeRecordStatus = 'RESOLVED'; }, 'E_AUTHORITATIVE_STATUS_INVALID'],
    ['production fact claim', (c) => { c.productionFacts = 'VERIFIED'; }, 'E_AUTHORITATIVE_STATUS_INVALID'],
    ['production access authorized', (c) => { c.authorizedActivities.push('C'); c.notAuthorizedActivities = c.notAuthorizedActivities.filter((id) => id !== 'C'); }, 'E_AUTHORIZATION_INVALID'],
    ['documented status promoted', (c) => { c.conditions.find((x) => x.id === 'DB-02').status = 'VERIFIED'; }, 'E_CONDITION_STATUS_DRIFT:DB-02'],
    ['restore promoted', (c) => { c.conditions.find((x) => x.id === 'BKP-04').status = 'VERIFIED'; }, 'E_CONDITION_STATUS_DRIFT:BKP-04'],
    ['maintenance promoted', (c) => { c.conditions.find((x) => x.id === 'TOP-05').status = 'VERIFIED'; }, 'E_CONDITION_STATUS_DRIFT:TOP-05'],
    ['condition missing', (c) => { c.conditions.pop(); }, 'E_CONDITION_SET_INVALID'],
    ['invalid status', (c) => { c.conditions[0].status = 'READY'; }, `E_CONDITION_STATUS_INVALID:${candidate.conditions[0].id}`],
    ['missing source', (c) => { c.conditions[0].sourceEvidence = []; }, `E_SOURCE_REFERENCE_INVALID:${candidate.conditions[0].id}`],
    ['unknown source path', (c) => { c.conditions[0].sourceEvidence = ['does/not/exist']; }, `E_SOURCE_REFERENCE_INVALID:${candidate.conditions[0].id}`],
    ['secret value', (c) => { c.conditions[0].missingEvidence = 'password=\"do-not-store\"'; }, 'E_SECRET_VALUE_DETECTED']
  ];
  for (const [name, mutate, expected] of cases) {
    const fixture = clone(candidate);
    const before = JSON.stringify(fixture);
    mutate(fixture);
    assert.notEqual(JSON.stringify(fixture), before, `${name}: mutation required`);
    assert.throws(() => validateReadiness(fixture), { message: expected }, name);
  }
  return { negativeTests: cases.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { validateReadiness } = await import('../validate.mjs');
  const result = runSuite(validateReadiness);
  console.log(`validation.test.mjs: baseline valid; ${result.negativeTests} exact-error negative fixtures rejected.`);
}