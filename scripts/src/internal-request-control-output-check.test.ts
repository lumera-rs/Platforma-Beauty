import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkInternalRequestControlOutputs,
  findInternalControlsInGeneratedOutputs,
} from "./internal-request-control-output-check";
import {
  assertOrvalFileProducingOutputValueShapesRecognized,
  assertOrvalNestedFileProducingOutputValueShapesRecognized,
  assertOrvalNestedOutputContractsRecognized,
  assertOrvalOutputContractRecognized,
  collectOrvalConfiguredOutputPaths,
  defineInventoriedGeneratorConfig,
  orvalNestedOutputContracts,
} from "../../lib/api-spec/api-output-inventory.mjs";

const require = createRequire(import.meta.url);

async function readInstalledOrvalDeclarations() {
  const orvalPackagePath = require.resolve(
    "orval/package.json",
    { paths: [path.resolve(import.meta.dirname, "../../lib/api-spec")] },
  );
  const corePackagePath = require.resolve(
    "@orval/core/package.json",
    { paths: [path.dirname(orvalPackagePath)] },
  );
  const corePackage = JSON.parse(await readFile(corePackagePath, "utf8")) as {
    types: string;
  };
  const declarations = await readFile(
    path.resolve(path.dirname(corePackagePath), corePackage.types),
    "utf8",
  );
  return declarations;
}

function readInterfaceFieldNames(declarations: string, interfaceName: string) {
  const declaration = declarations.match(
    new RegExp(`interface ${interfaceName}(?: extends [^{]+)? \\{(?<body>[\\s\\S]*?)^\\}`, "m"),
  );

  assert.ok(
    declaration?.groups?.body,
    `Installed Orval declarations must expose ${interfaceName}`,
  );
  return [...declaration.groups.body.matchAll(/^\s{2}([A-Za-z]\w*)\??:/gm)]
    .map((match) => match[1]);
}

