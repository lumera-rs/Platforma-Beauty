import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const root = new URL(".", import.meta.url).pathname;
const clone = (value) => JSON.parse(JSON.stringify(value));
const setEqual = (a, b) => a.length === b.length && new Set(a).size === new Set(b).size &&
  a.every((value) => b.includes(value));
const digest = (text) => crypto.createHash("sha256").update(text).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readText = (file) => fs.readFileSync(file, "utf8");

function splitSqlStatements(text) {
  const statements = [];
  let raw = "", code = "", quote = false, lineComment = false, blockComment = false;
  const push = () => {
    if (code.trim()) statements.push({ raw: raw.trim(), code: code.trim() });
    raw = "";
    code = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (lineComment) {
      raw += ch;
      code += " ";
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      raw += ch;
      code += " ";
      if (ch === "*" && next === "/") {
        raw += next;
        code += " ";
        i++;
        blockComment = false;
      }
      continue;
    }
    if (!quote && ch === "-" && next === "-") {
      raw += ch + next;
      code += "  ";
      i++;
      lineComment = true;
      continue;
    }
    if (!quote && ch === "/" && next === "*") {
      raw += ch + next;
      code += "  ";
      i++;
      blockComment = true;
      continue;
    }
    raw += ch;
    if (ch === "'") {
      code += " ";
      if (quote && next === "'") {
        raw += next;
        code += " ";
        i++;
      } else {
        quote = !quote;
      }
      continue;
    }
    if (!quote && ch === ";") {
      raw = raw.slice(0, -1);
      push();
      continue;
    }
    code += quote ? " " : ch;
  }
  push();
  return statements;
}

function sectionSql(sql, sections, section) {
  const index = sections.indexOf(section);
  const start = sql.indexOf(section.sqlMarker);
  const end = index + 1 < sections.length ? sql.indexOf(sections[index + 1].sqlMarker) : sql.length;
  return sql.slice(start, end);
}

function runnableStatements(sql, sections, section) {
  return splitSqlStatements(sectionSql(sql, sections, section))
    .filter((statement) => /^(?:SELECT|WITH)\b/i.test(statement.code));
}

function outerLimit(statement) {
  let depth = 0, topLevel = "";
  for (const ch of statement.code) {
    if (ch === "(") {
      depth++;
      topLevel += " ";
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      topLevel += " ";
    } else {
      topLevel += depth === 0 ? ch : " ";
    }
  }
  const match = topLevel.match(/\bLIMIT\s+(\d+)\s*$/i);
  return match ? Number(match[1]) : null;
}

function declaredRowCaps(text, noSql) {
  const expression = noSql
    ? /\b(\d[\d,_]*)\s+SQL\s+rows?\b/gi
    : /\b(\d[\d,_]*)\s+rows?\b[^.]*\bper\s+SQL\s+statement\b/gi;
  return [...text.matchAll(expression)]
    .map((match) => Number(match[1].replace(/[,_]/g, "")));
}

function hasOnlyApprovedRedactionDenials(text) {
  const approved = [
    /Any definition\/argument excerpt is truncated, not redacted; truncation is not a privacy protection\./gi,
    /Definition and argument excerpts are truncated, not redacted; truncation is not privacy protection\./gi,
    /The definition excerpt is truncated, not redacted; truncation is not privacy protection\./gi,
    /Any excerpt is truncated, not redacted; truncation is not privacy protection\./gi
  ];
  const remainder = approved.reduce((value, phrase) => value.replace(phrase, ""), text);
  return !/\bredact\w*\b/i.test(remainder);
}

