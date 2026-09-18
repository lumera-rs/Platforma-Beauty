import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=process.cwd(),clone=structuredClone,load=p=>JSON.parse(readFileSync(join(root,p),'utf8'));

export function runSuite(validate,candidate,evidence,matrix){
  assert.deepEqual(validate(clone(candidate),clone(evidence),clone(matrix)),{valid:true,requests:32,status:'NOT_COLLECTED',globalReadiness:'BLOCKED'});
  const cases=[
    ['request omitted',(c)=>c.requests.pop(),'E_CONDITION_SET_INVALID'],
    ['condition duplicated',(c)=>c.requests[1].conditionId=c.requests[0].conditionId,'E_CONDITION_SET_INVALID'],
    ['evidence duplicated',(c)=>c.requests[1].evidenceId=c.requests[0].evidenceId,'E_EVIDENCE_SET_INVALID'],
    ['evidence link changed',(c)=>c.requests.find(x=>x.conditionId==='AUTH-03').evidenceId='EV-AUTH-02','E_EVIDENCE_SET_INVALID'],
    ['approval weakened',(c)=>c.requests.find(x=>x.conditionId==='AUTH-03').requiredApproval='A','E_APPROVAL_DRIFT:AUTH-03'],
    ['all approvals weakened',(c)=>c.requests.forEach(x=>x.requiredApproval='A'),'E_APPROVAL_DRIFT:ENV-01'],
    ['collection forged',(c)=>c.requests[0].status='COLLECTED','E_FALSE_COLLECTION_STATUS:EV-ENV-01'],
    ['approval forged',(c)=>{c.authorizedActivities.push('B');c.notAuthorizedActivities=c.notAuthorizedActivities.filter(x=>x!=='B');},'E_AUTHORIZATION_INVALID'],
    ['global ready forged',(c)=>c.globalReadiness='READY','E_READINESS_INVALID'],
    ['restore ready forged',(c)=>c.restoreReadiness='READY','E_READINESS_INVALID'],
    ['maintenance ready forged',(c)=>c.maintenanceReadiness='READY','E_READINESS_INVALID'],
    ['acceptance weakened',(c)=>c.requests.find(x=>x.evidenceId==='EV-BKP-04').acceptanceCriteria='backup enabled','E_REQUEST_RULE_DRIFT:EV-BKP-04'],
    ['freshness weakened',(c)=>c.requests.find(x=>x.evidenceId==='EV-TOP-05').freshnessRule='never expires','E_REQUEST_RULE_DRIFT:EV-TOP-05'],
    ['responsibility changed',(c)=>c.requests.find(x=>x.evidenceId==='EV-DB-02').responsibleRole='requester','E_REQUEST_RULE_DRIFT:EV-DB-02'],
    ['submitted result field',(c)=>c.requests[0].observedResult='success','E_REQUEST_FIELD_INVALID:EV-ENV-01'],
    ['missing secure submission',(c)=>c.requests[0].secureSubmission='','E_REQUEST_CONTENT_MISSING:EV-ENV-01'],
    ['credential string',(c)=>c.requests[0].prerequisites='postgres://user:pw@host/db','E_SECRET_VALUE_DETECTED'],
    ['password assignment',(c)=>c.requests[1].secureSubmission='password=hunter2','E_SECRET_VALUE_DETECTED'],
    ['private key',(c)=>c.requests[2].requiredEvidence='-----BEGIN RSA PRIVATE KEY-----','E_SECRET_VALUE_DETECTED']
  ];
  for(const [name,mutate,error] of cases){const c=clone(candidate),before=JSON.stringify(c);mutate(c);assert.notEqual(JSON.stringify(c),before,`${name}: mutation required`);assert.throws(()=>validate(c,clone(evidence),clone(matrix)),{message:error},name);}
  const sourceCases=[
    ['register source weakened',(e,m)=>e.evidence.find(x=>x.evidenceId==='EV-BKP-04').acceptanceCriteria='backup enabled','E_REQUEST_RULE_DRIFT:EV-BKP-04'],
    ['matrix approval weakened',(e,m)=>m.conditions.find(x=>x.id==='AUTH-03').requiredApproval='A','E_APPROVED_SOURCE_MISMATCH:AUTH-03'],
    ['both sources weakened',(e,m)=>{e.evidence.find(x=>x.evidenceId==='EV-AUTH-03').requiredApproval='A';m.conditions.find(x=>x.id==='AUTH-03').requiredApproval='A';},'E_APPROVED_SOURCE_MISMATCH:AUTH-03']
  ];
  for(const [name,mutate,error] of sourceCases){const e=clone(evidence),m=clone(matrix),before=JSON.stringify([e,m]);mutate(e,m);assert.notEqual(JSON.stringify([e,m]),before,`${name}: mutation required`);assert.throws(()=>validate(clone(candidate),e,m),{message:error},name);}
  const c=clone(candidate),e=clone(evidence),before=JSON.stringify([c,e]);
  c.requests.find(x=>x.evidenceId==='EV-BKP-04').acceptanceCriteria='backup enabled';
  e.evidence.find(x=>x.evidenceId==='EV-BKP-04').acceptanceCriteria='backup enabled';
  assert.notEqual(JSON.stringify([c,e]),before,'candidate and source weakening: mutation required');
  assert.throws(()=>validate(c,e,clone(matrix)),{message:'E_REQUEST_POLICY_DRIFT'},'candidate and source weakening');
  return {negativeTests:cases.length+sourceCases.length+1};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const {validateHandoff}=await import('../validate.mjs');
  const result=runSuite(validateHandoff,load('docs/production-evidence-handoff/evidence-request-register.json'),load('docs/production-evidence-collection-checklist/evidence-register.json'),load('docs/production-pre-access-readiness/readiness-matrix.json'));
  console.log(`validation.test.mjs: baseline valid; 32 handoff requests remain NOT_COLLECTED; ${result.negativeTests} exact-error negative fixtures rejected.`);
}
