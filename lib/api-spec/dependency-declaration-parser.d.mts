import type ts from "typescript";

export const MAX_DEPENDENCY_DECLARATION_BYTES: number;
export const MAX_DEPENDENCY_DECLARATION_TOKENS: number;
export const MAX_DEPENDENCY_DECLARATION_NESTING_DEPTH: number;

export function parseDependencyDeclarations(options: {
  declarations: string;
  fileName: string;
  label: string;
}): ts.SourceFile;