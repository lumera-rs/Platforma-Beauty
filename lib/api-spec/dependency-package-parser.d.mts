export interface ParseDependencyPackageJsonOptions {
  contents: string;
  label: string;
}

export function parseDependencyPackageJson(
  options: ParseDependencyPackageJsonOptions,
): unknown;