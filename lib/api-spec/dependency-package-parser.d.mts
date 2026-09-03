export interface ParseDependencyPackageJsonOptions {
  contents: string;
  label: string;
}

export const MAX_DEPENDENCY_PACKAGE_BYTES: number;
export const MAX_DEPENDENCY_PACKAGE_NESTING_DEPTH: number;

export function parseDependencyPackageJson(
  options: ParseDependencyPackageJsonOptions,
): unknown;