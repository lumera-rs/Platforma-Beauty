import ts from "typescript";

import type { DestructiveHarnessRegistration } from "./destructive-harness-registry";

type GuardCallRange = {
  end: number;
  start: number;
};

const typescriptGuardExport = "assertDestructiveTestRuntimeAllowed";
const shellGuardFunction = "assert_destructive_test_runtime_allowed";

function isGuardModule(moduleName: string): boolean {
  return moduleName === "@workspace/db/destructive-test-runtime"
    || /(?:^|\/)destructive-test-runtime(?:\.[cm]?js)?$/.test(moduleName);
}

function typescriptGuardBindings(sourceFile: ts.SourceFile): Set<string> {
  const bindings = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && isGuardModule(statement.moduleSpecifier.text)
      && statement.importClause?.namedBindings
      && ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        if ((element.propertyName?.text ?? element.name.text) === typescriptGuardExport) {
          bindings.add(element.name.text);
        }
      }
      continue;
    }

    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isObjectBindingPattern(declaration.name) || !declaration.initializer) continue;
      let initializer: ts.Expression = declaration.initializer;
      if (ts.isAwaitExpression(initializer)) initializer = initializer.expression;
      if (
        !ts.isCallExpression(initializer)
        || initializer.expression.kind !== ts.SyntaxKind.ImportKeyword
        || initializer.arguments.length !== 1
        || !ts.isStringLiteral(initializer.arguments[0])
        || !isGuardModule(initializer.arguments[0].text)
      ) {
        continue;
      }
      for (const element of declaration.name.elements) {
        if (
          !element.dotDotDotToken
          && ts.isIdentifier(element.name)
          && (!element.propertyName || ts.isIdentifier(element.propertyName))
          && (element.propertyName?.text ?? element.name.text) === typescriptGuardExport
        ) {
          bindings.add(element.name.text);
        }
      }
    }
  }

  return bindings;
}

function typescriptGuardCallRanges(source: string, sourcePath: string): GuardCallRange[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bindings = typescriptGuardBindings(sourceFile);
  const ranges: GuardCallRange[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && bindings.has(node.expression.text)
    ) {
      ranges.push({ start: node.getStart(sourceFile), end: node.getEnd() });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return ranges;
}

function shellGuardCallRanges(source: string): GuardCallRange[] {
  const ranges: GuardCallRange[] = [];
  let offset = 0;
  for (const line of source.split(/(?<=\n)/)) {
    const lineWithoutNewline = line.replace(/\r?\n$/, "");
    const commentIndex = lineWithoutNewline.indexOf("#");
    const executable = commentIndex < 0
      ? lineWithoutNewline
      : lineWithoutNewline.slice(0, commentIndex);
    const match = new RegExp(`^(\\s*)${shellGuardFunction}(?=\\s|$).*$`).exec(executable);
    if (match) {
      ranges.push({
        start: offset + match[1].length,
        end: offset + executable.length,
      });
    }
    offset += line.length;
  }
  return ranges;
}

export function sharedDestructiveGuardCallRanges(
  registration: DestructiveHarnessRegistration,
  source: string,
): readonly GuardCallRange[] {
  return registration.guardContract === "typescript"
    ? typescriptGuardCallRanges(source, registration.sourcePath)
    : shellGuardCallRanges(source);
}

export function assertRegisteredHarnessInvokesSharedGuard(
  registration: DestructiveHarnessRegistration,
  source: string,
): void {
  if (sharedDestructiveGuardCallRanges(registration, source).length === 0) {
    throw new Error(`${registration.name} must invoke the shared destructive-runtime guard`);
  }
}

export function removeOnlySharedDestructiveGuardCalls(
  registration: DestructiveHarnessRegistration,
  source: string,
): string {
  const ranges = [...sharedDestructiveGuardCallRanges(registration, source)]
    .sort((left, right) => right.start - left.start);
  if (ranges.length === 0) {
    throw new Error(`${registration.name} has no shared destructive-runtime guard call to remove`);
  }
  let mutated = source;
  for (const range of ranges) {
    mutated = `${mutated.slice(0, range.start)}${mutated.slice(range.end)}`;
  }
  return mutated;
}