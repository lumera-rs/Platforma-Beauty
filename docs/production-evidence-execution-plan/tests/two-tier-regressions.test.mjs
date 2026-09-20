import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validatePackage as executionValidate } from '../validate.mjs';
import { loadAuditedCandidate, buildIndependentInputs } from './validation-fixtures.mjs';
import { validatePackage as diagnosticValidate } from '../../production-diagnostic-design/validate.mjs';

const root = new URL('../../', import.meta.url);
const text = path => fs.readFileSync(new URL(path, root), 'utf8');
const json = path => JSON.parse(text(path));
const dir = 'production-diagnostic-design/';
const execution = loadAuditedCandidate();
const inputs = buildIndependentInputs();
const diagnostic = {
  catalog: json(dir + 'diagnostic-catalog.json'), coverage: json(dir + 'coverage-matrix.json'),
  procedures: json('production-evidence-plan/collection-procedures.json'),
  matrix: json('production-evidence-plan/evidence-matrix.json'),
  inventory: json('ddl-resolution-readiness/inventory.json'),
  additionalEvidence: json('additional-operations-evidence/complete-evidence.json'),
  manifest: json(dir + 'protected-input-manifest.json'),
  sectionManifest: json(dir + 'sql-section-manifest.json'),
  recordManifest: json(dir + 'record-to-target-manifest.json'),
  sql: text(dir + 'diagnostic-queries.sql'), blockedEvidence: text(dir + 'blocked-evidence.md'),
  readme: text(dir + 'README.md'), executionSafety: text(dir + 'execution-safety.md'),
  verification: text(dir + 'verification.md'),
};
const protectedPath = 'scripts/src/startup-migration-crosswalk.ts';
const ev = candidate => executionValidate(candidate, inputs);
const dv = candidate => diagnosticValidate({}, candidate);

test('both two-tier documentation baselines validate', () => {
  ev(execution);
  assert.equal(dv(diagnostic), true);
});

function reject(name, baseline, validate, mutate, expected) {
  test(name, () => {
    const candidate = structuredClone(baseline);
    mutate(candidate);
    assert.notDeepEqual(candidate, baseline, 'mutation must be observed');
    assert.throws(() => validate(candidate), error => error.message === expected);
  });
}

reject('N1: reject historical hash change', execution, ev, c => { c.protectedInputManifest.originalProtectedFiles[protectedPath] = '0'.repeat(64); }, 'E_PROTECTED_ORIGINAL73_MISMATCH');
reject('N2: reject historical path deletion', execution, ev, c => { delete c.protectedInputManifest.originalProtectedFiles[protectedPath]; }, 'E_PROTECTED_ORIGINAL73_MISMATCH');
reject('N3: require immutable baseline', execution, ev, c => { c.protectedInputManifest.immutableBaseline = false; }, 'E_PROTECTED_MANIFEST_INVALID');
reject('N4: reject current hash change', execution, ev, c => { c.protectedInputManifest.files[protectedPath] = '0'.repeat(64); }, `E_PROTECTED_HASH_DRIFT:${protectedPath}`);
reject('N5: reject stale current hash', execution, ev, c => { c.protectedInputManifest.files[protectedPath] = c.protectedInputManifest.originalProtectedFiles[protectedPath]; }, `E_PROTECTED_HASH_DRIFT:${protectedPath}`);
reject('N6: reject replacing historical with current hash', execution, ev, c => { c.protectedInputManifest.originalProtectedFiles[protectedPath] = c.protectedInputManifest.files[protectedPath]; }, 'E_PROTECTED_ORIGINAL73_MISMATCH');
reject('N7: reject diagnostic current path deletion', diagnostic, dv, c => { delete c.manifest.currentInputs[protectedPath]; }, 'protected-path inventory mismatch');
reject('N8: reject diagnostic historical hash change', diagnostic, dv, c => { c.manifest.inputs[protectedPath] = '0'.repeat(64); }, 'historical baseline drift');
reject('separate currentInputs drift', diagnostic, dv, c => { c.manifest.currentInputs[protectedPath] = '0'.repeat(64); }, `protected hash drift: ${protectedPath}`);
reject('coordinated historical and current deletion', diagnostic, dv, c => { delete c.manifest.inputs[protectedPath]; delete c.manifest.currentInputs[protectedPath]; }, 'historical baseline drift');
const forgedInputs = structuredClone(inputs);
forgedInputs.originalProtectedFiles[protectedPath] = '0'.repeat(64);
reject('coordinated original and caller tamper', execution, c => executionValidate(c, forgedInputs), c => {
  c.protectedInputManifest.originalProtectedFiles[protectedPath] = '0'.repeat(64);
}, 'E_PROTECTED_ORIGINAL73_MISMATCH');