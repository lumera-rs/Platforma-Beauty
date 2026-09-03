import ts from "typescript";

function formatDependencyDiagnostic(sourceFile, diagnostic, label) {
  const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  return `${label} must contain valid TypeScript syntax: TS${diagnostic.code} at ${position.line + 1}:${position.character + 1}: ${message}`;
}

export function parseDependencyDeclarations({
  declarations,
  fileName,
  label,
}) {
  const sourceFile = ts.createSourceFile(
    fileName,
    declarations,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostic = sourceFile.parseDiagnostics[0];
  if (diagnostic) {
    throw new Error(formatDependencyDiagnostic(sourceFile, diagnostic, label));
  }
  return sourceFile;
}