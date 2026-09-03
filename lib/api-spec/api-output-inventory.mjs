import path from "node:path";
import ts from "typescript";

function getDeclarationLineAndColumn(declarations, position) {
  let line = 1;
  let lineStart = 0;

  for (let index = 0; index < position; index += 1) {
    const character = declarations.charCodeAt(index);
    if (character === 0x0d) {
      if (
        index + 1 < position
        && declarations.charCodeAt(index + 1) === 0x0a
      ) {
        index += 1;
      }
      line += 1;
      lineStart = index + 1;
    } else if (
      character === 0x0a
      || character === 0x2028
      || character === 0x2029
    ) {
      line += 1;
      lineStart = index + 1;
    }
  }

  return { line, column: position - lineStart + 1 };
}

function normalizeTypeMember(member) {
  let result = "";
  let unquotedStart = 0;
  let quote = null;
  let escaped = false;

  const appendNormalized = (text) => {
    result += text
      .replace(/\s+/g, " ")
      .replace(/\s*([{}()[\],;:?])\s*/g, "$1")
      .replace(/;}/g, "}");
  };

  for (let index = 0; index < member.length; index += 1) {
    const character = member[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
        result += member.slice(unquotedStart, index + 1);
        unquotedStart = index + 1;
      }
    } else if (character === "'" || character === '"' || character === "`") {
      appendNormalized(member.slice(unquotedStart, index));
      quote = character;
      unquotedStart = index;
    }
  }

  if (quote) {
    result += member.slice(unquotedStart);
  } else {
    appendNormalized(member.slice(unquotedStart));
  }
  return result.trim();
}

export function readOrvalInterfaceFieldValueShapes(declarations, interfaceName) {
  const source = ts.createSourceFile(
    "orval-declarations.d.ts",
    declarations,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (source.parseDiagnostics.length > 0) {
    const diagnostic = source.parseDiagnostics[0];
    const { line, column } = getDeclarationLineAndColumn(
      declarations,
      diagnostic.start ?? 0,
    );
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    throw new Error(
      `Installed Orval declarations must contain valid TypeScript syntax: TS${diagnostic.code} at ${line}:${column}: ${message}`,
    );
  }

  const declaration = source.statements.find(
    (statement) =>
      ts.isInterfaceDeclaration(statement)
      && statement.name.text === interfaceName,
  );
  if (!declaration) {
    throw new Error(`Installed Orval declarations must expose ${interfaceName}`);
  }

  const aliases = new Map(
    source.statements
      .filter(ts.isTypeAliasDeclaration)
      .map((statement) => [statement.name.text, statement.type]),
  );
  const printer = ts.createPrinter({ removeComments: true });
  const printType = (type) =>
    normalizeTypeMember(printer.printNode(ts.EmitHint.Unspecified, type, source));
  const resolveMembers = (type, seen = new Set()) => {
    const types = ts.isUnionTypeNode(type) ? type.types : [type];
    return types.flatMap((memberType) => {
      const member = printType(memberType);
      const alias = ts.isTypeReferenceNode(memberType)
        && ts.isIdentifier(memberType.typeName)
        ? aliases.get(memberType.typeName.text)
        : undefined;
      if (
        !alias
        || !ts.isUnionTypeNode(alias)
        || seen.has(member)
      ) {
        return member;
      }
      return resolveMembers(alias, new Set([...seen, member]));
    });
  };

  return Object.fromEntries(
    declaration.members
      .map((member) =>
        ts.isPropertySignature(member)
        && ts.isIdentifier(member.name)
        && member.type
          ? [member.name.text, resolveMembers(member.type)]
          : null)
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