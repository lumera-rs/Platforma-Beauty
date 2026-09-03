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

function hasNestedFileProducingContract(option) {
  const configPath = `output.${option}`;
  return Object.values(orvalNestedOutputContracts).some((classification) =>
    classification.fileProducing.length > 0
    && (
      classification.configPath === configPath
      || classification.configPath.startsWith(`${configPath}.`)
    )
  );
}

function collectNestedContractPaths(output, workspace) {
  const paths = [];
  const seen = new Set();

  for (const classification of Object.values(orvalNestedOutputContracts)) {
    const segments = classification.configPath
      .replace(/^output\./, "")
      .split(".");

    let candidates = [{ value: output, option: "" }];
    for (const segment of segments) {
      const isArray = segment.endsWith("[]");
      const field = isArray ? segment.slice(0, -2) : segment;
      const nextCandidates = [];

      for (const candidate of candidates) {
        const value = candidate.value?.[field];
        const option = candidate.option ? `${candidate.option}.${field}` : field;
        if (isArray) {
          if (Array.isArray(value)) {
            value.forEach((item, index) => {
              nextCandidates.push({ value: item, option: `${option}[${index}]` });
            });
          }
        } else if (value && typeof value === "object") {
          nextCandidates.push({ value, option });
        }
      }

      candidates = nextCandidates;
    }

    for (const candidate of candidates) {
      for (const field of classification.fileProducing) {
        const value = candidate.value?.[field];
        if (typeof value !== "string") {
          continue;
        }

        const option = `${candidate.option}.${field}`;
        if (!seen.has(option)) {
          paths.push({ option, path: resolveOutputPath(workspace, value) });
          seen.add(option);
        }
      }
    }
  }

  return paths;
}

export function collectOrvalConfiguredOutputPaths(
  output,
  workspace,
  fileProducingOptions = orvalFileProducingOutputOptions,
) {
  const paths = [];

  for (const option of fileProducingOptions) {
    if (option === "workspace") {
      continue;
    }

    const value = output[option];
    if (option === "target") {
      paths.push({
        option: "workspace + target",
        path: typeof value === "string"
          ? resolveOutputPath(workspace, value)
          : workspace,
      });
      continue;
    }

    if (typeof value === "string") {
      paths.push({ option, path: resolveOutputPath(workspace, value) });
      continue;
    }

    if (
      value
      && typeof value === "object"
      && !hasNestedFileProducingContract(option)
    ) {
      throw new Error(
        `Classified Orval file-producing option output.${option} uses an object form without a reviewed nested path contract.`,
      );
    }
  }

  return [...paths, ...collectNestedContractPaths(output, workspace)];
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

    for (const candidate of collectOrvalConfiguredOutputPaths(output, workspace)) {
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