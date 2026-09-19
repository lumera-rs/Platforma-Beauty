import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root=process.cwd();
const ids=['ENV-01','ENV-02','ENV-03','ENV-04','DB-01','DB-02','DB-03','DB-04','DB-05','DB-06','DB-07','DB-08','TOP-01','TOP-02','TOP-03','TOP-04','TOP-05','BKP-01','BKP-02','BKP-03','BKP-04','BKP-05','OPS-01','OPS-02','OPS-03','OPS-04','OPS-05','AUTH-01','AUTH-02','AUTH-03','AUTH-04','STATUS-01'];
const approvals={'ENV-01':'B','ENV-02':'B','ENV-03':'B','ENV-04':'B','DB-01':'C','DB-02':'C','DB-03':'C','DB-04':'D','DB-05':'D','DB-06':'D','DB-07':'D','DB-08':'D','TOP-01':'B','TOP-02':'B','TOP-03':'B','TOP-04':'B','TOP-05':'D','BKP-01':'B','BKP-02':'B','BKP-03':'B','BKP-04':'B','BKP-05':'B','OPS-01':'B','OPS-02':'D','OPS-03':'D','OPS-04':'D','OPS-05':'D','AUTH-01':'A','AUTH-02':'B','AUTH-03':'C','AUTH-04':'E','STATUS-01':'A'};
const protectedRequestPolicyHash='4bec728bf66adf3c9b42f3b251810a04f61da5c62812afbe562bede90a6c1dac';
const fields=['evidenceId','conditionId','responsibleRole','independentController','requiredEvidence','prerequisites','requiredApproval','secureSubmission','acceptanceCriteria','freshnessRule','status'];
const sameSet=(a,b)=>Array.isArray(a)&&a.length===new Set(a).size&&a.length===b.length&&a.every(x=>b.includes(x));
const exact=(x,k,c)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==k.length||Object.keys(x).some(v=>!k.includes(v)))throw new Error(c);};
const strings=x=>typeof x==='string'?[x]:Array.isArray(x)?x.flatMap(strings):x&&typeof x==='object'?Object.values(x).flatMap(strings):[];
const secretPatterns=[/postgres(?:ql)?:\/\/[^"\s]+:[^"\s]+@/i,/-----BEGIN [A-Z ]+PRIVATE KEY-----/i,/(?:api[_-]?key|token|password|secret)\s*[=:]\s*["']?[^"'\s]+/i];

export function validateHandoff(register,evidence,matrix){
  exact(register,['schemaVersion','document','planningOnly','globalReadiness','restoreReadiness','maintenanceReadiness','authorizedActivities','notAuthorizedActivities','requests'],'E_REGISTER_FIELD_INVALID');
  if(strings(register).some(v=>secretPatterns.some(p=>p.test(v))))throw new Error('E_SECRET_VALUE_DETECTED');
  if(register.planningOnly!==true)throw new Error('E_NOT_PLANNING_ONLY');
  if(register.globalReadiness!=='BLOCKED'||register.restoreReadiness!=='BLOCKED'||register.maintenanceReadiness!=='BLOCKED')throw new Error('E_READINESS_INVALID');
  if(!sameSet(register.authorizedActivities,['A'])||!sameSet(register.notAuthorizedActivities,['B','C','D','E','F','G','H']))throw new Error('E_AUTHORIZATION_INVALID');
  if(!Array.isArray(register.requests)||!sameSet(register.requests.map(x=>x.conditionId),ids))throw new Error('E_CONDITION_SET_INVALID');
  if(!sameSet(register.requests.map(x=>x.evidenceId),ids.map(x=>`EV-${x}`)))throw new Error('E_EVIDENCE_SET_INVALID');
  if(!evidence||!Array.isArray(evidence.evidence)||!matrix||!Array.isArray(matrix.conditions))throw new Error('E_APPROVED_SOURCE_INVALID');
  const evidenceById=new Map(evidence.evidence.map(x=>[x.evidenceId,x]));
  const matrixById=new Map(matrix.conditions.map(x=>[x.id,x]));
  if(evidenceById.size!==32||matrixById.size!==32)throw new Error('E_APPROVED_SOURCE_INVALID');
  for(const request of register.requests){
    exact(request,fields,`E_REQUEST_FIELD_INVALID:${request.evidenceId??'UNKNOWN'}`);
    const expectedId=`EV-${request.conditionId}`;
    if(request.evidenceId!==expectedId)throw new Error(`E_EVIDENCE_LINK_INVALID:${request.conditionId}`);
    if(request.requiredApproval!==approvals[request.conditionId])throw new Error(`E_APPROVAL_DRIFT:${request.conditionId}`);
    const source=evidenceById.get(request.evidenceId),condition=matrixById.get(request.conditionId);
    if(!source||source.conditionId!==request.conditionId)throw new Error(`E_EVIDENCE_SOURCE_MISMATCH:${request.evidenceId}`);
    if(!condition||condition.requiredApproval!==request.requiredApproval||source.requiredApproval!==request.requiredApproval)throw new Error(`E_APPROVED_SOURCE_MISMATCH:${request.conditionId}`);
    if(request.responsibleRole!==source.responsibleRole||request.requiredEvidence!==source.title||request.acceptanceCriteria!==source.acceptanceCriteria||request.freshnessRule!==source.freshnessRule)throw new Error(`E_REQUEST_RULE_DRIFT:${request.evidenceId}`);
    if(request.status!=='NOT_COLLECTED')throw new Error(`E_FALSE_COLLECTION_STATUS:${request.evidenceId}`);
    if(fields.slice(2,-1).some(k=>typeof request[k]!=='string'||request[k].trim()===''))throw new Error(`E_REQUEST_CONTENT_MISSING:${request.evidenceId}`);
  }
  const policyProjection=register.requests.map(({evidenceId,conditionId,responsibleRole,requiredEvidence,requiredApproval,acceptanceCriteria,freshnessRule,status})=>({evidenceId,conditionId,responsibleRole,requiredEvidence,requiredApproval,acceptanceCriteria,freshnessRule,status}));
  if(createHash('sha256').update(JSON.stringify(policyProjection)).digest('hex')!==protectedRequestPolicyHash)throw new Error('E_REQUEST_POLICY_DRIFT');
  const text=JSON.stringify(register);
  if(/\"(?:observedResult|collectedAt|acceptedAt|reviewerSignature|evidenceStatus)\"/i.test(text)||/\"(?:COLLECTED|ACCEPTED|APPROVED|VERIFIED|READY|RESOLVED)\"/.test(text))throw new Error('E_FALSE_PRODUCTION_CLAIM');
  return {valid:true,requests:32,status:'NOT_COLLECTED',globalReadiness:'BLOCKED'};
}

const load=p=>JSON.parse(readFileSync(join(root,p),'utf8'));
if(process.argv[1]?.endsWith('/validate.mjs')){
  const {runSuite}=await import('./tests/validation.test.mjs');
  const result=runSuite(validateHandoff,load('docs/production-evidence-handoff/evidence-request-register.json'),load('docs/production-evidence-collection-checklist/evidence-register.json'),load('docs/production-pre-access-readiness/readiness-matrix.json'));
  console.log(`validate.mjs: baseline valid; 32 handoff requests remain NOT_COLLECTED; ${result.negativeTests} exact-error negative fixtures rejected.`);
}
