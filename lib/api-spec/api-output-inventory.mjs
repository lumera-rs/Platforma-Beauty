import path from "node:path";

export const apiOutputInventory = Object.freeze({
  publicDocumentation: Object.freeze([
    "lib/api-spec/openapi.yaml",
  ]),
  generators: Object.freeze({
    "api-client-react": Object.freeze({
      source: "lib/api-client-react/src/generated",
      published: "lib/api-client-react/dist/generated",
    }),
    zod: Object.freeze({
      source: "lib/api-zod/src/generated",
      published: "lib/api-zod/dist/generated",
    }),
  }),
});

export function assertApiGeneratorInventoryComplete(configuredGeneratorNames) {
  const configured = new Set(configuredGeneratorNames);
  const inventoried = new Set(Object.keys(apiOutputInventory.generators));
  const missingFromInventory = [...configured].filter((name) => !inventoried.has(name)).sort();
  const missingFromConfiguration = [...inventoried].filter((name) => !configured.has(name)).sort();
  const incompleteOutputs = [...configured]
    .filter((name) => {
      const output = apiOutputInventory.generators[name];
      return output && (!output.source || !output.published);
    })
    .sort();

  if (
    missingFromInventory.length === 0
    && missingFromConfiguration.length === 0
    && incompleteOutputs.length === 0
  ) {
    return;
  }

  throw new Error([
    "Orval generators and the API output safety inventory are out of sync.",
    ...missingFromInventory.map((name) =>
      `  - ${name}: add both source and published outputs to apiOutputInventory.generators`,
    ),
    ...missingFromConfiguration.map((name) =>
      `  - ${name}: remove its stale API output inventory entry or restore its Orval target`,
    ),
    ...incompleteOutputs.map((name) =>
      `  - ${name}: inventory both non-empty source and published outputs`,
    ),
  ].join("\n"));
}

function isPathCoveredByRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveOutputPath(workspace, value) {
  return path.resolve(workspace, value);
}

function collectAuxiliaryOutputPaths(output, workspace) {
  const paths = [];

  for (const [option, value] of Object.entries(output)) {
    if (option === "target" || option === "workspace" || option === "override") {
      continue;
    }

    if (option === "schemas") {
      const schemasPath = typeof value === "string" ? value : value?.path;
      if (typeof schemasPath === "string") {
        paths.push({ option: "schemas", path: resolveOutputPath(workspace, schemasPath) });
      }
      continue;
    }

    if (option === "operationSchemas" && typeof value === "string") {
      paths.push({ option, path: resolveOutputPath(workspace, value) });
      continue;
    }

    if (
      option === "factoryMethods"
      && value
      && typeof value === "object"
      && typeof value.outputDirectory === "string"
    ) {
      paths.push({
        option: "factoryMethods.outputDirectory",
        path: resolveOutputPath(workspace, value.outputDirectory),
      });
      continue;
    }

    if (option === "mock" && value && typeof value === "object") {
      if (typeof value.path === "string") {
        paths.push({
          option: "mock.path",
          path: resolveOutputPath(workspace, value.path),
        });
      }
      if (Array.isArray(value.generators)) {
        value.generators.forEach((generator, index) => {
          if (generator && typeof generator === "object" && typeof generator.path === "string") {
            paths.push({
              option: `mock.generators[${index}].path`,
              path: resolveOutputPath(workspace, generator.path),
            });
          }
        });
      }
      continue;
    }

    if (option.endsWith("Path") && typeof value === "string") {
      paths.push({ option, path: resolveOutputPath(workspace, value) });
    }
  }

  return paths;
}

export function assertApiGeneratorOutputPathsCovered(config, outputRoot = process.cwd()) {
  const uncovered = [];

  for (const [name, generatorConfig] of Object.entries(config)) {
    const inventory = apiOutputInventory.generators[name];
    const output = generatorConfig?.output;
    if (!inventory || !output) {
      continue;
    }

    if (typeof output === "string") {
      const sourceRoot = path.resolve(outputRoot, inventory.source);
      const target = path.resolve(outputRoot, output);
      if (!isPathCoveredByRoot(target, sourceRoot)) {
        uncovered.push(
          `  - ${name} output.target: ${target} is outside inventoried source root ${sourceRoot}`,
        );
      }
      continue;
    }

    if (typeof output !== "object") {
      continue;
    }

    const workspace = typeof output.workspace === "string"
      ? path.resolve(output.workspace)
      : path.resolve(outputRoot);
    const sourceRoot = path.resolve(outputRoot, inventory.source);
    const target = typeof output.target === "string"
      ? resolveOutputPath(workspace, output.target)
      : workspace;

    for (const candidate of [
      { option: "workspace + target", path: target },
      ...collectAuxiliaryOutputPaths(output, workspace),
    ]) {
      if (!isPathCoveredByRoot(candidate.path, sourceRoot)) {
        uncovered.push(
          `  - ${name} output.${candidate.option}: ${candidate.path} is outside inventoried source root ${sourceRoot}`,
        );
      }
    }
  }

  if (uncovered.length > 0) {
    throw new Error([
      "Orval output paths are not covered by the API output safety inventory.",
      ...uncovered,
    ].join("\n"));
  }
}

export function defineInventoriedGeneratorConfig(config, outputRoot = process.cwd()) {
  assertApiGeneratorInventoryComplete(Object.keys(config));
  assertApiGeneratorOutputPathsCovered(config, outputRoot);
  return config;
}