function validateSql(sql, sections) {
  let code = "", statements = [], current = "", quote = false, lineComment = false, blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i], next = sql[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; code += " "; current += " "; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i++; } code += " "; current += " "; continue; }
    if (!quote && ch === "-" && next === "-") { lineComment = true; code += "  "; current += "  "; i++; continue; }
    if (!quote && ch === "/" && next === "*") { blockComment = true; code += "  "; current += "  "; i++; continue; }
    if (ch === "'" && sql[i - 1] !== "\\") { quote = !quote; code += " "; current += " "; continue; }
    if (!quote && ch === ";") { if (current.trim()) statements.push(current.trim()); current = ""; code += " "; continue; }
    code += quote ? " " : ch; current += quote ? " " : ch;
  }
  if (current.trim()) statements.push(current.trim());
  if (/\b(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|GRANT|REVOKE|CALL|DO|COPY|EXECUTE)\b/i.test(code) ||
      /\bEXPLAIN\s+ANALYZE\b/i.test(code)) {
    throw new Error("unsafe SQL statement or stacked statement");
  }
  if (statements.some((statement) => !/^(SELECT|WITH)\b/i.test(statement))) throw new Error("statement is not SELECT/WITH");
  if (/\b(pg_sleep|dblink|dblink_exec|lo_import|lo_export|pg_read_file|pg_write_file|set_config)\s*\(/i.test(sql))
    throw new Error("mutating or unsafe function");
  if (/\b(pg_get_functiondef)\s*\(/i.test(sql)) throw new Error("unbounded function definition");
  const allowedFunctions = new Set(["unnest", "jsonb_to_recordset", "current_database", "current_setting", "count", "coalesce", "any", "as", "from", "in", "and", "or", "b",
    "length", "substring", "pg_catalog.pg_get_userbyid", "pg_catalog.pg_get_expr",
    "pg_catalog.pg_get_function_identity_arguments", "pg_catalog.pg_backend_pid", "lateral",
    "pg_catalog.pg_is_in_recovery", "join", "pg_catalog.to_regclass"]);
  for (const match of code.matchAll(/([a-z_][a-z0-9_.]*)\s*\(/gi)) {
    if (!allowedFunctions.has(match[1].toLowerCase())) throw new Error("unapproved function: " + match[1]);
  }
  if (!/capture_id/i.test(sql) || !/record_id/i.test(sql)) throw new Error("missing attribution");
  if (sections.some((section) => !sql.includes(section.sqlMarker))) throw new Error("missing SQL section");
  const targetBoundProcedures = new Set(["P-02", "P-03", "P-04", "P-05", "P-06", "P-08"]);
  const invalidIdentityKeywords = new Set(["if","else","end","then","begin","select","from","where","table","index","constraint","function","trigger","create","alter","drop","returning","values","insert","update","delete","join","on","as","null","true","false"]);
  for (const [index, section] of sections.entries()) {
    const text = sectionSql(sql, sections, section);
    if (section.procedureId === "P-03" && /LIMIT\s+1/i.test(text) && !/ORDER\s+BY\s+ad\.adnum/i.test(text))
      throw new Error("D-03 nondeterministic selection");
    if (section.procedureId === "P-10" || section.statementContract?.noSql) {
      if (/\bSELECT\b/i.test(text)) throw new Error(`blocked section contains SQL: ${section.procedureId}`);
      continue;
    }
    const capturePosition = section.parameterContract.find((p) => p.name === "capture_id")?.position;
    const chunkPosition = section.parameterContract.find((p) => p.name === "chunk_id")?.position;
    if (!new RegExp(`\\$${capturePosition}::text\\s+AS\\s+capture_id`, "i").test(text) ||
        !new RegExp(`\\$${chunkPosition}::text\\s+AS\\s+chunk_id`, "i").test(text) ||
        !/\bscope\.record_id\b/i.test(text))
      throw new Error(`SQL section attribution mismatch: ${section.procedureId}`);
    if (targetBoundProcedures.has(section.procedureId)) {
      const targetPosition = section.parameterContract.find((p) => p.name === "target_bindings")?.position;
      if (!new RegExp(`jsonb_to_recordset\\s*\\(\\s*\\$${targetPosition}::jsonb\\s*\\)`, "i").test(text) ||
          !/\brecord_id\s+text\b/i.test(text) ||
          !/\bschema_name\s+text\b/i.test(text) ||
          !/\bobject_name\s+text\b/i.test(text))
        throw new Error(`SQL section target binding mismatch: ${section.procedureId}`);
    } else if (!new RegExp(`unnest\\s*\\(\\s*\\$${section.parameterContract.find((p) => p.name === "record_ids")?.position}::text\\[\\]\\s*\\)`, "i").test(text)) {
      throw new Error(`SQL section chunk scope mismatch: ${section.procedureId}`);
    }
    if (section.procedureId === "P-02" &&
        (!/\bpg_catalog\.pg_namespace\b/i.test(text) ||
         !/\bn\.nspname\s*=\s*ANY\(\$2::text\[\]\)/i.test(text) ||
         !/\bc\.relname\s*=\s*ANY\(\$3::text\[\]\)/i.test(text)))
      throw new Error("P-02 SQL namespace/relation binding mismatch");
    if (["P-03", "P-04", "P-06"].includes(section.procedureId) &&
        (!/\bn\.nspname\s*=\s*ANY\(\$2::text\[\]\)/i.test(text) ||
         !/\bc\.relname\s*=\s*ANY\(\$3::text\[\]\)/i.test(text)))
      throw new Error("target relation allow-list predicate missing");
    if (section.procedureId === "P-08" &&
        (!/\bpg_catalog\.pg_proc\b/i.test(text) ||
         !/\bn\.nspname\s*=\s*ANY\(\$2::text\[\]\)/i.test(text) ||
         !/\bp\.proname\s*=\s*ANY\(\$3::text\[\]\)/i.test(text)))
      throw new Error("P-08 SQL schema/function binding mismatch");
    const on = text.split(/\bWHERE\b/i)[0];
    if (section.procedureId === "P-02" && (!/n\.nspname=ANY\(\$2::text\[\]\)/i.test(on) || !/c\.relname=ANY\(\$3::text\[\]\)/i.test(on))) throw new Error("P-02 allow-list placement");
    if (section.procedureId === "P-03" && (!/n\.nspname=ANY\(\$2::text\[\]\)/i.test(on) || !/c\.relname=ANY\(\$3::text\[\]\)/i.test(on))) throw new Error("P-03 allow-list placement");
    if (section.procedureId === "P-04" && (!/n\.nspname=ANY\(\$2::text\[\]\)/i.test(on) || !/c\.relname=ANY\(\$3::text\[\]\)/i.test(on) || !/i\.relname=ANY\(\$3::text\[\]\)/i.test(on))) throw new Error("P-04 allow-list placement");
    if (section.procedureId === "P-08" && (!/n\.nspname=ANY\(\$2::text\[\]\)/i.test(on) || !/p\.proname=ANY\(\$3::text\[\]\)/i.test(on))) throw new Error("P-08 allow-list placement");
    if (section.procedureId === "P-04" && !/\(ix\.indexrelid\s+IS\s+NOT\s+NULL\)\s+AS\s+object_found/i.test(text))
      throw new Error("P-04 object_found must prove index relationship");
    if (section.procedureId === "P-05" &&
        (!/public\.shipping_rules/i.test(text) ||
         !/CROSS\s+JOIN\s*\(\s*SELECT\s+count\(\*\)::bigint\s+AS\s+observed_rows_capped_at_two\s+FROM\s*\(\s*SELECT\s+1\s+FROM\s+public\.shipping_rules\s+LIMIT\s+2\s*\)/i.test(text) ||
         !/jsonb_to_recordset\s*\(\s*\$3::jsonb/i.test(text) ||
         /to_jsonb|scan\.\*/i.test(text)))
      throw new Error("P-05 fixed target scan contract");
    if (section.procedureId === "P-05" &&
        (!/D-05 PREFLIGHT[\s\S]*D-05 SCAN/i.test(text) ||
         !/pg_catalog\.to_regclass\s*\(\s*'public\.shipping_rules'\s*\)/i.test(text) ||
         !/LEFT JOIN pg_catalog\.pg_namespace[\s\S]*LEFT JOIN pg_catalog\.pg_class/i.test(text) ||
         !/'preflight'::text\s+AS\s+phase[\s\S]*target_exists[\s\S]*observed_rows_capped_at_two/i.test(text)))
      throw new Error("P-05 preflight statement contract");
    if (section.procedureId === "P-05") {
      const statements = runnableStatements(sql, sections, section);
      const [preflight, scan] = statements;
      if (statements.length !== 2 || !/D-05 PREFLIGHT/i.test(preflight.raw) || outerLimit(preflight) !== 1)
        throw new Error("R1 P-05 preflight outer LIMIT 1 missing");
      if (!/D-05 SCAN/i.test(scan.raw) || outerLimit(scan) !== 1)
        throw new Error("R1 P-05 scan outer LIMIT 1 missing");
      if (!/D-05 SCAN\s+\(prepare only after preflight target_exists=true for same capture\/chunk\/record;\s*otherwise BLOCKED_PRECONDITION and do not prepare\)/i.test(text))
        throw new Error("R9 P-05 scan preflight instruction missing");
      const fixedScope = /\bWHERE\s+scope\.schema_name\s*=\s*'public'\s+AND\s+scope\.object_name\s*=\s*'shipping_rules'\s+LIMIT\s+1\s*$/i;
      if (!fixedScope.test(preflight.raw) ||
          !/n\.nspname\s*=\s*scope\.schema_name\s+AND\s+n\.nspname\s*=\s*'public'/i.test(preflight.raw) ||
          !/c\.relname\s*=\s*scope\.object_name\s+AND\s+c\.relname\s*=\s*'shipping_rules'/i.test(preflight.raw))
        throw new Error("R9 P-05 preflight fixed target scope missing");
      if (!fixedScope.test(scan.raw))
        throw new Error("R9 P-05 scan fixed target scope missing");
    }
    if (["P-02", "P-03", "P-04", "P-08"].includes(section.procedureId) &&
        !/AS capture_id[\s\S]*AS chunk_id[\s\S]*scope\.record_id[\s\S]*AS object_found/i.test(text))
      throw new Error("catalog output order mismatch");
    if (section.procedureId === "P-07" &&
        (!/activity AS \(/i.test(text) || !/pg_catalog\.pg_stat_activity/i.test(text) ||
         !/LIMIT 201/i.test(text) || !/count\(\*\)/i.test(text) ||
         !/FROM scope CROSS JOIN activity/i.test(text) ||
         !/scope\.record_id[\s\S]*observed_sessions_capped_at_201[\s\S]*sample_truncated/i.test(text)))
      throw new Error("activity scope preservation/output order mismatch");
    if (section.procedureId === "P-04" &&
        (!/c\.relnamespace\s*=\s*n\.oid\s+AND\s+c\.relname\s*=\s*scope\.parent_name/i.test(text) ||
         !/i\.relnamespace\s*=\s*n\.oid\s+AND\s+i\.relname\s*=\s*scope\.object_name/i.test(text) ||
         !/ix\.indrelid\s*=\s*c\.oid\s+AND\s+ix\.indexrelid\s*=\s*i\.oid/i.test(text)))
      throw new Error("P-04 index/parent join mismatch");
    if (["P-02", "P-03", "P-04", "P-08"].includes(section.procedureId) &&
        /\bWHERE\b[\s\S]*(?:n\.nspname|c\.relname|i\.relname|p\.proname)\s*=\s*ANY/i.test(text))
      throw new Error("nullable catalog allow-list predicate in WHERE");
    if (["P-02", "P-03", "P-04", "P-08"].includes(section.procedureId) &&
        (!/LEFT JOIN pg_catalog\.pg_namespace/i.test(text) || !/\bobject_found\b/i.test(text)))
      throw new Error("scope-led object observation contract missing");
  }
}

export function validatePackage(inputs, artifacts) {
  const { catalog, coverage, procedures, matrix, inventory, additionalEvidence, manifest, sectionManifest, recordManifest, sql, blockedEvidence, readme, executionSafety, verification } = artifacts;
  const invalidIdentityKeywords = new Set(["if","else","end","then","begin","select","from","where","table","index","constraint","function","trigger","create","alter","drop","returning","values","insert","update","delete","join","on","as","null","true","false"]);
  const targetBoundProcedures = new Set(["P-02", "P-03", "P-04", "P-05", "P-06", "P-08"]);
  const evidenceSatisfactionAllowList = new Set(["PARTIAL_OBSERVATION_WITH_BLOCKERS", "BLOCKED_NON_DATABASE_ATTESTATION"]);
  const diagnosticStatusAllowList = new Set(["DESIGN_ONLY_NO_PRODUCTION_RESULT"]);
  const catalogStatusAllowList = new Set(["DESIGN_ONLY"]);
  const catalogKeys = new Set(["diagnosticId", "procedureId", "evidenceRequirementIds", "exactApplicableRecordIds",
    "purpose", "requiredPrivileges", "expectedOutputSchema", "parameters", "operationalRisk", "lockConsiderations",
    "timeoutRequirements", "maximumResultSize", "sensitiveDataConsiderations", "abortConditions",
    "evidenceValidationCriteria", "approvalGate", "sqlSectionManifestRef", "blockedRecordIds", "executionEnvelope",
    "parameterContract", "outputSchema", "supportedTargetKinds", "evidenceSatisfaction", "blockedEvidenceNote",
    "exactRecordIds", "chunks",
    "statementContract", "outputColumns", "status"]);
  const catalogTopKeys = new Set(["schemaVersion", "document", "status", "diagnosticCount", "diagnostics", "executionEnvelope"]);
  if (Object.keys(catalog).some((key) => !catalogTopKeys.has(key)) || !catalogStatusAllowList.has(catalog.status))
    throw new Error("unknown or invalid catalog field/status");
  for (const diagnostic of catalog.diagnostics) {
    if (Object.keys(diagnostic).some((key) => !catalogKeys.has(key)))
      throw new Error("unknown diagnostic catalog field");
    if (!evidenceSatisfactionAllowList.has(diagnostic.evidenceSatisfaction) ||
        !diagnosticStatusAllowList.has(diagnostic.status))
      throw new Error("unknown or missing diagnostic status");
    if (Object.keys(diagnostic).some((key) => /observed.*result|production.*result|execution.*result|result.*value/i.test(key)))
      throw new Error("execution result field in diagnostic catalog");
  }
  const diagnosticById = Object.fromEntries(catalog.diagnostics.map((diagnostic) => [diagnostic.diagnosticId, diagnostic]));
  if (catalog.diagnosticCount !== 10 || catalog.diagnostics.length !== 10)
    throw new Error("diagnostic count mismatch");
  if (diagnosticById["D-05"]?.evidenceSatisfaction !== "PARTIAL_OBSERVATION_WITH_BLOCKERS" ||
      diagnosticById["D-06"]?.evidenceSatisfaction !== "BLOCKED_NON_DATABASE_ATTESTATION" ||
      diagnosticById["D-10"]?.evidenceSatisfaction !== "BLOCKED_NON_DATABASE_ATTESTATION")
    throw new Error("diagnostic evidence classification drift");
  if (!/D-06 and D-10 use BLOCKED_NON_DATABASE_ATTESTATION[\s\S]*D-05 remains PARTIAL_OBSERVATION_WITH_BLOCKERS/.test(readme) ||
      /D-05,\s*D-06,\s*and\s*D-10 use BLOCKED_NON_DATABASE_ATTESTATION/.test(readme))
    throw new Error("README evidence classification drift");
  for (const [file, text] of Object.entries({
    "README.md": readme,
    "verification.md": verification,
    "execution-safety.md": executionSafety,
    "diagnostic-catalog.json": JSON.stringify(catalog)
  })) {
    if (!hasOnlyApprovedRedactionDenials(text))
      throw new Error("R2 unsupported redaction claim: " + file);
  }
  if (!/No SQL or output is produced[\s\S]*must not include sensitive values/i.test(diagnosticById["D-10"].sensitiveDataConsiderations))
    throw new Error("D-10 sensitive-data contract drift");
  if (!/\bnon-database attestation\b/i.test(diagnosticById["D-06"].purpose) ||
      !/\bno SQL statement\s+and\s+no SQL output\b/i.test(diagnosticById["D-06"].purpose))
    throw new Error("R4 D-06 non-database/no-SQL purpose drift");
  if (!/attached_assets\/[\s\S]*auto-attached/i.test(verification) ||
      /all (?:created\/modified )?paths are under docs\/production-diagnostic-design/i.test(verification))
    throw new Error("Git provenance documentation drift");
  if (!/docs\/production-evidence-plan\/collection-procedures\.json[\s\S]{0,160}\bexternal authoritative input\b/i.test(readme))
    throw new Error("R8 external authoritative collection-procedures path missing");
  if (!/diagnostic designs \(D-01 through D-10\)/i.test(readme) ||
      !/collection procedures \(P-01 through P-10\)/i.test(readme))
    throw new Error("diagnostic/procedure terminology drift");
  for (const diagnostic of catalog.diagnostics) {
    if (diagnostic.lockConsiderations === undefined || diagnostic.lockConsiderations === null || diagnostic.lockConsiderations === "")
      throw new Error("missing field lockConsiderations");
    if (!diagnostic.statementContract?.noSql) {
      const lockText = diagnostic.lockConsiderations
        .replace(/\bno write or advisory locks? are acquired\b/gi, "");
      if (/\b(?:no|zero)\s+(?:any\s+|database\s+|relation\s+|catalog\s+|application\s+)?locks?\s+(?:are\s+)?(?:possible|taken|acquired|present|used|held|available)\b/i.test(lockText) ||
          /\bnever\s+(?:takes?|acquires?|uses?|holds?)\s+(?:(?:any|database|relation|catalog|application)\s+)?locks?\b/i.test(lockText) ||
          /\b(?:no\s+)?(?:blocking|block(?:ing)?\s+risk|lock waits?)\s+(?:is\s+)?(?:impossible|not possible|unable to occur|cannot occur|never occurs)\b/i.test(lockText) ||
          /\b(?:(?:can|will)\s+never|cannot|can not)\s+block\b/i.test(lockText))
        throw new Error("R3 affirmative no-lock/no-block claim: " + diagnostic.diagnosticId);
    }
    if (!["D-06", "D-10"].includes(diagnostic.diagnosticId) &&
        (!/lock_timeout/i.test(diagnostic.lockConsiderations) || !/lock/i.test(diagnostic.lockConsiderations)))
      throw new Error("incomplete lock consideration");
  }
  if (!catalog.executionEnvelope || catalog.executionEnvelope.connectionCap !== 1 ||
      catalog.executionEnvelope.resultCaps.rows !== 1000 || catalog.executionEnvelope.resultCaps.bytes !== 2097152)
    throw new Error("invalid execution envelope");
  // Independent authority: all 73 entries and file bytes reproduced from b8f30561.
  // Historical evidence must never be compared to today's working-tree source.
  if (!manifest.inputs || Array.isArray(manifest.inputs) ||
      digest(JSON.stringify(Object.entries(manifest.inputs).sort())) !== "ea939afa67068f34523fef2e76c811adeca39178ad5955959c8d4e7adceb14da")
    throw new Error("historical baseline drift");
  if (manifest.algorithm !== "sha256" || manifest.fileCount !== 73)
    throw new Error("protected manifest invalid");
  if (!manifest.currentInputs || Array.isArray(manifest.currentInputs) ||
      digest(JSON.stringify(Object.keys(manifest.currentInputs).sort())) !== "2cf4681c2e15d0bbfeb5e9571083f9f5ccadc5e748561f0a44dee0d282f5b8ef")
    throw new Error("protected-path inventory mismatch");
  for (const [file, expected] of Object.entries(manifest.currentInputs)) {
    if (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== expected)
      throw new Error("protected hash drift: " + file);
  }
  const proceduresList = Object.values(procedures.procedures);
  const authoritativeRecords = matrix.records;
  const authoritativeIds = authoritativeRecords.map((record) => record.authoritativeRecordId);
  if (new Set(authoritativeIds).size !== authoritativeIds.length) throw new Error("duplicate authoritative record ID");
  if (!setEqual(coverage.procedureIds, proceduresList.map((p) => p.id))) throw new Error("procedure ID mismatch");
  if (new Set(coverage.records.map((record) => record.recordId)).size !== coverage.records.length)
    throw new Error("duplicate coverage record ID");
  if (!setEqual(coverage.records.map((r) => r.recordId), authoritativeIds)) throw new Error("authoritative IDs not covered");
  const occurrenceIds = [...new Set(authoritativeRecords.flatMap((r) => r.relevantOccurrenceIds || []))];
  if (!setEqual(coverage.occurrenceIds, occurrenceIds)) throw new Error("occurrence mismatch");
  const ownerNames = inventory.owners.map((owner) => owner[0] || owner.name || owner.owner);
  if (!setEqual(coverage.ownerNames, ownerNames)) throw new Error("owner mismatch");
  if (coverage.totals.mappingIds !== 1435 || coverage.totals.occurrences !== 1459 ||
      coverage.totals.additionalOperations !== 110 || coverage.totals.owners !== 8 || coverage.totals.totalRecords !== 1545)
    throw new Error("literal coverage totals mismatch");
  if (coverage.mappingIds.length !== 1435 || coverage.additionalOperationIds.length !== 110) throw new Error("coverage cardinality");
  if (new Set(coverage.mappingIds).size !== 1435 || new Set(coverage.additionalOperationIds).size !== 110) throw new Error("duplicate source IDs");
  if (!setEqual(coverage.mappingIds, inventory.mappingIds.map((id) => "mapping:" + id))) throw new Error("mapping IDs");
  if (!setEqual(coverage.additionalOperationIds, inventory.additionalOperationIds.map((id) => "additional-operation:" + id))) throw new Error("additional operation IDs");
  if (!Array.isArray(additionalEvidence) || additionalEvidence.length !== 110) throw new Error("additional evidence count");
  if (!recordManifest || recordManifest.bindings.length !== 1545 ||
      new Set(recordManifest.bindings.map((binding) => binding.recordId)).size !== 1545)
    throw new Error("record-target binding cardinality");
  let mappingIndex = 0, additionalIndex = 0;
  for (const authoritative of authoritativeRecords) {
    const compact = authoritative.family === "mapping" ? inventory.records.mappings[mappingIndex++] :
      inventory.records.additionalOperations[additionalIndex++];
    const expectedGroups = compact[2].map((index) => {
      const group = inventory.objectGroups[index];
      return { objectGroupId: group[0], membershipBasis: group[1], identity: group[2] };
    });
    const binding = recordManifest.bindings.find((candidate) => candidate.recordId === authoritative.authoritativeRecordId);
    if (!binding || !setEqual(binding.occurrenceIds, authoritative.relevantOccurrenceIds || []) ||
        !setEqual(binding.owners, authoritative.startupOwners || []) ||
        binding.operationType !== authoritative.operationType ||
        JSON.stringify(binding.objectGroups) !== JSON.stringify(expectedGroups))
      throw new Error("record-target binding mismatch");
    const dynamic = JSON.stringify(expectedGroups).includes("<dynamic>") || JSON.stringify(expectedGroups).includes("${");
    const malformed = expectedGroups.some((group) => ["schema", "name", "parent"].some((key) =>
      typeof group.identity?.[key] === "string" && invalidIdentityKeywords.has(group.identity[key].trim().toLowerCase())));
    if (dynamic && binding.targetStatus === "CONCRETE_APPROVED_STATIC_TARGET")
      throw new Error("dynamic target incorrectly covered");
    if (malformed && binding.targetStatus === "CONCRETE_APPROVED_STATIC_TARGET") throw new Error("invalid identity marked concrete");
  }
  const diagnosticIds = catalog.diagnostics.map((d) => d.diagnosticId);
  if (new Set(diagnosticIds).size !== diagnosticIds.length) throw new Error("duplicate diagnostic ID");
  if (!setEqual(sectionManifest.sections.map((s) => s.diagnosticId), diagnosticIds)) throw new Error("section/catalog mismatch");
  for (const diagnostic of catalog.diagnostics) {
    const procedure = procedures.procedures[diagnostic.procedureId];
    if (!procedure) throw new Error("wrong procedure reference");
    if (!setEqual(diagnostic.evidenceRequirementIds, procedure.evidenceRequirementIds)) throw new Error("evidence requirement reference");
    for (const field of ["purpose", "requiredPrivileges", "expectedOutputSchema", "parameters", "operationalRisk",
      "lockConsiderations", "timeoutRequirements", "maximumResultSize", "sensitiveDataConsiderations",
      "abortConditions", "evidenceValidationCriteria", "approvalGate", "sqlSectionManifestRef"]) {
      if (diagnostic[field] === undefined || diagnostic[field] === null || diagnostic[field] === "") throw new Error("missing field " + field);
    }
    if (diagnostic.timeoutRequirements.statementTimeoutMs <= 0 || diagnostic.timeoutRequirements.lockTimeoutMs <= 0)
      throw new Error("invalid timeout");
    const section = sectionManifest.sections.find((s) => s.diagnosticId === diagnostic.diagnosticId);
    if (!section || !section.resultCaps || !Number.isInteger(section.resultCaps.rows) || section.resultCaps.rows < 0)
      throw new Error("missing result cap");
    if (!setEqual(diagnostic.exactApplicableRecordIds, section.exactRecordIds) ||
        !setEqual(section.exactRecordIds.concat(section.blockedRecordIds), procedure.exactApplicableRecordIds) ||
        !setEqual(diagnostic.blockedRecordIds, section.blockedRecordIds))
      throw new Error("diagnostic safe-set partition mismatch");
    if (section.exactRecordIds.length === 0 && section.chunks.length !== 0)
      throw new Error("empty safe set has chunks");
    if (section.exactRecordIds.length !== 0 && section.chunks.length === 0)
      throw new Error("nonempty safe set has no chunks");
    if (diagnostic.evidenceSatisfaction === "BLOCKED_NON_DATABASE_ATTESTATION" && section.exactRecordIds.length !== 0)
      throw new Error("blocked diagnostic has runnable IDs");
    if (diagnostic.procedureId === "P-05" &&
        (!section.statementContract?.preflightResultGate?.required ||
         section.statementContract.preflightResultGate.whenFalse !== "BLOCKED_PRECONDITION; do not prepare or execute scan"))
      throw new Error("P-05 preflight approval gate missing");
    if (JSON.stringify(diagnostic.parameterContract) !== JSON.stringify(section.parameterContract) ||
        JSON.stringify(diagnostic.outputSchema) !== JSON.stringify(section.outputSchema) ||
        JSON.stringify(diagnostic.supportedTargetKinds) !== JSON.stringify(section.supportedTargetKinds))
      throw new Error("catalog/section contract mismatch");
    if (new Set(section.outputColumns).size !== section.outputColumns.length ||
        section.outputSchema.map((column) => column.columnName).join("|") !== section.outputColumns.join("|"))
      throw new Error("duplicate or unordered output schema");
    for (const column of section.outputSchema.filter((item) => ["capture_id", "chunk_id", "record_id"].includes(item.columnName)))
      if (column.postgresType !== "text")
        throw new Error("attribution output type mismatch");
    const nullableColumns = {
      "P-02": ["marker_relation", "estimated_rows"],
      "P-03": ["nspname", "relname", "relkind", "owner_name", "definition_excerpt", "definition_length"],
      "P-04": ["relname", "index_name", "indisvalid", "indisready", "indisunique"],
      "P-08": ["nspname", "proname", "argument_excerpt"],
      "P-05": ["target_exists", "observed_rows_capped_at_two"]
    }[section.procedureId] || [];
    for (const column of section.outputSchema)
      if (Boolean(column.nullable) !== nullableColumns.includes(column.columnName))
        throw new Error("output nullability contract mismatch");
    const requiredOutputOrder = {
      "P-02": ["capture_id", "chunk_id", "record_id", "object_found"],
      "P-03": ["capture_id", "chunk_id", "record_id", "object_found"],
      "P-04": ["capture_id", "chunk_id", "record_id", "object_found"],
      "P-05": ["capture_id", "chunk_id", "record_id", "phase", "target_exists", "observed_rows_capped_at_two"],
      "P-08": ["capture_id", "chunk_id", "record_id", "object_found"],
      "P-07": ["capture_id", "chunk_id", "record_id", "observed_sessions_capped_at_201", "sample_truncated"]
    }[section.procedureId];
    if (requiredOutputOrder && section.outputColumns.slice(0, requiredOutputOrder.length).join("|") !== requiredOutputOrder.join("|"))
      throw new Error("section-specific output order mismatch");
    for (const requiredName of (section.statementContract?.requires || []))
      if (!section.parameterContract.some((parameter) => parameter.name === requiredName))
        throw new Error("statement contract parameter missing");
    if (diagnostic.procedureId === "P-10" && (section.chunks.length || section.exactRecordIds.length || section.sqlMarker && sql.includes("SELECT") && sql.slice(sql.indexOf(section.sqlMarker)).includes("SELECT")))
      throw new Error("D-10 must be fully blocked");
    for (const recordId of section.exactRecordIds) {
      if (["P-01", "P-07", "P-09"].includes(diagnostic.procedureId)) continue;
      const binding = recordManifest.bindings.find((candidate) => candidate.recordId === recordId);
      const compatible = binding.objectGroups.some((group) => diagnostic.supportedTargetKinds.includes(group.identity?.kind));
      if (!compatible || binding.targetStatus !== "CONCRETE_APPROVED_STATIC_TARGET") throw new Error("unsupported covered target kind");
      if (diagnostic.procedureId === "P-05" && !binding.objectGroups.some((group) => {
        const identity = group.identity || {};
        return identity.kind === "table" && (identity.name === "shipping_rules" || identity.parent === "shipping_rules");
      })) throw new Error("non-shipping P-05 target");
    }
    if (!setEqual(section.exactRecordIds, diagnostic.exactApplicableRecordIds.filter((id) => !section.blockedRecordIds.includes(id))))
      throw new Error("section record coverage");
    if (!setEqual(section.blockedRecordIds, procedure.exactApplicableRecordIds.filter((id) => !section.exactRecordIds.includes(id)))) throw new Error("blocked partition incomplete");
    const chunkIds = section.chunks.flatMap((chunk) => chunk.recordIds);
    if (section.chunks.some((chunk, index) => chunk.recordIds.length > section.maxChunkSize ||
        chunk.chunkIndex !== index || chunk.chunkCount !== section.chunks.length ||
        chunk.recordIds.join("\n") !== [...chunk.recordIds].sort().join("\n") ||
        chunk.recordIdDigest !== digest(chunk.recordIds.join("\n")) ||
        !setEqual(chunk.targetBindingIds, chunk.recordIds.map((id) => "target:" + id))))
      throw new Error("invalid chunk metadata");
    if (!setEqual(chunkIds, section.exactRecordIds)) throw new Error("chunk ID partition");
    if (section.chunks.some((chunk) => chunk.recordIds.some((id) => section.blockedRecordIds.includes(id))))
      throw new Error("blocked ID in execution chunk");
    for (const id of section.exactRecordIds) {
      if (["P-01", "P-07", "P-09"].includes(section.procedureId)) continue;
      const binding = recordManifest.bindings.find((candidate) => candidate.recordId === id);
      if (!binding || binding.targetStatus !== "CONCRETE_APPROVED_STATIC_TARGET")
        throw new Error("non-concrete SQL target");
    }
    if (section.targetBindingIds.length !== new Set([...section.exactRecordIds, ...section.blockedRecordIds]).size ||
        !setEqual(section.targetBindingIds, [...section.exactRecordIds, ...section.blockedRecordIds].map((id) => "target:" + id)))
      throw new Error("target binding partition");
    if (section.procedureId === "P-05" && section.exactRecordIds.some((id) => {
      const binding = recordManifest.bindings.find((candidate) => candidate.recordId === id);
      return !binding.objectGroups.some((group) => (group.identity?.name === "shipping_rules" || group.identity?.parent === "shipping_rules"));
    })) throw new Error("P-05 non-shipping target");
    if (section.procedureId === "P-02" && !section.statementContract.p02NamespaceAndRelationAllowLists)
      throw new Error("P-02 namespace contract");
    if (section.procedureId === "P-08" && !section.statementContract.p08SchemaAndFunctionAllowLists)
      throw new Error("P-08 function contract");
  }
  for (const section of sectionManifest.sections) {
    const diagnostic = diagnosticById[section.diagnosticId];
    const statements = runnableStatements(sql, sectionManifest.sections, section);
    const declared = section.resultCaps.rows;
    const noSql = Boolean(section.statementContract?.noSql);
    if (noSql && (declared !== 0 || statements.length !== 0))
      throw new Error("R5 noSql result cap/statement mismatch: " + section.diagnosticId);
    if (!noSql && statements.length === 0)
      throw new Error("R5 runnable diagnostic has no SQL statement: " + section.diagnosticId);
    const claimedCaps = declaredRowCaps(diagnostic.maximumResultSize, noSql);
    if (claimedCaps.length !== 1 || claimedCaps[0] !== declared)
      throw new Error("R5 diagnostic maximumResultSize mismatch: " + section.diagnosticId);
    if (diagnostic.executionEnvelope?.resultCaps?.rows !== declared ||
        diagnostic.executionEnvelope?.resultCaps?.bytes !== (noSql ? 0 : 2097152))
      throw new Error("R5 diagnostic execution cap mismatch: " + section.diagnosticId);
    if (section.statementContract?.phases?.some((phase) => phase.maxRows !== declared))
      throw new Error("R5 phase result cap mismatch: " + section.diagnosticId);
  }
  for (const section of sectionManifest.sections) {
    if (section.statementContract?.noSql) {
      if (section.parameterContract.length !== 0) throw new Error("noSql section declares parameters");
      continue;
    }
    const positions = [...sql.slice(sql.indexOf(section.sqlMarker), section.procedureId === "P-10" ? sql.length : sql.indexOf("-- D-" + String(Number(section.procedureId.slice(2)) + 1).padStart(2, "0"))).matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const declared = section.parameterContract.map((parameter) => parameter.position);
    if (!setEqual(declared, Array.from({ length: Math.max(...declared) }, (_, i) => i + 1)) ||
        !setEqual([...new Set(positions)], declared))
      throw new Error("sparse or undeclared SQL parameter positions");
    for (const position of positions) if (!declared.includes(position)) throw new Error("undeclared SQL parameter");
    for (const parameter of section.parameterContract)
      if (parameter.required && !positions.includes(parameter.position) && !parameter.unusedJustification) throw new Error("unused declared parameter");
  }
  for (const record of coverage.records) {
    const authoritative = authoritativeRecords.find((candidate) => candidate.authoritativeRecordId === record.recordId);
    if (!authoritative || record.status !== authoritative.status || record.status !== "UNRESOLVED") throw new Error("status drift");
    const expected = proceduresList.filter((p) => p.exactApplicableRecordIds.includes(record.recordId)).map((p) => "D-" + p.id.slice(2));
    if (!setEqual(record.diagnosticIds, expected) || !record.diagnosticIds.length) throw new Error("missing record assignment");
  }
  for (const section of sectionManifest.sections) {
    const diagnostic = catalog.diagnostics.find((item) => item.diagnosticId === section.diagnosticId);
    const procedure = procedures.procedures[section.procedureId];
    if (!procedure || diagnostic.procedureId !== section.procedureId)
      throw new Error("SQL section procedure mismatch");
    if (!setEqual(section.evidenceRequirementIds, procedure.evidenceRequirementIds))
      throw new Error("SQL section evidence requirement mismatch");
    if (!section.statementContract?.noSql && section.procedureId !== "P-10" && (!section.parameters.includes("capture_id") || !(targetBoundProcedures.has(section.procedureId) ? section.parameters.includes("target_bindings") : section.parameters.includes("record_ids")) ||
        !section.outputColumns.includes("capture_id") || !section.outputColumns.includes("record_id")))
      throw new Error("SQL section attribution contract mismatch");
    if ((section.statementContract?.noSql && section.exactRecordIds.length !== 0) ||
        section.exactRecordIds.some((id) => section.blockedRecordIds.includes(id)))
      throw new Error("blocked package contains SQL-covered records");
  }
  if (coverage.authoritativeStatus !== "UNRESOLVED" || coverage.productionFacts !== "UNKNOWN") throw new Error("unauthorized production result");
  const authoritativeRequirementIds = matrix.evidenceRequirements.map((requirement) => requirement.id);
  const sectionRequirementIds = sectionManifest.sections.flatMap((section) => section.evidenceRequirementIds);
  if (!setEqual(sectionRequirementIds, authoritativeRequirementIds))
    throw new Error("missing evidence partition");
  const headings = [...blockedEvidence.matchAll(/^##\s+(B-PE-\d{2})\s*$/gm)].map((match) => match[1]);
  if (headings.length !== 10 || new Set(headings).size !== 10 ||
      !authoritativeRequirementIds.every((requirement) => headings.includes("B-" + requirement)))
    throw new Error("blocked-evidence heading partition mismatch");
  // Policy: these are the independently reviewed, requirement-specific blockers.
  // Static equality deliberately rejects keyword-stuffed or appended prose; editing a
  // rationale is a policy change and needs review, not a validator heuristic change.
  const reviewedRationales = {
    "PE-01": "Database identity and session metadata are only supporting observations; they cannot establish the composite production requirement or its authoritative disposition.",
    "PE-02": "Catalog relation existence and estimates cannot establish ledger, rollout, provenance, or branch reachability, so the composite requirement remains blocked.",
    "PE-03": "Catalog definitions and ownership metadata cannot establish the required installed-object provenance and operational correctness, so the composite requirement remains blocked.",
    "PE-04": "Index metadata cannot establish constraints, workload behavior, or lock safety for the composite requirement, so the composite requirement remains blocked.",
    "PE-05": "A bounded count from the fixed target cannot establish business-row correctness or production outcome; the two-phase observation remains blocked.",
    "PE-06": "Authorization and compensation policy cannot be established by database metadata.",
    "PE-07": "Runtime overlap, workers, schedulers, retry/idempotency and recovery cannot be proven by read-only SQL.",
    "PE-08": "Function catalog metadata cannot establish effective capability, dependent releases, writers, or rollback consumers; the composite requirement remains blocked.",
    "PE-09": "Restore validity, monitoring, incident ownership and recovery objectives require operational evidence.",
    "PE-10": "Reviewer identity, authorization and disposition cannot be manufactured by a query. All blockers are BLOCKED_UNKNOWN and require independent non-database attestations."
  };
  if (!setEqual(Object.keys(reviewedRationales), authoritativeRequirementIds))
    throw new Error("R6 reviewed blocker rationale policy mismatch");
  const normalizedRationales = new Map();
  for (const requirement of authoritativeRequirementIds) {
    const narrative = blockedEvidence.match(new RegExp(`^##\\s+B-${requirement}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m"));
    const text = narrative?.[1].replace(/\s+/g, " ").trim() || "";
    if (text.length < 40 || text.split(/\s+/).length < 8 || !/[a-z]{3}/i.test(text) ||
        /^(blocked|unknown|n\/a|none)[\s.;:]*$/i.test(text))
      throw new Error("R6 missing substantive blocker rationale: " + requirement);
    const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (normalizedRationales.has(normalized))
      throw new Error("R6 duplicate blocker rationale: " + requirement);
    normalizedRationales.set(normalized, requirement);
    const reviewed = reviewedRationales[requirement].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (normalized !== reviewed)
      throw new Error("R6 blocker rationale differs from reviewed text: " + requirement);
  }
  validateSql(sql, sectionManifest.sections);
  for (const section of sectionManifest.sections) {
    if (section.statementContract?.noSql) continue;
    for (const statement of runnableStatements(sql, sectionManifest.sections, section))
      if (outerLimit(statement) !== section.resultCaps.rows)
        throw new Error("R5 outer LIMIT/result cap mismatch: " + section.diagnosticId);
  }
  return true;
}

function loadPackage() {
  return {
    catalog: readJson(root + "diagnostic-catalog.json"), coverage: readJson(root + "coverage-matrix.json"),
    procedures: readJson("docs/production-evidence-plan/collection-procedures.json"),
    matrix: readJson("docs/production-evidence-plan/evidence-matrix.json"),
    inventory: readJson("docs/ddl-resolution-readiness/inventory.json"),
    additionalEvidence: readJson("docs/additional-operations-evidence/complete-evidence.json"),
    manifest: readJson(root + "protected-input-manifest.json"), sectionManifest: readJson(root + "sql-section-manifest.json"),
    recordManifest: readJson(root + "record-to-target-manifest.json"),
     sql: readText(root + "diagnostic-queries.sql"), blockedEvidence: readText(root + "blocked-evidence.md"),
     readme: readText(root + "README.md"), executionSafety: readText(root + "execution-safety.md"),
     verification: readText(root + "verification.md")
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const artifacts = loadPackage();
  validatePackage({}, artifacts);
  const expectedFailures = new Map([
    ["missing diagnostic ID", "diagnostic count mismatch"],
    ["duplicate diagnostic ID", "duplicate diagnostic ID"],
    ["missing authoritative ID", "authoritative IDs not covered"],
    ["duplicate authoritative ID", "duplicate coverage record ID"],
    ["wrong procedure reference", "wrong procedure reference"],
    ["wrong evidence reference", "evidence requirement reference"],
    ["missing assignment", "missing record assignment"],
    ["orphan diagnostic", "section/catalog mismatch"],
    ["missing approvalGate", "missing field approvalGate"],
    ["missing timeoutRequirements", "missing field timeoutRequirements"],
    ["missing operationalRisk", "missing field operationalRisk"],
    ["missing purpose", "missing field purpose"],
    ["missing requiredPrivileges", "missing field requiredPrivileges"],
    ["missing expectedOutputSchema", "missing field expectedOutputSchema"],
    ["missing parameters", "missing field parameters"],
    ["missing lockConsiderations", "missing field lockConsiderations"],
    ["missing maximumResultSize", "missing field maximumResultSize"],
    ["missing sensitiveDataConsiderations", "missing field sensitiveDataConsiderations"],
    ["missing abortConditions", "missing field abortConditions"],
    ["missing evidenceValidationCriteria", "missing field evidenceValidationCriteria"],
    ["unsafe stacked SQL", "unsafe SQL statement or stacked statement"],
    ["unsafe mutating function", "mutating or unsafe function"],
    ["unauthorized production result", "unauthorized production result"],
    ["status drift", "status drift"],
    ["owner mismatch", "owner mismatch"],
    ["occurrence mismatch", "occurrence mismatch"],
    ["count mismatch", "literal coverage totals mismatch"],
    ["coverage/blocker overlap", "diagnostic safe-set partition mismatch"],
    ["coverage/blocker gap", "diagnostic safe-set partition mismatch"],
    ["wrong record-target binding", "record-target binding mismatch"],
    ["dynamic target marked covered", "dynamic target incorrectly covered"],
    ["chunk gap", "invalid chunk metadata"],
    ["chunk duplicate", "invalid chunk metadata"],
    ["chunk oversize", "invalid chunk metadata"],
    ["chunk ordering", "invalid chunk metadata"],
    ["chunk digest", "invalid chunk metadata"],
    ["blocked ID in chunk", "invalid chunk metadata"],
    ["P-02 namespace contract omission", "P-02 SQL namespace/relation binding mismatch"],
    ["P-08 function contract omission", "P-08 SQL schema/function binding mismatch"],
    ["undeclared parameter", "sparse or undeclared SQL parameter positions"],
    ["missing parameter", "statement contract parameter missing"],
    ["sparse parameter gap across contracts and SQL", "sparse or undeclared SQL parameter positions"],
    ["missing output alias", "duplicate or unordered output schema"],
    ["output type mismatch", "attribution output type mismatch"],
    ["joined output nullability drift", "output nullability contract mismatch"],
    ["target-bound SQL parameter omission", "SQL section target binding mismatch: P-02"],
    ["chunk-scoped SQL parameter omission", "SQL section chunk scope mismatch: P-01"],
    ["P-02 SQL namespace omission", "P-02 SQL namespace/relation binding mismatch"],
    ["P-08 SQL function omission", "P-08 SQL schema/function binding mismatch"],
    ["P-05 preflight gate omission", "P-05 preflight approval gate missing"],
    ["P-05 target broadening", "P-05 fixed target scan contract"],
    ["P-05 row privacy regression", "unapproved function: to_jsonb"],
    ["D-04 relationship proof omission", "P-04 object_found must prove index relationship"],
    ["P-05 phase order reversal", "P-05 preflight statement contract"],
    ["P-05 preflight output break", "P-05 preflight statement contract"],
    ["nullable allow-list WHERE regression", "P-02 allow-list placement"],
    ["duplicate output column", "duplicate or unordered output schema"],
    ["invalid keyword identity marked concrete", "record-target binding mismatch"],
    ["D-04 index-parent join omission", "P-04 index/parent join mismatch"],
    ["D-04 parent output omission", "P-04 index/parent join mismatch"],
    ["D-04 missing parent binding", "record-target binding mismatch"],
    ["protected hash drift", "historical baseline drift"],
    ["N7 current protected path removed", "protected-path inventory mismatch"],
    ["N8 historical baseline changed", "historical baseline drift"],
    ["currentInputs hash drift", "protected hash drift: docs/additional-operations-evidence/bg-data.json"],
    ["swapped object_found output position", "section-specific output order mismatch"],
    ["D-07 activity cross join regression", "activity scope preservation/output order mismatch"],
    ["unknown evidence satisfaction", "unknown or missing diagnostic status"],
    ["missing diagnostic status", "unknown or missing diagnostic status"],
    ["unknown catalog status", "unknown or invalid catalog field/status"],
    ["unknown catalog field", "unknown diagnostic catalog field"],
    ["missing blocker rationale", "R6 missing substantive blocker rationale: PE-06"],
    ["D-03 nondeterministic attribute selection", "D-03 nondeterministic selection"],
    ["D-05 scan result cap drift", "R5 diagnostic maximumResultSize mismatch: D-05"],
    ["false lock safety claim", "R3 affirmative no-lock/no-block claim: D-01"],
    ["unsupported redaction claim", "R2 unsupported redaction claim: diagnostic-catalog.json"],
    ["D-07 missing outer result cap", "R5 outer LIMIT/result cap mismatch: D-07"],
    ["README terminology drift", "diagnostic/procedure terminology drift"],
    ["Git provenance overclaim", "Git provenance documentation drift"],
    ...["PE-01", "PE-02", "PE-03", "PE-04", "PE-05", "PE-06", "PE-07", "PE-08", "PE-09", "PE-10"]
      .map((requirement) => ["missing rationale " + requirement, "R6 missing substantive blocker rationale: " + requirement]),
    ["R1 missing P-05 preflight LIMIT", "R1 P-05 preflight outer LIMIT 1 missing"],
    ["R1 missing P-05 scan LIMIT", "R1 P-05 scan outer LIMIT 1 missing"],
    ["R2 README redact morphology", "R2 unsupported redaction claim: README.md"],
    ["R2 verification redact morphology", "R2 unsupported redaction claim: verification.md"],
    ["R2 execution-safety redact morphology", "R2 unsupported redaction claim: execution-safety.md"],
    ["R2 catalog redact morphology", "R2 unsupported redaction claim: diagnostic-catalog.json"],
    ["R3 blocking impossible claim", "R3 affirmative no-lock/no-block claim: D-01"],
    ["R4 D-06 purpose drift", "R4 D-06 non-database/no-SQL purpose drift"],
    ["R5 D-06 nonzero noSql cap", "R5 noSql result cap/statement mismatch: D-06"],
    ["R5 D-06 maximum result claim", "R5 diagnostic maximumResultSize mismatch: D-06"],
    ["R5 D-08 outer LIMIT drift", "R5 outer LIMIT/result cap mismatch: D-08"],
    ["R5 D-08 maximum result claim", "R5 diagnostic maximumResultSize mismatch: D-08"],
    ["R5 catalog execution cap drift", "R5 diagnostic execution cap mismatch: D-08"],
    ["R5 noSql catalog cap drift", "R5 diagnostic execution cap mismatch: D-06"],
    ["R5 preflight phase cap drift", "R5 phase result cap mismatch: D-05"],
    ["R5 scan phase cap drift", "R5 phase result cap mismatch: D-05"],
    ["R6 nonsense rationale", "R6 blocker rationale differs from reviewed text: PE-05"],
    ["R6 copied rationale", "R6 duplicate blocker rationale: PE-02"],
    ["R6 keyword-stuffed rationale", "R6 blocker rationale differs from reviewed text: PE-05"],
    ["R6 appended garbage rationale", "R6 blocker rationale differs from reviewed text: PE-05"],
    ["R8 README local collection path", "R8 external authoritative collection-procedures path missing"],
    ["R9 P-05 scan instruction omission", "R9 P-05 scan preflight instruction missing"],
    ["R9 P-05 preflight scope weakening", "R9 P-05 preflight fixed target scope missing"],
    ["R9 P-05 scan scope weakening", "R9 P-05 scan fixed target scope missing"],
    ["R3 SQL never-acquires/cannot-block claim", "R3 affirmative no-lock/no-block claim: D-01"]
  ]);
  let negativeCount = 0;
  const baselineArtifactDigest = digest(JSON.stringify(artifacts));
  const defect = (name, mutate) => {
    assert.ok(expectedFailures.has(name), name + " must declare an exact expected rejection");
    negativeCount += 1;
    const candidate = clone(artifacts); mutate(candidate);
    assert.notEqual(digest(JSON.stringify(candidate)), baselineArtifactDigest, name + " fixture did not change the baseline candidate");
    assert.throws(() => validatePackage({}, candidate), (error) => {
      assert.equal(error.message, expectedFailures.get(name), name + " rejected by wrong rule");
      return true;
    }, name);
  };
  defect("missing diagnostic ID", (a) => a.catalog.diagnostics.pop());
  defect("duplicate diagnostic ID", (a) => { a.catalog.diagnostics[1].diagnosticId = a.catalog.diagnostics[0].diagnosticId; });
  defect("missing authoritative ID", (a) => { a.coverage.records[0].recordId = "missing"; });
  defect("duplicate authoritative ID", (a) => { a.coverage.records[1].recordId = a.coverage.records[0].recordId; });
  defect("wrong procedure reference", (a) => { a.catalog.diagnostics[0].procedureId = "P-99"; });
  defect("wrong evidence reference", (a) => { a.catalog.diagnostics[1].evidenceRequirementIds = ["PE-99"]; });
  defect("missing assignment", (a) => { a.coverage.records[0].diagnosticIds = []; });
  defect("orphan diagnostic", (a) => { a.sectionManifest.sections.push({ diagnosticId: "D-ORPHAN", exactRecordIds: [], blockedRecordIds: [], evidenceRequirementIds: [], sqlMarker: "-- ORPHAN" }); });
  for (const field of ["approvalGate","timeoutRequirements","operationalRisk","purpose","requiredPrivileges","expectedOutputSchema","parameters","lockConsiderations","maximumResultSize","sensitiveDataConsiderations","abortConditions","evidenceValidationCriteria"])
    defect("missing " + field, (a) => { a.catalog.diagnostics[0][field] = null; });
  defect("unsafe stacked SQL", (a) => { a.sql += "; UPDATE x SET y=1;"; });
  defect("unsafe mutating function", (a) => { a.sql = "SELECT pg_sleep(1);\n" + a.sql; });
  defect("unauthorized production result", (a) => { a.coverage.productionFacts = "KNOWN"; });
  defect("status drift", (a) => { a.coverage.records[0].status = "RESOLVED"; });
  defect("owner mismatch", (a) => { a.coverage.ownerNames[0] = "wrong"; });
  defect("occurrence mismatch", (a) => { a.coverage.occurrenceIds.pop(); });
  defect("count mismatch", (a) => { a.coverage.totals.mappingIds = 1; });
  defect("coverage/blocker overlap", (a) => { a.sectionManifest.sections[4].blockedRecordIds.push(a.sectionManifest.sections[4].exactRecordIds[0]); });
  defect("coverage/blocker gap", (a) => { a.sectionManifest.sections[4].blockedRecordIds.pop(); });
  defect("wrong record-target binding", (a) => { a.recordManifest.bindings[0].operationType = "wrong"; });
  defect("dynamic target marked covered", (a) => { const binding = a.recordManifest.bindings.find((item) => item.targetStatus === "BLOCKED_DYNAMIC_IDENTITY"); binding.targetStatus = "CONCRETE_APPROVED_STATIC_TARGET"; });
  defect("chunk gap", (a) => { a.sectionManifest.sections[1].chunks.push({ recordIds: [], targetBindingIds: [], chunkIndex: 0, chunkCount: 1, recordIdDigest: "" }); });
  defect("chunk duplicate", (a) => { a.sectionManifest.sections[1].chunks.push({ recordIds: [a.sectionManifest.sections[1].blockedRecordIds[0], a.sectionManifest.sections[1].blockedRecordIds[0]], targetBindingIds: [], chunkIndex: 0, chunkCount: 1, recordIdDigest: "" }); });
  defect("chunk oversize", (a) => { a.sectionManifest.sections[1].chunks.push({ recordIds: Array(101).fill(a.sectionManifest.sections[1].blockedRecordIds[0]), targetBindingIds: [], chunkIndex: 0, chunkCount: 1, recordIdDigest: "" }); });
  defect("chunk ordering", (a) => { a.sectionManifest.sections[1].chunks.push({ recordIds: [a.sectionManifest.sections[1].blockedRecordIds[1], a.sectionManifest.sections[1].blockedRecordIds[0]], targetBindingIds: [], chunkIndex: 0, chunkCount: 1, recordIdDigest: "" }); });
  defect("chunk digest", (a) => { a.sectionManifest.sections[1].chunks.push({ recordIds: [a.sectionManifest.sections[1].blockedRecordIds[0]], targetBindingIds: [], chunkIndex: 0, chunkCount: 1, recordIdDigest: "0".repeat(64) }); });
  defect("blocked ID in chunk", (a) => { const section = a.sectionManifest.sections[1]; section.chunks.push({ recordIds: [section.blockedRecordIds[0]], targetBindingIds: [], chunkIndex: 0, chunkCount: 1, recordIdDigest: "" }); });
  defect("P-02 namespace contract omission", (a) => { a.sql = a.sql.replace("n.nspname=ANY($2::text[])", "TRUE AND $2::text[] IS NOT NULL"); });
  defect("P-08 function contract omission", (a) => { a.sql = a.sql.replace("p.proname=ANY($3::text[])", "TRUE AND $3::text[] IS NOT NULL"); });
  defect("undeclared parameter", (a) => {
    a.sectionManifest.sections[0].parameterContract[0].position = 99;
    a.catalog.diagnostics[0].parameterContract[0].position = 99;
  });
  defect("missing parameter", (a) => {
    a.sectionManifest.sections[0].parameterContract.pop();
    a.catalog.diagnostics[0].parameterContract.pop();
  });
  defect("sparse parameter gap across contracts and SQL", (a) => {
    a.sectionManifest.sections[0].parameterContract[1].position = 4;
    a.catalog.diagnostics[0].parameterContract[1].position = 4;
    a.sql = a.sql.replace(/\$2::text\[\]/, "$4::text[]");
  });
  defect("missing output alias", (a) => {
    a.sectionManifest.sections[0].outputSchema[0].columnName = "renamed";
    a.catalog.diagnostics[0].outputSchema[0].columnName = "renamed";
  });
  defect("output type mismatch", (a) => {
    a.sectionManifest.sections[0].outputSchema[0].postgresType = "integer";
    a.catalog.diagnostics[0].outputSchema[0].postgresType = "integer";
  });
  defect("joined output nullability drift", (a) => {
    for (const artifact of [a.catalog.diagnostics.find((d) => d.procedureId === "P-03"), a.sectionManifest.sections.find((d) => d.procedureId === "P-03")])
      artifact.outputSchema.find((column) => column.columnName === "relname").nullable = false;
  });
  defect("target-bound SQL parameter omission", (a) => { a.sql = a.sql.replace("jsonb_to_recordset($5::jsonb)", "jsonb_to_recordset(coalesce($5::jsonb,'[]'::jsonb))"); });
  defect("chunk-scoped SQL parameter omission", (a) => { a.sql = a.sql.replace("unnest($2::text[])", "unnest(coalesce($2::text[],ARRAY[]::text[]))"); });
  defect("P-02 SQL namespace omission", (a) => { a.sql = a.sql.replace("n.nspname=ANY($2::text[])", "TRUE AND $2::text[] IS NOT NULL"); });
  defect("P-08 SQL function omission", (a) => { a.sql = a.sql.replace("p.proname=ANY($3::text[])", "TRUE AND $3::text[] IS NOT NULL"); });
  defect("P-05 preflight gate omission", (a) => { delete a.sectionManifest.sections.find((s) => s.procedureId === "P-05").statementContract.preflightResultGate; });
  defect("P-05 target broadening", (a) => { a.sql = a.sql.replace(/public\.shipping_rules/g, "public.other_table"); });
  defect("P-05 row privacy regression", (a) => { a.sql = a.sql.replace("observed_rows_capped_at_two", "to_jsonb(scan.*)"); });
  defect("D-04 relationship proof omission", (a) => { a.sql = a.sql.replace("(ix.indexrelid IS NOT NULL) AS object_found", "(i.oid IS NOT NULL) AS object_found"); });
  defect("P-05 phase order reversal", (a) => {
    const sql = a.sql, pre = sql.indexOf("-- D-05 PREFLIGHT"), scan = sql.indexOf("-- D-05 SCAN");
    const end = sql.indexOf("-- D-06", scan);
    a.sql = sql.slice(0, pre) + sql.slice(scan, end) + sql.slice(pre, scan) + sql.slice(end);
  });
  defect("P-05 preflight output break", (a) => { a.sql = a.sql.replace("'preflight'::text AS phase", "'wrong'::text AS phase"); });
  defect("nullable allow-list WHERE regression", (a) => { a.sql = a.sql.replace("AND c.relname=ANY($3::text[])", "WHERE c.relname=ANY($3::text[])"); });
  defect("duplicate output column", (a) => { a.sectionManifest.sections[1].outputColumns.push("object_found"); });
  defect("invalid keyword identity marked concrete", (a) => {
    const binding = a.recordManifest.bindings.find((item) => item.targetStatus === "CONCRETE_APPROVED_STATIC_TARGET");
    binding.objectGroups[0].identity.name = "IF";
  });
  defect("D-04 index-parent join omission", (a) => { a.sql = a.sql.replace("c.relname=scope.parent_name", "c.relname=scope.object_name"); });
  defect("D-04 parent output omission", (a) => { a.sql = a.sql.replace("c.relname=scope.parent_name", "c.relname=scope.object_name"); });
  defect("D-04 missing parent binding", (a) => {
    const section = a.sectionManifest.sections.find((item) => item.procedureId === "P-04");
    const binding = a.recordManifest.bindings.find((item) => item.recordId === section.blockedRecordIds[0]);
    const group = binding.objectGroups.find((item) => item.identity?.kind === "index");
    group.identity.parent = "";
  });
  defect("protected hash drift", (a) => { a.manifest.inputs[Object.keys(a.manifest.inputs)[0]] = "0".repeat(64); });
  defect("N7 current protected path removed", (a) => { delete a.manifest.currentInputs[Object.keys(a.manifest.inputs)[0]]; });
  defect("N8 historical baseline changed", (a) => { a.manifest.inputs[Object.keys(a.manifest.inputs)[0]] = "1".repeat(64); });
  defect("currentInputs hash drift", (a) => { a.manifest.currentInputs[Object.keys(a.manifest.inputs)[0]] = "0".repeat(64); });
  defect("swapped object_found output position", (a) => {
    for (const artifact of [a.catalog.diagnostics.find((d) => d.procedureId === "P-02"), a.sectionManifest.sections.find((d) => d.procedureId === "P-02")]) {
      [artifact.outputColumns[0], artifact.outputColumns[3]] = [artifact.outputColumns[3], artifact.outputColumns[0]];
      [artifact.outputSchema[0], artifact.outputSchema[3]] = [artifact.outputSchema[3], artifact.outputSchema[0]];
    }
  });
  defect("D-07 activity cross join regression", (a) => { a.sql = a.sql.replace("activity AS (", "summary AS ("); });
  defect("unknown evidence satisfaction", (a) => { a.catalog.diagnostics[0].evidenceSatisfaction = "UNKNOWN"; });
  defect("missing diagnostic status", (a) => { delete a.catalog.diagnostics[0].status; });
  defect("unknown catalog status", (a) => { a.catalog.status = "UNKNOWN"; });
  defect("unknown catalog field", (a) => { a.catalog.diagnostics[0].observedProductionResult = "fabricated"; });
  defect("missing blocker rationale", (a) => { a.blockedEvidence = a.blockedEvidence.replace("Authorization and compensation policy cannot be established by database metadata.", "short"); });
  defect("D-03 nondeterministic attribute selection", (a) => { a.sql = a.sql.replace("ORDER BY ad.adnum ASC ", ""); });
  defect("D-05 scan result cap drift", (a) => { a.sectionManifest.sections.find((s) => s.procedureId === "P-05").resultCaps.rows = 1000; });
  defect("false lock safety claim", (a) => { a.catalog.diagnostics[0].lockConsiderations = "No locks are possible."; });
  defect("unsupported redaction claim", (a) => { a.catalog.diagnostics.find((d) => d.diagnosticId === "D-10").sensitiveDataConsiderations = "Return redacted definitions."; });
  defect("D-07 missing outer result cap", (a) => { a.sql = a.sql.replace("FROM scope CROSS JOIN activity LIMIT 1000", "FROM scope CROSS JOIN activity"); });
  defect("README terminology drift", (a) => { a.readme = a.readme.replace("diagnostic designs (D-01 through D-10)", "designs"); });
  defect("Git provenance overclaim", (a) => { a.verification = a.verification.replace(/The automatically attached review input[\s\S]*/, ""); });
  for (const requirement of ["PE-01", "PE-02", "PE-03", "PE-04", "PE-05", "PE-06", "PE-07", "PE-08", "PE-09", "PE-10"])
    defect("missing rationale " + requirement, (a) => {
      a.blockedEvidence = a.blockedEvidence.replace(new RegExp(`(^##\\s+B-${requirement}\\s*$)[\\s\\S]*?(?=^##\\s|(?![\\s\\S]))`, "m"), "$1\nshort\n");
    });
  defect("R1 missing P-05 preflight LIMIT", (a) => {
    a.sql = a.sql.replace("scope.object_name='shipping_rules' LIMIT 1;", "scope.object_name='shipping_rules';");
  });
  defect("R1 missing P-05 scan LIMIT", (a) => {
    const scan = a.sql.indexOf("-- D-05 SCAN");
    a.sql = a.sql.slice(0, scan) + a.sql.slice(scan).replace(" LIMIT 1;", ";");
  });
  defect("R2 README redact morphology", (a) => { a.readme += "\nOutputs are redactable.\n"; });
  defect("R2 verification redact morphology", (a) => { a.verification += "\nValues were redactingly transformed.\n"; });
  defect("R2 execution-safety redact morphology", (a) => { a.executionSafety += "\nThe executor redacts values.\n"; });
  defect("R2 catalog redact morphology", (a) => {
    a.catalog.diagnostics[0].sensitiveDataConsiderations = "Return redaction-derived metadata.";
  });
  defect("R3 blocking impossible claim", (a) => {
    a.catalog.diagnostics[0].lockConsiderations = "Blocking is impossible; lock_timeout remains configured.";
  });
  defect("R4 D-06 purpose drift", (a) => {
    a.catalog.diagnostics.find((item) => item.diagnosticId === "D-06").purpose = "Collect policy facts.";
  });
  defect("R5 D-06 nonzero noSql cap", (a) => {
    a.sectionManifest.sections.find((item) => item.diagnosticId === "D-06").resultCaps.rows = 1;
  });
  defect("R5 D-06 maximum result claim", (a) => {
    a.catalog.diagnostics.find((item) => item.diagnosticId === "D-06").maximumResultSize = "1 SQL row; no SQL statement or SQL output.";
  });
  defect("R5 D-08 outer LIMIT drift", (a) => { a.sql = a.sql.replace("LIMIT 500;", "LIMIT 1000;"); });
  defect("R5 catalog execution cap drift", (a) => {
    a.catalog.diagnostics.find((d) => d.diagnosticId === "D-08").executionEnvelope.resultCaps.rows = 1000;
  });
  defect("R5 noSql catalog cap drift", (a) => {
    a.catalog.diagnostics.find((d) => d.diagnosticId === "D-06").executionEnvelope.resultCaps.rows = 1000;
  });
  defect("R5 preflight phase cap drift", (a) => {
    a.sectionManifest.sections.find((s) => s.diagnosticId === "D-05").statementContract.phases[0].maxRows = 2;
  });
  defect("R5 scan phase cap drift", (a) => {
    a.sectionManifest.sections.find((s) => s.diagnosticId === "D-05").statementContract.phases[1].maxRows = 2;
  });
  defect("R5 D-08 maximum result claim", (a) => {
    a.catalog.diagnostics.find((item) => item.diagnosticId === "D-08").maximumResultSize = "1000 rows or 2 MiB per SQL statement, whichever comes first.";
  });
  defect("R6 nonsense rationale", (a) => {
    a.blockedEvidence = a.blockedEvidence.replace(
      /(^##\s+B-PE-05\s*$)[\s\S]*?(?=^##\s|(?![\s\S]))/m,
      "$1\nLavender lanterns drift silently through velvet corridors while cheerful pebbles applaud distant umbrellas.\n"
    );
  });
  defect("R6 copied rationale", (a) => {
    const source = a.blockedEvidence.match(/^##\s+B-PE-01\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)[1];
    a.blockedEvidence = a.blockedEvidence.replace(
      /(^##\s+B-PE-02\s*$)[\s\S]*?(?=^##\s|(?![\s\S]))/m,
      "$1" + source
    );
  });
  defect("R6 keyword-stuffed rationale", (a) => {
    a.blockedEvidence = a.blockedEvidence.replace(
      /(^##\s+B-PE-05\s*$)[\s\S]*?(?=^##\s|(?![\s\S]))/m,
      "$1\nBounded count target bounded count target, while lavender umbrellas sing over marble corridors and lanterns.\n"
    );
  });
  defect("R6 appended garbage rationale", (a) => {
    a.blockedEvidence = a.blockedEvidence.replace(
      "A bounded count from the fixed target cannot establish business-row correctness or production outcome; the two-phase observation remains blocked.",
      "A bounded count from the fixed target cannot establish business-row correctness or production outcome; the two-phase observation remains blocked. Lavender umbrellas sing."
    );
  });
  defect("R8 README local collection path", (a) => {
    a.readme = a.readme.replace("docs/production-evidence-plan/collection-procedures.json", "collection-procedures.json");
  });
  defect("R9 P-05 scan instruction omission", (a) => {
    a.sql = a.sql.replace("prepare only after preflight target_exists=true", "prepare after preflight");
  });
  defect("R9 P-05 preflight scope weakening", (a) => {
    a.sql = a.sql.replace(
      "WHERE scope.schema_name='public' AND scope.object_name='shipping_rules' LIMIT 1;",
      "WHERE scope.schema_name='public' LIMIT 1;"
    );
  });
  defect("R9 P-05 scan scope weakening", (a) => {
    const scan = a.sql.indexOf("-- D-05 SCAN");
    a.sql = a.sql.slice(0, scan) + a.sql.slice(scan).replace(
      "WHERE scope.schema_name='public' AND scope.object_name='shipping_rules' LIMIT 1;",
      "WHERE scope.schema_name='public' LIMIT 1;"
    );
  });
  defect("R3 SQL never-acquires/cannot-block claim", (a) => {
    a.catalog.diagnostics[0].lockConsiderations += " This SQL never acquires database locks and cannot block.";
  });
  assert.equal(negativeCount, expectedFailures.size, "every negative fixture must declare its exact expected rejection");
  console.log("PASS: reusable authoritative validator and " + negativeCount + " exact-rule deep-cloned negative cases");
}