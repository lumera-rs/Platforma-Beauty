import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../pages/business-education.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile(
  "business-education.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function variableInitializer(name: string): ts.Expression {
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
    ) {
      initializer = node.initializer;
      return;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  assert.ok(initializer, `Expected ${name} to remain defined`);
  return initializer;
}

function analyticsCalls(node: ts.Node, helper: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (candidate: ts.Node) => {
    if (
      ts.isCallExpression(candidate)
      && ts.isIdentifier(candidate.expression)
      && candidate.expression.text === helper
    ) {
      calls.push(candidate);
    }
    candidate.forEachChild(visit);
  };
  visit(node);
  return calls;
}

test("the dispute form opening remains connected to analytics", () => {
  const calls = analyticsCalls(variableInitializer("openReportDialog"), "trackEducationDisputeFormOpened");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].arguments.length, 0);
});

test("every dispute submission UI branch records its privacy-safe outcome", () => {
  const submitDispute = variableInitializer("submitDispute");
  const submitSource = submitDispute.getText(sourceFile);
  const calls = analyticsCalls(submitDispute, "trackEducationDisputeSubmission");

  assert.deepEqual(
    calls.map((call) => call.arguments.map((argument) => argument.getText(sourceFile))),
    [["\"created\""], ["\"existing\""], ["\"error\""]],
    "The UI must emit exactly one literal outcome per terminal submission branch",
  );

  assert.match(
    submitSource,
    /await fetchNativeJson[\s\S]*trackEducationDisputeSubmission\("created"\)/,
    "A newly created dispute must record created",
  );
  assert.match(
    submitSource,
    /error\.status === 409 && existingDispute[\s\S]*trackEducationDisputeSubmission\("existing"\)/,
    "A 409 response carrying an existing dispute must record existing",
  );
  assert.match(
    submitSource,
    /}\s*else\s*{\s*trackEducationDisputeSubmission\("error"\)/,
    "The remaining failure branch must record error",
  );

  for (const call of calls) {
    assert.equal(call.arguments.length, 1);
    assert.ok(ts.isStringLiteral(call.arguments[0]));
  }
  assert.doesNotMatch(
    calls.map((call) => call.getText(sourceFile)).join("\n"),
    /reason|details|reportingEnrollment|enrollmentId|dispute\.id/,
    "Reasons, descriptions, and identifiers must never enter the analytics payload",
  );
});