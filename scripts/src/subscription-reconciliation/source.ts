import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const STARTUP_SOURCE_SHA256 = "981434746172a7985ce9f63cff2e03e972e6b6c1a2d1f533f3a5194298058597";
export const OPERATION_NAMES = [
  "clone_shared_plan", "relink_current_education_plan", "relabel_education_only_plan",
  "infer_ranked_limits", "insert_fallback_tiers", "normalize_named_tiers",
  "deactivate_nonpositive_education_plans", "rewrite_limits_courses", "fill_current_snapshots",
] as const;

/** Evidence extraction only. Do not import or execute startup owners/default pools. */
export function originalPlanOperations() {
  const path = fileURLToPath(new URL("../../../artifacts/api-server/src/lib/business-growth-schema.ts", import.meta.url));
  const source = readFileSync(path, "utf8");
  if (createHash("sha256").update(source).digest("hex") !== STARTUP_SOURCE_SHA256) {
    throw new Error("Startup source changed; review historical operation evidence before replay");
  }
  const start = source.indexOf("// A legacy plan can be used by both products.");
  const end = source.indexOf("`ALTER TABLE ${s}.courses ADD COLUMN IF NOT EXISTS subscription_suspended", start);
  if (start < 0 || end < start) throw new Error("Historical SQL boundary missing");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const operations: { sql: string; line: number }[] = [];
  function visit(node: ts.Node) {
    const position = node.getStart(ast);
    if (position >= start && position < end && ts.isTemplateExpression(node)) {
      if (node.templateSpans.some((span) => !ts.isIdentifier(span.expression) || span.expression.text !== "s")) {
        throw new Error("Unexpected dynamic SQL in historical evidence");
      }
      const sql = node.head.text + node.templateSpans.map((span) => "public" + span.literal.text).join("");
      if (/^\s*(INSERT|UPDATE|WITH)\b/iu.test(sql)) {
        operations.push({ sql, line: ast.getLineAndCharacterOfPosition(position).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (operations.length !== OPERATION_NAMES.length) throw new Error("Historical operation count changed");
  return operations.map((operation, index) => ({ ...operation, name: OPERATION_NAMES[index]! }));
}