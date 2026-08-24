#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Discover frontend artifacts from their workspace dependencies instead of
# maintaining a second list here whenever a new app is added. Declaration-only
# composite libraries are the generated outputs that need the clean build.
declare -a FRONTEND_PACKAGES=()
declare -A FRONTEND_GENERATED_PROJECTS=()
declare -A FRONTEND_GENERATED_DIST_DIRS=()
declare -A GENERATED_PROJECT_DIRS=()
declare -A GENERATED_DIST_DIRS=()

while IFS=$'\t' read -r package_name generated_projects generated_dist_dirs; do
  [[ -n "$package_name" ]] || continue
  FRONTEND_PACKAGES+=("$package_name")
  FRONTEND_GENERATED_PROJECTS["$package_name"]="$generated_projects"
  FRONTEND_GENERATED_DIST_DIRS["$package_name"]="$generated_dist_dirs"

  IFS=',' read -r -a project_dirs <<< "$generated_projects"
  for project_dir in "${project_dirs[@]}"; do
    [[ -n "$project_dir" ]] || continue
    GENERATED_PROJECT_DIRS["$project_dir"]=1
  done

  IFS=',' read -r -a dist_dirs <<< "$generated_dist_dirs"
  for dist_dir in "${dist_dirs[@]}"; do
    [[ -n "$dist_dir" ]] || continue
    GENERATED_DIST_DIRS["$dist_dir"]=1
  done
done < <(
  node - "$ROOT_DIR" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const rootDir = process.argv[2];
const artifactsDir = path.join(rootDir, "artifacts");
const librariesDir = path.join(rootDir, "lib");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isDeclarationProject(packageDir) {
  const tsconfigPath = path.join(packageDir, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    return false;
  }

  const tsconfig = readJson(tsconfigPath);
  return (
    tsconfig.compilerOptions?.composite === true &&
    tsconfig.compilerOptions?.emitDeclarationOnly === true
  );
}

const declarationProjects = new Map();
for (const entry of fs.readdirSync(librariesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const packageDir = path.join(librariesDir, entry.name);
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath) || !isDeclarationProject(packageDir)) {
    continue;
  }

  const packageJson = readJson(packageJsonPath);
  const outDir = packageJson?.types
    ? path.dirname(path.join(packageDir, packageJson.types))
    : path.join(packageDir, "dist");
  declarationProjects.set(packageJson.name, {
    projectDir: path.relative(rootDir, packageDir),
    distDir: path.resolve(outDir),
  });
}

for (const entry of fs.readdirSync(artifactsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const artifactDir = path.join(artifactsDir, entry.name);
  const packageJsonPath = path.join(artifactDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    continue;
  }

  const packageJson = readJson(packageJsonPath);
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
  };
  const consumedProjects = [...declarationProjects.entries()].filter(
    ([packageName]) => dependencies[packageName],
  );

  // API server artifacts can consume generated schemas too, but this check is
  // specifically for frontend packages. Exclude server packages by their
  // server dependency rather than by a hardcoded artifact name.
  if (dependencies.express || consumedProjects.length === 0) {
    continue;
  }

  const projectDirs = consumedProjects.map(([, project]) => project.projectDir);
  const distDirs = consumedProjects.map(([, project]) => project.distDir);
  process.stdout.write(
    `${packageJson.name}\t${projectDirs.join(",")}\t${distDirs.join(",")}\n`,
  );
}
NODE
)

if (( ${#FRONTEND_PACKAGES[@]} == 0 )); then
  echo "No frontend packages consume generated declarations."
  exit 0
fi

restore_generated_declarations() {
  local exit_code=$?
  trap - EXIT

  local missing_declarations=0
  for dist_dir in "${!GENERATED_DIST_DIRS[@]}"; do
    if [[ ! -d "$dist_dir" ]] || ! find "$dist_dir" -type f -name '*.d.ts' -print -quit | grep -q .; then
      missing_declarations=1
      break
    fi
  done

  if (( missing_declarations )); then
    echo "Restoring generated declarations for subsequent workspace checks..."
    local -a project_dirs=()
    for project_dir in "${!GENERATED_PROJECT_DIRS[@]}"; do
      project_dirs+=("$project_dir")
    done
    if ! (cd "$ROOT_DIR" && pnpm -w exec tsc --build --force "${project_dirs[@]}"); then
      echo "Failed to restore generated declarations." >&2
      if [[ "$exit_code" -eq 0 ]]; then
        exit_code=1
      fi
    fi
  fi

  exit "$exit_code"
}
trap restore_generated_declarations EXIT

for dist_dir in "${!GENERATED_DIST_DIRS[@]}"; do
  rm -rf "$dist_dir"
  if [[ -e "$dist_dir" ]]; then
    echo "Expected generated declarations to be absent before validation: $dist_dir" >&2
    exit 1
  fi
done

for package_name in "${FRONTEND_PACKAGES[@]}"; do
  IFS=',' read -r -a dist_dirs <<< "${FRONTEND_GENERATED_DIST_DIRS["$package_name"]}"
  for dist_dir in "${dist_dirs[@]}"; do
    rm -rf "$dist_dir"
  done

  echo "Running clean generated-declaration typecheck: $package_name"
  (
    cd "$ROOT_DIR"
    pnpm --filter "$package_name" run typecheck
  )

  for dist_dir in "${dist_dirs[@]}"; do
    if [[ ! -d "$dist_dir" ]] || ! find "$dist_dir" -type f -name '*.d.ts' -print -quit | grep -q .; then
      echo "$package_name typecheck did not rebuild generated declarations in $dist_dir." >&2
      exit 1
    fi
  done
done

CLIENT_DIST_DIR="$ROOT_DIR/lib/api-client-react/dist"
API_ZOD_DIST_DIR="$ROOT_DIR/lib/api-zod/dist"
API_DECLARATIONS="$CLIENT_DIST_DIR/generated/api.d.ts"
SCHEMA_DECLARATIONS="$CLIENT_DIST_DIR/generated/api.schemas.d.ts"
ZOD_DECLARATIONS="$API_ZOD_DIST_DIR/generated/api.d.ts"

require_declaration() {
  local declaration_file="$1"
  local symbol="$2"

  if ! grep -qF "$symbol" "$declaration_file"; then
    echo "Missing generated declaration: $symbol" >&2
    exit 1
  fi
}

[[ -f "$API_DECLARATIONS" ]] || { echo "Marketplace typecheck did not rebuild API declarations." >&2; exit 1; }
[[ -f "$SCHEMA_DECLARATIONS" ]] || { echo "Marketplace typecheck did not rebuild API schema declarations." >&2; exit 1; }
[[ -f "$ZOD_DECLARATIONS" ]] || { echo "Marketplace typecheck did not rebuild API Zod declarations." >&2; exit 1; }

require_declaration "$API_DECLARATIONS" "useListPublicProducts"
require_declaration "$API_DECLARATIONS" "useGetPublicProduct"
require_declaration "$SCHEMA_DECLARATIONS" "retailEnabled"
require_declaration "$SCHEMA_DECLARATIONS" "professionalEnabled"
require_declaration "$SCHEMA_DECLARATIONS" "publicDescription"
require_declaration "$SCHEMA_DECLARATIONS" "publicPrice"
require_declaration "$SCHEMA_DECLARATIONS" "publicDiscountPrice"
require_declaration "$ZOD_DECLARATIONS" "AdminGetIntegrationsResponse"
require_declaration "$ZOD_DECLARATIONS" "AdminGetWebhookFreshnessResponse"

echo "Frontend standalone typechecks rebuilt and verified generated API declarations and schemas."