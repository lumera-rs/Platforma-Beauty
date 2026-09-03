import path from "node:path";

export const orvalFileProducingOutputOptions = Object.freeze([
  "workspace",
  "target",
  "schemas",
  "operationSchemas",
  "mock",
  "factoryMethods",
]);

export const orvalNonFileOutputOptions = Object.freeze([
  "namingConvention",
  "fileExtension",
  "schemaFileExtension",
  "mode",
  "override",
  "client",
  "httpClient",
  "clean",
  "docs",
  "formatter",
  "tsconfig",
  "packageJson",
  "headers",
  "indexFiles",
  "baseUrl",
  "allParamsOptional",
  "urlEncodeParameters",
  "unionAddMissingProperties",
  "optionsParamRequired",
  "propertySortOrder",
  "tagsSplitDeduplication",
  "commonTypesFileName",
]);

export const orvalNestedOutputContracts = Object.freeze({
  SchemaOptions: Object.freeze({
    configPath: "output.schemas",
    fileProducing: Object.freeze(["path"]),
    nonFile: Object.freeze(["type", "importPath", "splitByTags"]),
  }),
  OutputMocksConfig: Object.freeze({
    configPath: "output.mock",
    fileProducing: Object.freeze(["path"]),
    nonFile: Object.freeze(["indexMockFiles", "generators"]),
  }),
  CommonMockOptions: Object.freeze({
    configPath: "output.mock.generators[]",
    fileProducing: Object.freeze([]),
    nonFile: Object.freeze([
      "useExamples",
      "generateEachHttpStatus",
      "locale",
      "preferredContentType",
      "arrayItems",
    ]),
  }),
  MswMockOptions: Object.freeze({
    configPath: "output.mock.generators[]",
    fileProducing: Object.freeze(["path"]),
    nonFile: Object.freeze([
      "type",
      "operationResponses",
      "baseUrl",
      "delay",
      "delayFunctionLazyExecute",
    ]),
  }),
  FakerMockOptions: Object.freeze({
    configPath: "output.mock.generators[]",
    fileProducing: Object.freeze(["path"]),
    nonFile: Object.freeze([
      "type",
      "schemas",
      "schemasImportPath",
      "operationResponses",
    ]),
  }),
  FactoryMethodsOptions: Object.freeze({
    configPath: "output.factoryMethods",
    fileProducing: Object.freeze(["outputDirectory"]),
    nonFile: Object.freeze(["functionNamePrefix", "mode", "includeOptionalProperty"]),
  }),
});

export function assertOrvalOutputContractRecognized(installedOutputOptions) {
  const recognized = new Set([
    ...orvalFileProducingOutputOptions,
    ...orvalNonFileOutputOptions,
  ]);
  const unrecognized = [...installedOutputOptions]
    .filter((option) => !recognized.has(option))
    .sort();

  if (unrecognized.length === 0) {
    return;
  }

  throw new Error([
    "The installed Orval OutputOptions contract contains unrecognized options.",
    "Review each option to determine whether it can produce files, then update the API output inventory guard classification.",
    ...unrecognized.map((option) => `  - output.${option}`),
  ].join("\n"));
}

export function assertOrvalNestedOutputContractsRecognized(installedContracts) {
  const unrecognized = [];

  for (const [contractName, classification] of Object.entries(orvalNestedOutputContracts)) {
    const recognized = new Set([
      ...classification.fileProducing,
      ...classification.nonFile,
    ]);
    const installedFields = installedContracts[contractName];

    if (!installedFields) {
      unrecognized.push(
        `  - ${contractName}: installed Orval declarations no longer expose this reviewed contract`,
      );
      continue;
    }

    for (const field of installedFields) {
      if (!recognized.has(field)) {
        unrecognized.push(`  - ${classification.configPath}.${field} (${contractName})`);
      }
    }
  }

  if (unrecognized.length === 0) {
    return;
  }

  throw new Error([
    "The installed Orval nested output contracts contain unrecognized options.",
    "Review each option to determine whether it can produce files, then update the API output inventory guard classification.",
    ...unrecognized.sort(),
  ].join("\n"));
}

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