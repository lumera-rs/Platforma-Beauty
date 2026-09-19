import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=process.cwd(), clone=structuredClone;
const load=()=>JSON.parse(readFileSync(join(root,'docs/production-evidence-collection-checklist/evidence-register.json'),'utf8'));
const loadMatrix=()=>JSON.parse(readFileSync(join(root,'docs/production-pre-access-readiness/readiness-matrix.json'),'utf8'));

export function runSuite(validateRegister,supplied){
  const candidate=supplied??load(), matrix=loadMatrix();
  const validate=(register,readinessMatrix=matrix)=>validateRegister(register,{readinessMatrix});
  assert.deepEqual(validate(clone(candidate),clone(matrix)),{valid:true,evidence:32,conditions:32,globalReadiness:'BLOCKED'});
  const cases=[
    ['condition omitted',c=>c.evidence.pop(),'E_CONDITION_COVERAGE_INVALID'],
    ['duplicate evidence ID',c=>c.evidence[1].evidenceId=c.evidence[0].evidenceId,'E_EVIDENCE_ID_SET_INVALID'],
    ['wrong evidence link',c=>c.evidence.find(x=>x.conditionId==='AUTH-03').evidenceId='EV-AUTH-02','E_EVIDENCE_ID_SET_INVALID'],
    ['approval weakened',c=>c.evidence.find(x=>x.conditionId==='AUTH-03').requiredApproval='A','E_APPROVAL_DRIFT:AUTH-03'],
    ['all approvals weakened',c=>c.evidence.forEach(x=>x.requiredApproval='A'),'E_APPROVAL_DRIFT:ENV-01'],
    ['unknown approval',c=>c.evidence[0].requiredApproval='I','E_APPROVAL_CLASS_INVALID:ENV-01'],
    ['missing approval',c=>delete c.evidence[0].requiredApproval,'E_EVIDENCE_FIELD_INVALID:EV-ENV-01'],
    ['fake authorization',c=>{c.authorizedActivities.push('C');c.notAuthorizedActivities=c.notAuthorizedActivities.filter(x=>x!=='C');},'E_AUTHORIZATION_INVALID'],
    ['fake global readiness',c=>c.globalReadiness='READY','E_GLOBAL_READINESS_INVALID'],
    ['fake resolution',c=>c.authoritativeRecordStatus='RESOLVED','E_AUTHORITATIVE_BOUNDARY_INVALID'],
    ['fake production fact',c=>c.productionFacts='VERIFIED','E_AUTHORITATIVE_BOUNDARY_INVALID'],
    ['missing purpose',c=>c.evidence[0].purpose='','E_EVIDENCE_CONTENT_MISSING:EV-ENV-01'],
    ['submitted result field',c=>c.evidence[0].observedResult='success','E_EVIDENCE_FIELD_INVALID:EV-ENV-01'],
    ['restore acceptance weakened',c=>c.evidence.find(x=>x.evidenceId==='EV-BKP-04').acceptanceCriteria='backup is enabled','E_ACCEPTANCE_CRITERIA_DRIFT:EV-BKP-04'],
    ['restore acquisition weakened',c=>c.evidence.find(x=>x.evidenceId==='EV-BKP-04').acquisitionMethod='development restore','E_ACQUISITION_METHOD_DRIFT:EV-BKP-04'],
    ['maintenance acceptance weakened',c=>c.evidence.find(x=>x.evidenceId==='EV-TOP-05').acceptanceCriteria='maintenance design is documented','E_ACCEPTANCE_CRITERIA_DRIFT:EV-TOP-05'],
    ['grant acceptance weakened',c=>c.evidence.find(x=>x.evidenceId==='EV-DB-02').acceptanceCriteria='a role definition was proposed','E_ACCEPTANCE_CRITERIA_DRIFT:EV-DB-02'],
    ['monitor acceptance weakened',c=>c.evidence.find(x=>x.evidenceId==='EV-OPS-03').acceptanceCriteria='monitoring is configured','E_ACCEPTANCE_CRITERIA_DRIFT:EV-OPS-03'],
    ['threshold acceptance weakened',c=>c.evidence.find(x=>x.evidenceId==='EV-OPS-04').acceptanceCriteria='CPU below 80 percent','E_ACCEPTANCE_CRITERIA_DRIFT:EV-OPS-04'],
    ['target freshness removed',c=>c.evidence.find(x=>x.evidenceId==='EV-ENV-02').freshnessRule='never expires','E_FRESHNESS_RULE_DRIFT:EV-ENV-02'],
    ['scan auto-promoted',c=>c.evidence.find(x=>x.evidenceId==='EV-AUTH-04').acceptanceCriteria='SCAN may follow PREFLIGHT automatically','E_ACCEPTANCE_CRITERIA_DRIFT:EV-AUTH-04'],
    ['all acceptance criteria weakened',c=>c.evidence.forEach(x=>x.acceptanceCriteria='x'),'E_ACCEPTANCE_CRITERIA_DRIFT:EV-ENV-02'],
    ['multiple protected fields weakened',c=>{const x=c.evidence.find(x=>x.evidenceId==='EV-BKP-05');x.acceptanceCriteria='backup exists';x.freshnessRule='never expires';},'E_ACCEPTANCE_CRITERIA_DRIFT:EV-BKP-05'],
    ['unlisted evidence criteria weakened',c=>c.evidence.find(x=>x.evidenceId==='EV-ENV-01').acceptanceCriteria='x','E_PROTECTED_EVIDENCE_FIELDS_DRIFT'],
    ['postgres credential string',c=>c.evidence[0].title='postgres://user:pw@host:5432/db','E_SECRET_VALUE_DETECTED'],
    ['password assignment',c=>c.evidence[1].purpose='password=hunter2','E_SECRET_VALUE_DETECTED'],
    ['private key block',c=>c.evidence[2].evidenceSource='-----BEGIN RSA PRIVATE KEY-----','E_SECRET_VALUE_DETECTED']
  ];
  for(const [name,mutate,error] of cases){const c=clone(candidate),before=JSON.stringify(c);mutate(c);assert.notEqual(JSON.stringify(c),before,`${name}: mutation required`);assert.throws(()=>validate(c,clone(matrix)),{message:error},name);}
  const matrixCases=[
    ['readiness condition changed',(r,m)=>m.conditions[0].id='ENV-99','E_READINESS_CONDITION_DRIFT'],
    ['readiness approval changed',(r,m)=>m.conditions.find(x=>x.id==='AUTH-03').requiredApproval='A','E_READINESS_APPROVAL_DRIFT:AUTH-03'],
    ['register and matrix approval weakened',(r,m)=>{r.evidence.find(x=>x.conditionId==='AUTH-03').requiredApproval='A';m.conditions.find(x=>x.id==='AUTH-03').requiredApproval='A';},'E_READINESS_APPROVAL_DRIFT:AUTH-03']
  ];
  for(const [name,mutate,error] of matrixCases){const c=clone(candidate),m=clone(matrix),before=JSON.stringify([c,m]);mutate(c,m);assert.notEqual(JSON.stringify([c,m]),before,`${name}: mutation required`);assert.throws(()=>validate(c,m),{message:error},name);}
  return {negativeTests:cases.length+matrixCases.length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const {validateRegister}=await import('../validate.mjs');const r=runSuite(validateRegister);console.log(`validation.test.mjs: baseline valid; 32 evidence definitions cover 32 conditions; ${r.negativeTests} exact-error negative fixtures rejected.`);}