import path from "node:path";

function findBalancedBlock(source, openingIndex, opening = "{", closing = "}") {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing && --depth === 0) {
      return source.slice(openingIndex + 1, index);
    }
  }

  return undefined;
}

function splitTopLevel(source, separator, limit = Number.POSITIVE_INFINITY) {
  const members = [];
  let start = 0;
  const depths = { "{": 0, "[": 0, "(": 0, "<": 0 };
  const pairs = { "}": "{", "]": "[", ")": "(", ">": "<" };
  let quote = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character in depths) {
      depths[character] += 1;
    } else if (character in pairs) {
      depths[pairs[character]] = Math.max(0, depths[pairs[character]] - 1);
    } else if (
      character === separator
      && Object.values(depths).every((depth) => depth === 0)
    ) {
      members.push(source.slice(start, index));
      if (members.length === limit) {
        return members;
      }
      start = index + 1;
    }
  }

  members.push(source.slice(start));
  return members;
}

function normalizeTypeMember(member) {
  return member
    .replace(/\s+/g, " ")
    .replace(/\s*([{}()[\],;:?])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function splitInterfaceMembers(body) {
  const members = [];
  let start = 0;
  const depths = { "{": 0, "[": 0, "(": 0, "<": 0 };
  const pairs = { "}": "{", "]": "[", ")": "(", ">": "<" };
  let quote = null;
  let escaped = false;

  const pushMember = (end) => {
    const member = body.slice(start, end).trim();
    if (member) {
      members.push(member);
    }
  };

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character in depths) {
      depths[character] += 1;
    } else if (character in pairs) {
      depths[pairs[character]] = Math.max(0, depths[pairs[character]] - 1);
    } else if (
      (character === ";" || character === ",")
      && Object.values(depths).every((depth) => depth === 0)
    ) {
      pushMember(index);
      start = index + 1;
    } else if (
      character === "\n"
      && Object.values(depths).every((depth) => depth === 0)
      && /^[ \t]*(?:readonly\s+)?[A-Za-z]\w*\??\s*:/.test(body.slice(index + 1))
    ) {
      pushMember(index);
      start = index + 1;
    }
  }

  pushMember(body.length);
  return members;
}

function readTypeAliases(declarations) {
  const aliases = new Map();
  const matcher = /\btype\s+([A-Za-z]\w*)\s*=/g;
  let match;

  while ((match = matcher.exec(declarations))) {
    const remainder = declarations.slice(matcher.lastIndex);
    const declaration = splitTopLevel(remainder, ";", 1)[0];
    aliases.set(match[1], declaration.trim());
    matcher.lastIndex += declaration.length + 1;
  }

  return aliases;
}

export function readOrvalInterfaceFieldValueShapes(declarations, interfaceName) {
  const source = declarations
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const declaration = new RegExp(
    `\\binterface\\s+${interfaceName}\\b(?:\\s+extends\\s+[^\\{]+)?\\s*\\{`,
  ).exec(source);
  if (!declaration) {
    throw new Error(`Installed Orval declarations must expose ${interfaceName}`);
  }

  const openingIndex = declaration.index + declaration[0].lastIndexOf("{");
  const body = findBalancedBlock(source, openingIndex);
  if (body === undefined) {
    throw new Error(`Installed Orval declarations must expose ${interfaceName}`);
  }

  const aliases = readTypeAliases(source);
  const resolveMembers = (type, seen = new Set()) =>
    splitTopLevel(type, "|").flatMap((rawMember) => {
      const member = normalizeTypeMember(rawMember);
      const alias = aliases.get(member);
      if (
        !alias
        || splitTopLevel(alias, "|").length === 1
        || seen.has(member)
      ) {
        return member;
      }
      return resolveMembers(alias, new Set([...seen, member]));
    });

  return Object.fromEntries(
    splitInterfaceMembers(body)
      .map((member) => {
        const field = /^(?:readonly\s+)?([A-Za-z]\w*)\??\s*:\s*([\s\S]+)$/.exec(member);
        return field ? [field[1], resolveMembers(field[2])] : null;
      })
      .filter(Boolean),
  );
}

