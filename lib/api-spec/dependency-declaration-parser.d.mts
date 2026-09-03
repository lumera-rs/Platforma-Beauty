import type ts from "typescript";

export function parseDependencyDeclarations(options: {
  declarations: string;
  fileName: string;
  label: string;
}): ts.SourceFile;