function readFileProducingOutputValueShapes(declarations: string) {
  const declaration = declarations.match(
    /interface OutputOptions(?: extends [^{]+)? \{(?<body>[\s\S]*?)^\}/m,
  );
  assert.ok(declaration?.groups?.body, "Installed Orval declarations must expose OutputOptions");

  const aliases = new Map(
    [...declarations.matchAll(/^type ([A-Za-z]\w*)\s*=\s*([^;\n]+);$/gm)]
      .map((match) => [match[1], match[2]]),
  );
  const resolveMembers = (type: string, seen = new Set<string>()): string[] =>
    type.split("|").flatMap((rawMember) => {
      const member = rawMember.trim();
      const alias = aliases.get(member);
      if (!alias?.includes("|") || seen.has(member)) {
        return member;
      }
      return resolveMembers(alias, new Set([...seen, member]));
    });

  return Object.fromEntries(
    [...declaration.groups.body.matchAll(/^\s{2}([A-Za-z]\w*)\??:\s*([^;\n]+);$/gm)]
      .map((match) => [match[1], resolveMembers(match[2])]),
  );
}

function readInterfaceFieldValueShapes(declarations: string, interfaceName: string) {
  const declaration = declarations.match(
    new RegExp(`interface ${interfaceName}(?: extends [^{]+)? \\{(?<body>[\\s\\S]*?)^\\}`, "m"),
  );
  assert.ok(
    declaration?.groups?.body,
    `Installed Orval declarations must expose ${interfaceName}`,
  );

  const aliases = new Map(
    [...declarations.matchAll(/^type ([A-Za-z]\w*)\s*=\s*([^;\n]+);$/gm)]
      .map((match) => [match[1], match[2]]),
  );
  const resolveMembers = (type: string, seen = new Set<string>()): string[] =>
    type.split("|").flatMap((rawMember) => {
      const member = rawMember.trim();
      const alias = aliases.get(member);
      if (!alias?.includes("|") || seen.has(member)) {
        return member;
      }
      return resolveMembers(alias, new Set([...seen, member]));
    });

  return Object.fromEntries(
    [...declaration.groups.body.matchAll(/^\s{2}([A-Za-z]\w*)\??:\s*([^;\n]+);$/gm)]
      .map((match) => [match[1], resolveMembers(match[2])]),
  );
}

test("installed Orval output options are classified by the inventory guard", async () => {
  const declarations = await readInstalledOrvalDeclarations();
  const installedOptions = readInterfaceFieldNames(declarations, "OutputOptions");

  assert.doesNotThrow(() => assertOrvalOutputContractRecognized(installedOptions));
  assert.throws(
    () => assertOrvalOutputContractRecognized([...installedOptions, "futureOutputDirectory"]),
    /installed Orval OutputOptions contract contains unrecognized options[\s\S]*output\.futureOutputDirectory/,
  );
});

test("installed Orval file-producing output value shapes are reviewed", async () => {
  const declarations = await readInstalledOrvalDeclarations();
  const installedShapes = readFileProducingOutputValueShapes(declarations);

  assert.doesNotThrow(
    () => assertOrvalFileProducingOutputValueShapesRecognized(installedShapes),
  );
  assert.throws(
    () => assertOrvalFileProducingOutputValueShapesRecognized({
      ...installedShapes,
      schemas: [...installedShapes.schemas, "FutureSchemaOptions"],
    }),
    /file-producing output value shapes have changed[\s\S]*Review every changed string\/object union[\s\S]*output\.schemas:[\s\S]*FutureSchemaOptions/,
  );
  assert.throws(
    () => assertOrvalFileProducingOutputValueShapesRecognized({
      ...installedShapes,
      mock: [...installedShapes.mock, "FutureMockOptions"],
    }),
    /output\.mock:[\s\S]*FutureMockOptions/,
  );
});

test("installed nested Orval output options are classified by the inventory guard", async () => {
  const declarations = await readInstalledOrvalDeclarations();
  const installedContracts = Object.fromEntries(
    Object.keys(orvalNestedOutputContracts).map((contractName) => [
      contractName,
      readInterfaceFieldNames(declarations, contractName),
    ]),
  );

  assert.doesNotThrow(
    () => assertOrvalNestedOutputContractsRecognized(installedContracts),
  );
  assert.throws(
    () => assertOrvalNestedOutputContractsRecognized({
      ...installedContracts,
      FakerMockOptions: [
        ...installedContracts.FakerMockOptions,
        "futureOutputDirectory",
      ],
    }),
    /installed Orval nested output contracts contain unrecognized options[\s\S]*output\.mock\.generators\[\]\.futureOutputDirectory \(FakerMockOptions\)/,
  );
});

test("installed nested Orval file-producing output value shapes are reviewed", async () => {
  const declarations = await readInstalledOrvalDeclarations();
  const installedShapes = Object.fromEntries(
    Object.keys(orvalNestedOutputContracts).map((contractName) => [
      contractName,
      readInterfaceFieldValueShapes(declarations, contractName),
    ]),
  );

  assert.doesNotThrow(
    () => assertOrvalNestedFileProducingOutputValueShapesRecognized(installedShapes),
  );
  assert.throws(
    () => assertOrvalNestedFileProducingOutputValueShapesRecognized({
      ...installedShapes,
      SchemaOptions: {
        ...installedShapes.SchemaOptions,
        path: [...installedShapes.SchemaOptions.path, "FutureSchemaPathOptions"],
      },
    }),
    /nested file-producing output value shapes have changed[\s\S]*Review every changed string\/object union[\s\S]*output\.schemas\.path \(SchemaOptions\):[\s\S]*FutureSchemaPathOptions/,
  );
  assert.throws(
    () => assertOrvalNestedFileProducingOutputValueShapesRecognized({
      ...installedShapes,
      FakerMockOptions: {
        ...installedShapes.FakerMockOptions,
        path: ["FutureGeneratorPathOptions"],
      },
      FactoryMethodsOptions: {
        ...installedShapes.FactoryMethodsOptions,
        outputDirectory: ["string", "FutureFactoryDirectoryOptions"],
      },
    }),
    /output\.factoryMethods\.outputDirectory \(FactoryMethodsOptions\):[\s\S]*FutureFactoryDirectoryOptions[\s\S]*output\.mock\.generators\[\]\.path \(FakerMockOptions\):[\s\S]*FutureGeneratorPathOptions/,
  );
});

test("non-file Orval output options do not trigger output-location failures", () => {
  assert.doesNotThrow(() => assertOrvalOutputContractRecognized([
    "client",
    "mode",
    "formatter",
    "baseUrl",
  ]));
});

test("nested non-file Orval output options do not trigger output-location failures", () => {
  assert.doesNotThrow(() => assertOrvalNestedOutputContractsRecognized({
    SchemaOptions: ["type", "importPath", "splitByTags"],
    OutputMocksConfig: ["indexMockFiles", "generators"],
    CommonMockOptions: ["locale", "arrayItems"],
    MswMockOptions: ["type", "baseUrl", "delay"],
    FakerMockOptions: ["type", "schemas", "schemasImportPath"],
    FactoryMethodsOptions: ["functionNamePrefix", "mode", "includeOptionalProperty"],
  }));
});

test("an Orval target without inventoried source and published outputs fails closed", () => {
  assert.throws(
    () => defineInventoriedGeneratorConfig({
      "api-client-react": {},
      zod: {},
      "future-client": {},
    }),
    /future-client: add both source and published outputs to apiOutputInventory\.generators/,
  );
});

test("reviewed file-producing Orval fields drive configured-path coverage", () => {
  const fixtureRoot = path.resolve(os.tmpdir(), "orval-output-inventory-fixture");

  assert.throws(
    () => defineInventoriedGeneratorConfig({
      "api-client-react": {
        output: {
          workspace: path.resolve(fixtureRoot, "lib/api-client-react/src"),
          target: "generated",
        },
      },
      zod: {
        output: {
          workspace: path.resolve(fixtureRoot, "lib/api-zod/src"),
          target: "generated",
          schemas: { path: "../escaped-schemas", type: "typescript" },
          operationSchemas: "../escaped-operation-schemas",
          mock: {
            path: "../escaped-mocks",
            generators: [
              { type: "faker", path: "../escaped-faker-mocks" },
            ],
          },
          factoryMethods: {
            outputDirectory: "../escaped-factories",
          },
        },
      },
    }, fixtureRoot),
    /Orval output paths are not covered[\s\S]*zod output\.operationSchemas:[\s\S]*zod output\.schemas\.path:[\s\S]*zod output\.mock\.path:[\s\S]*zod output\.mock\.generators\[0\]\.path:[\s\S]*zod output\.factoryMethods\.outputDirectory:[\s\S]*outside inventoried source root/,
  );
});

test("newly classified top-level Orval file outputs automatically join path coverage", () => {
  const workspace = path.resolve(
    os.tmpdir(),
    "orval-output-inventory-future-option",
  );

  assert.deepEqual(
    collectOrvalConfiguredOutputPaths(
      {
        target: "generated",
        futureOutputDirectory: "../escaped-future-output",
      },
      workspace,
      ["target", "futureOutputDirectory"],
    ),
    [
      {
        option: "workspace + target",
        path: path.resolve(workspace, "generated"),
      },
      {
        option: "futureOutputDirectory",
        path: path.resolve(workspace, "../escaped-future-output"),
      },
    ],
  );

  assert.throws(
    () => collectOrvalConfiguredOutputPaths(
      {
        target: "generated",
        futureOutputDirectory: { path: "../escaped-future-output" },
      },
      workspace,
      ["target", "futureOutputDirectory"],
    ),
    /output\.futureOutputDirectory uses an object form without a reviewed nested path contract/,
  );
});

test("an Orval target outside its inventoried source root fails closed", () => {
  const fixtureRoot = path.resolve(os.tmpdir(), "orval-target-inventory-fixture");

  assert.throws(
    () => defineInventoriedGeneratorConfig({
      "api-client-react": {
        output: {
          workspace: path.resolve(fixtureRoot, "lib/api-client-react/src"),
          target: "../escaped-client",
        },
      },
      zod: {
        output: {
          workspace: path.resolve(fixtureRoot, "lib/api-zod/src"),
          target: "generated",
        },
      },
    }, fixtureRoot),
    /api-client-react output\.workspace \+ target:[\s\S]*outside inventoried source root/,
  );
});

test("current split React and Zod output layouts stay covered", () => {
  const fixtureRoot = path.resolve(os.tmpdir(), "orval-output-inventory-current");

  assert.doesNotThrow(() => defineInventoriedGeneratorConfig({
    "api-client-react": {
      output: {
        workspace: path.resolve(fixtureRoot, "lib/api-client-react/src"),
        target: "generated",
        mode: "split",
      },
    },
    zod: {
      output: {
        workspace: path.resolve(fixtureRoot, "lib/api-zod/src"),
        target: "generated",
        schemas: { path: "generated/types", type: "typescript" },
        mock: {
          path: "generated/mocks",
          generators: [
            { type: "faker", path: "generated/faker-mocks" },
          ],
        },
        factoryMethods: {
          outputDirectory: "generated/factories",
        },
        mode: "split",
      },
    },
  }, fixtureRoot));
});

test("stale or alternate generated output exposes a clear internal-control failure", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "internal-control-output-"));
  const generatedDirectory = path.join(temporaryRoot, "alternate-client");
  await mkdir(generatedDirectory);
  await writeFile(
    path.join(generatedDirectory, "stale-client.ts"),
    'export const headers = { "X-Fixture-Internal": value };\n',
  );
  const controls = [{
    transport: "header",
    name: "x-fixture-internal",
    purpose: "fixture",
  }] as const;

  try {
    assert.deepEqual(
      await findInternalControlsInGeneratedOutputs(
        temporaryRoot,
        ["alternate-client"],
        controls,
      ),
      ["alternate-client/stale-client.ts exposes x-fixture-internal"],
    );
    await assert.rejects(
      checkInternalRequestControlOutputs(
        temporaryRoot,
        ["alternate-client"],
        controls,
      ),
      /Generated API or public documentation output exposes internal request controls[\s\S]*stale-client\.ts exposes x-fixture-internal/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});