export const orvalFileProducingOutputOptions = Object.freeze([
  "workspace",
  "target",
  "schemas",
  "operationSchemas",
  "mock",
  "factoryMethods",
]);

export const orvalFileProducingOutputValueShapes = Object.freeze({
  workspace: Object.freeze(["string"]),
  target: Object.freeze(["string"]),
  schemas: Object.freeze(["string", "SchemaOptions", "false"]),
  operationSchemas: Object.freeze(["string"]),
  mock: Object.freeze(["boolean", "OutputMocksConfig", "ClientMockBuilder"]),
  factoryMethods: Object.freeze(["FactoryMethodsOptions"]),
});

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
    fileProducingValueShapes: Object.freeze({
      path: Object.freeze(["string"]),
    }),
    nonFile: Object.freeze(["type", "importPath", "splitByTags"]),
  }),
  OutputMocksConfig: Object.freeze({
    configPath: "output.mock",
    fileProducing: Object.freeze(["path"]),
    fileProducingValueShapes: Object.freeze({
      path: Object.freeze(["string"]),
    }),
    nonFile: Object.freeze(["indexMockFiles", "generators"]),
  }),
  CommonMockOptions: Object.freeze({
    configPath: "output.mock.generators[]",
    fileProducing: Object.freeze([]),
    fileProducingValueShapes: Object.freeze({}),
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
    fileProducingValueShapes: Object.freeze({
      path: Object.freeze(["string"]),
    }),
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
    fileProducingValueShapes: Object.freeze({
      path: Object.freeze(["string"]),
    }),
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
    fileProducingValueShapes: Object.freeze({
      outputDirectory: Object.freeze(["string"]),
    }),
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

export function assertOrvalFileProducingOutputValueShapesRecognized(installedShapes) {
  const changes = [];

  for (const option of orvalFileProducingOutputOptions) {
    const reviewed = orvalFileProducingOutputValueShapes[option];
    const installed = installedShapes[option];

    if (!installed) {
      changes.push(`  - output.${option}: installed Orval declarations no longer expose this reviewed option`);
      continue;
    }

    const reviewedMembers = [...reviewed].sort();
    const installedMembers = [...installed].sort();
    if (
      reviewedMembers.length !== installedMembers.length
      || reviewedMembers.some((member, index) => member !== installedMembers[index])
    ) {
      changes.push(
        `  - output.${option}: reviewed ${reviewedMembers.join(" | ")}, installed ${installedMembers.join(" | ")}`,
      );
    }
  }

  if (changes.length === 0) {
    return;
  }

  throw new Error([
    "The installed Orval file-producing output value shapes have changed.",
    "Review every changed string/object union and update the API output inventory path collector before accepting the new declaration shape.",
    ...changes,
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

export function assertOrvalNestedFileProducingOutputValueShapesRecognized(installedShapes) {
  const changes = [];

  for (const [contractName, classification] of Object.entries(orvalNestedOutputContracts)) {
    const installedContract = installedShapes[contractName];

    for (const field of classification.fileProducing) {
      const reviewed = classification.fileProducingValueShapes[field];
      const installed = installedContract?.[field];
      const configField = `${classification.configPath}.${field}`;

      if (!installed) {
        changes.push(
          `  - ${configField} (${contractName}): installed Orval declarations no longer expose this reviewed field`,
        );
        continue;
      }

      const reviewedMembers = [...reviewed].sort();
      const installedMembers = [...installed].sort();
      if (
        reviewedMembers.length !== installedMembers.length
        || reviewedMembers.some((member, index) => member !== installedMembers[index])
      ) {
        changes.push(
          `  - ${configField} (${contractName}): reviewed ${reviewedMembers.join(" | ")}, installed ${installedMembers.join(" | ")}`,
        );
      }
    }
  }

  if (changes.length === 0) {
    return;
  }

  throw new Error([
    "The installed Orval nested file-producing output value shapes have changed.",
    "Review every changed string/object union and update the API output inventory path collector before accepting the new declaration shape.",
    ...changes.sort(),
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