import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.cwd();
const conditionIds = ['ENV-01','ENV-02','ENV-03','ENV-04','DB-01','DB-02','DB-03','DB-04','DB-05','DB-06','DB-07','DB-08','TOP-01','TOP-02','TOP-03','TOP-04','TOP-05','BKP-01','BKP-02','BKP-03','BKP-04','BKP-05','OPS-01','OPS-02','OPS-03','OPS-04','OPS-05','AUTH-01','AUTH-02','AUTH-03','AUTH-04','STATUS-01'];
const expectedApprovals = {'ENV-01':'B','ENV-02':'B','ENV-03':'B','ENV-04':'B','DB-01':'C','DB-02':'C','DB-03':'C','DB-04':'D','DB-05':'D','DB-06':'D','DB-07':'D','DB-08':'D','TOP-01':'B','TOP-02':'B','TOP-03':'B','TOP-04':'B','TOP-05':'D','BKP-01':'B','BKP-02':'B','BKP-03':'B','BKP-04':'B','BKP-05':'B','OPS-01':'B','OPS-02':'D','OPS-03':'D','OPS-04':'D','OPS-05':'D','AUTH-01':'A','AUTH-02':'B','AUTH-03':'C','AUTH-04':'E','STATUS-01':'A'};
const expectedEvidence = Object.fromEntries(conditionIds.map((id) => [id, `EV-${id}`]));
const protectedFieldHash = 'ca8b2e9c9e372ee17fde95ab6a2efeb9a5994721d827d87cbb081888ec83ac1a';
const protectedCriticalFields = {"EV-ENV-02":{"acceptanceCriteria":"environment target database schema region revision and window are unambiguous","acquisitionMethod":"owner-approved configuration read","freshnessRule":"invalidate on target or revision change"},"EV-DB-02":{"acceptanceCriteria":"no write owner bypass or unsafe function capability","acquisitionMethod":"separately approved read-only inspection","freshnessRule":"invalidate on grant schema or role change"},"EV-DB-03":{"acceptanceCriteria":"no direct or transitive escalation route","acquisitionMethod":"separately approved access review","freshnessRule":"invalidate on membership or policy change"},"EV-TOP-05":{"acceptanceCriteria":"global fence active for exact target and all writers rejected or drained","acquisitionMethod":"separately approved maintenance rehearsal","freshnessRule":"invalidate on topology revision or fence change"},"EV-BKP-04":{"acceptanceCriteria":"isolated restore succeeds and integrity checks pass","acquisitionMethod":"separately approved restore rehearsal","freshnessRule":"expire per recovery policy or invalidate on platform change"},"EV-BKP-05":{"acceptanceCriteria":"measured RPO and RTO satisfy approved values","acquisitionMethod":"measurement reconciliation","freshnessRule":"same expiry as restore rehearsal"},"EV-OPS-03":{"acceptanceCriteria":"all required signals active and test alert acknowledged","acquisitionMethod":"approved monitor inventory and test alert","freshnessRule":"invalidate on monitor alert route or operator change"},"EV-OPS-04":{"acceptanceCriteria":"every required signal has numeric approved abort threshold","acquisitionMethod":"owner and database review","freshnessRule":"invalidate on topology workload or SLO change"},"EV-AUTH-03":{"acceptanceCriteria":"C does not imply D and each diagnostic scope is exact","acquisitionMethod":"future explicit C then D approvals","freshnessRule":"expires at stated end or gate change"},"EV-AUTH-04":{"acceptanceCriteria":"SCAN has unique successful PREFLIGHT and manual independent approval; retry is new","acquisitionMethod":"future explicit phase-specific approvals","freshnessRule":"invalidate on state target scope or preflight change"}};
const fields = ['evidenceId','conditionId','title','purpose','responsibleRole','evidenceSource','acquisitionMethod','acceptableForm','acceptanceCriteria','createdAtRequirement','freshnessRule','independentReview','missingConsequence','requiredApproval'];
const sameSet = (a,b) => Array.isArray(a)&&a.length===new Set(a).size&&a.length===b.length&&a.every(x=>b.includes(x));
const exactKeys = (x,keys,code) => { if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==keys.length||Object.keys(x).some(k=>!keys.includes(k))) throw new Error(code); };
const stringValues = (value) => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(stringValues) : value && typeof value === 'object' ? Object.values(value).flatMap(stringValues) : [];
const secretValuePatterns = [
  /postgres(?:ql)?:\/\/[^"\s]+:[^"\s]+@/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
  /(?:api[_-]?key|token|password|secret)\s*[=:]\s*["']?[^"'\s]+/i
];

export function parseReadinessSource(source) {
  try { return JSON.parse(source); }
  catch { throw new Error('E_READINESS_JSON_INVALID'); }
}

function validateReadinessMatrix(matrix) {
  exactKeys(matrix,['schemaVersion','document','planningOnly','globalStatus','authoritativeRecordStatus','productionFacts','authorizedActivities','notAuthorizedActivities','statusVocabulary','conditions'],'E_READINESS_STRUCTURE_INVALID');
  if(!Array.isArray(matrix.conditions)) throw new Error('E_READINESS_STRUCTURE_INVALID');
  const ids=matrix.conditions.map(item=>item?.id);
  if(!sameSet(ids,conditionIds)) throw new Error('E_READINESS_CONDITION_DRIFT');
  for(const item of matrix.conditions){
    exactKeys(item,['id','description','sourceEvidence','status','responsibleRole','missingEvidence','failureConsequence','requiredApproval'],'E_READINESS_STRUCTURE_INVALID');
    if(typeof item.id!=='string'||typeof item.requiredApproval!=='string') throw new Error('E_READINESS_STRUCTURE_INVALID');
    if(item.requiredApproval!==expectedApprovals[item.id]) throw new Error(`E_READINESS_APPROVAL_DRIFT:${item.id}`);
  }
  return new Map(matrix.conditions.map(item=>[item.id,item.requiredApproval]));
}

export function validateRegister(register, options={}) {
  const readinessPath='docs/production-pre-access-readiness/readiness-matrix.json';
  let readinessMatrix=options.readinessMatrix;
  if(readinessMatrix===undefined){
    if(!(options.existingPaths?.has(readinessPath)??existsSync(join(root,readinessPath)))) throw new Error('E_READINESS_SOURCE_MISSING');
    try { readinessMatrix=parseReadinessSource(readFileSync(join(root,readinessPath),'utf8')); }
    catch(error){ if(error?.message==='E_READINESS_JSON_INVALID') throw error; throw new Error('E_READINESS_SOURCE_MISSING'); }
  }
  const matrixApprovals=validateReadinessMatrix(readinessMatrix);
  exactKeys(register,['schemaVersion','document','planningOnly','globalReadiness','authoritativeRecordStatus','productionFacts','authorizedActivities','notAuthorizedActivities','evidence'],'E_REGISTER_FIELD_INVALID');
  if(stringValues(register).some(value=>secretValuePatterns.some(pattern=>pattern.test(value)))) throw new Error('E_SECRET_VALUE_DETECTED');
  if(register.planningOnly!==true) throw new Error('E_NOT_PREPARATION');
  if(register.globalReadiness!=='BLOCKED') throw new Error('E_GLOBAL_READINESS_INVALID');
  if(register.authoritativeRecordStatus!=='UNRESOLVED'||register.productionFacts!=='UNKNOWN') throw new Error('E_AUTHORITATIVE_BOUNDARY_INVALID');
  if(!sameSet(register.authorizedActivities,['A'])||!sameSet(register.notAuthorizedActivities,['B','C','D','E','F','G','H'])) throw new Error('E_AUTHORIZATION_INVALID');
  if(!Array.isArray(register.evidence)||!sameSet(register.evidence.map(x=>x.conditionId),conditionIds)) throw new Error('E_CONDITION_COVERAGE_INVALID');
  if(!sameSet(register.evidence.map(x=>x.evidenceId),Object.values(expectedEvidence))) throw new Error('E_EVIDENCE_ID_SET_INVALID');
  for(const item of register.evidence){
    exactKeys(item,fields,`E_EVIDENCE_FIELD_INVALID:${item.evidenceId??'UNKNOWN'}`);
    if(item.evidenceId!==expectedEvidence[item.conditionId]) throw new Error(`E_EVIDENCE_LINK_INVALID:${item.conditionId}`);
    if(!['A','B','C','D','E','F','G','H'].includes(item.requiredApproval)) throw new Error(`E_APPROVAL_CLASS_INVALID:${item.conditionId}`);
    if(item.requiredApproval!==expectedApprovals[item.conditionId]) throw new Error(`E_APPROVAL_DRIFT:${item.conditionId}`);
    if(item.requiredApproval!==matrixApprovals.get(item.conditionId)) throw new Error(`E_REGISTER_MATRIX_APPROVAL_MISMATCH:${item.conditionId}`);
    if(fields.slice(2,-1).some(k=>typeof item[k]!=='string'||item[k].trim()==='')) throw new Error(`E_EVIDENCE_CONTENT_MISSING:${item.evidenceId}`);
  }
  for(const [evidenceId,pins] of Object.entries(protectedCriticalFields)){
    const item=register.evidence.find(candidate=>candidate.evidenceId===evidenceId);
    for(const field of ['acceptanceCriteria','acquisitionMethod','freshnessRule']){
      if(item[field]!==pins[field]) throw new Error(`${field==='acceptanceCriteria'?'E_ACCEPTANCE_CRITERIA_DRIFT':field==='acquisitionMethod'?'E_ACQUISITION_METHOD_DRIFT':'E_FRESHNESS_RULE_DRIFT'}:${evidenceId}`);
    }
  }
  const projection=register.evidence.map(({evidenceId,acceptanceCriteria,acquisitionMethod,freshnessRule})=>({evidenceId,acceptanceCriteria,acquisitionMethod,freshnessRule}));
  if(createHash('sha256').update(JSON.stringify(projection)).digest('hex')!==protectedFieldHash) throw new Error('E_PROTECTED_EVIDENCE_FIELDS_DRIFT');
  const forbidden=JSON.stringify(register);
  if(/\"(?:evidenceStatus|validationStatus|collectedAt|observedResult)\"/i.test(forbidden)||/\"(?:RESOLVED|READY|APPROVED|VALID)\"/.test(forbidden)) throw new Error('E_FALSE_EVIDENCE_CLAIM');
  return {valid:true,evidence:32,conditions:32,globalReadiness:'BLOCKED'};
}

const load=()=>JSON.parse(readFileSync(join(root,'docs/production-evidence-collection-checklist/evidence-register.json'),'utf8'));
if(process.argv[1]?.endsWith('/validate.mjs')){
  const {runSuite}=await import('./tests/validation.test.mjs');
  const result=runSuite(validateRegister,load());
  console.log(`validate.mjs: baseline valid; 32 evidence definitions cover 32 conditions; ${result.negativeTests} exact-error negative fixtures rejected.`);
}