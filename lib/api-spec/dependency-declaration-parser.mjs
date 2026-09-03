import ts from "typescript";

// These limits bound all work performed before and by the TypeScript parser.
// The scanner is linear in the UTF-8-size-limited input; token count bounds
// parser work, while delimiter depth bounds parser recursion.
export const MAX_DEPENDENCY_DECLARATION_BYTES = 2 * 1024 * 1024;
export const MAX_DEPENDENCY_DECLARATION_TOKENS = 50_000;
export const MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH = 128;

const OPEN_DELIMITERS = new Set([
  ts.SyntaxKind.OpenBraceToken,
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBracketToken,
  ts.SyntaxKind.LessThanToken,
]);
const CLOSE_DELIMITERS = new Set([
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.GreaterThanToken,
]);
const RECURSIVE_TYPE_TOKENS = new Set([
  ts.SyntaxKind.EqualsGreaterThanToken,
  ts.SyntaxKind.QuestionToken,
  ts.SyntaxKind.KeyOfKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.UniqueKeyword,
  ts.SyntaxKind.InferKeyword,
  ts.SyntaxKind.TypeOfKeyword,
]);

function throwLimitError(label, code) {
  throw new Error(`${label} is invalid: ${code}`);
}

function enforceDependencyDeclarationLimits(declarations, label) {
  if (Buffer.byteLength(declarations, "utf8") > MAX_DEPENDENCY_DECLARATION_BYTES) {
    throwLimitError(label, "DEPENDENCY_DECLARATIONS_TOO_LARGE");
  }

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    declarations,
  );
  let tokenCount = 0;
  let nestingDepth = 0;
  let declarationComplexity = 0;
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    tokenCount += 1;
    if (tokenCount > MAX_DEPENDENCY_DECLARATION_TOKENS) {
      throwLimitError(label, "DEPENDENCY_DECLARATIONS_TOO_MANY_TOKENS");
    }
    if (token === ts.SyntaxKind.SemicolonToken) {
      declarationComplexity = 0;
    } else if (RECURSIVE_TYPE_TOKENS.has(token)) {
      declarationComplexity += 1;
      if (declarationComplexity > MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH) {
        throwLimitError(label, "DEPENDENCY_DECLARATIONS_TOO_DEEP");
      }
    }
    if (OPEN_DELIMITERS.has(token)) {
      nestingDepth += 1;
      if (nestingDepth > MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH) {
        throwLimitError(label, "DEPENDENCY_DECLARATIONS_TOO_DEEP");
      }
    } else if (CLOSE_DELIMITERS.has(token) && nestingDepth > 0) {
      nestingDepth -= 1;
    }
  }
}

function formatDependencyDiagnostic(sourceFile, diagnostic, label) {
  const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
  return `${label} is invalid: DEPENDENCY_DECLARATIONS_INVALID_SYNTAX TS${diagnostic.code} at ${position.line + 1}:${position.character + 1}`;
}

export function parseDependencyDeclarations({
  declarations,
  fileName,
  label,
}) {
  enforceDependencyDeclarationLimits(declarations, label);
  let sourceFile;
  try {
    sourceFile = ts.createSourceFile(
      fileName,
      declarations,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
  } catch (error) {
    if (error instanceof RangeError) {
      throwLimitError(label, "DEPENDENCY_DECLARATIONS_TOO_DEEP");
    }
    throw error;
  }
  const diagnostic = sourceFile.parseDiagnostics[0];
  if (diagnostic) {
    throw new Error(formatDependencyDiagnostic(sourceFile, diagnostic, label));
  }
  return sourceFile;
}