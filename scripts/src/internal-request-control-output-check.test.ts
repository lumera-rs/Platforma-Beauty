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
  readOrvalInterfaceFieldValueShapes,
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
  return Object.keys(readOrvalInterfaceFieldValueShapes(declarations, interfaceName));
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
  const installedShapes = readOrvalInterfaceFieldValueShapes(declarations, "OutputOptions");

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
      readOrvalInterfaceFieldValueShapes(declarations, contractName),
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

test("Orval declaration shapes are stable across multiline member separators", () => {
  const compact = `
    type SchemaOutput = string | SchemaOptions | false;
    interface OutputOptions { schemas?: SchemaOutput; mock?: boolean | { path?: string; enabled?: boolean }; }
    interface SchemaOptions { path?: string; type?: "typescript" | "zod"; }
  `;
  const multilineWithoutSemicolons = `
    type SchemaOutput =
      string
      | SchemaOptions
      | false;
    interface OutputOptions {
      schemas?:
        SchemaOutput
      mock?:
        boolean
        | {
          path?: string;
          enabled?: boolean;
        }
    }
    interface SchemaOptions {
      path?:
        string
      type?:
        "typescript"
        | "zod"
    }
  `;
  const multilineWithCommas = `
    type SchemaOutput =
      string
      | SchemaOptions
      | false;
    interface OutputOptions {
      schemas?:
        SchemaOutput,
      mock?:
        boolean
        | {
          path?: string;
          enabled?: boolean;
        },
    }
    interface SchemaOptions {
      path?:
        string,
      type?:
        "typescript"
        | "zod",
    }
  `;

  for (const declarations of [multilineWithoutSemicolons, multilineWithCommas]) {
    assert.deepEqual(
      readOrvalInterfaceFieldValueShapes(declarations, "OutputOptions"),
      readOrvalInterfaceFieldValueShapes(compact, "OutputOptions"),
    );
    assert.deepEqual(
      readOrvalInterfaceFieldValueShapes(declarations, "SchemaOptions"),
      readOrvalInterfaceFieldValueShapes(compact, "SchemaOptions"),
    );
  }
});

test("malformed CRLF Orval declarations report a concise parser location", () => {
  const privateDeclarationContent = "do-not-dump-this-dependency-content";
  const declarations = [
    "interface OutputOptions {",
    "  target?: string;",
    `  // ${privateDeclarationContent}`,
    "  broken?: ;",
    "}",
  ].join("\r\n");

  assert.throws(
    () => readOrvalInterfaceFieldValueShapes(declarations, "OutputOptions"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /^Installed Orval declarations must contain valid TypeScript syntax: TS\d+ at 4:12: .+$/,
      );
      assert.doesNotMatch(error.message, new RegExp(privateDeclarationContent));
      assert.doesNotMatch(error.message, /interface OutputOptions/);
      return true;
    },
  );
});

test("malformed mixed-ending Orval declarations report a concise parser location", () => {
  const privateDeclarationContent = "do-not-dump-this-mixed-dependency-content";
  const declarations = [
    "interface OutputOptions {\r\n",
    "  target?: string;\n",
    `  // ${privateDeclarationContent}\r\n`,
    "  schemas?: string;\n",
    "  broken?: ;\r\n",
    "}",
  ].join("");

  assert.match(declarations, /\r\n/);
  assert.match(declarations, /(?<!\r)\n/);
  assert.throws(
    () => readOrvalInterfaceFieldValueShapes(declarations, "OutputOptions"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /^Installed Orval declarations must contain valid TypeScript syntax: TS\d+ at 5:12: .+$/,
      );
      assert.doesNotMatch(error.message, new RegExp(privateDeclarationContent));
      assert.doesNotMatch(error.message, /interface OutputOptions/);
      return true;
    },
  );
});

test("malformed CR-only Orval declarations report a concise parser location", () => {
  const privateDeclarationContent = "do-not-dump-this-legacy-dependency-content";
  const declarations = [
    "interface OutputOptions {",
    "  target?: string;",
    `  // ${privateDeclarationContent}`,
    "  schemas?: string;",
    "  broken?: ;",
    "}",
  ].join("\r");

  assert.doesNotMatch(declarations, /\n/);
  assert.throws(
    () => readOrvalInterfaceFieldValueShapes(declarations, "OutputOptions"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /^Installed Orval declarations must contain valid TypeScript syntax: TS\d+ at 5:12: .+$/,
      );
      assert.doesNotMatch(error.message, new RegExp(privateDeclarationContent));
      assert.doesNotMatch(error.message, /interface OutputOptions/);
      return true;
    },
  );
});

test("malformed Unicode-separated Orval declarations report a concise parser location", () => {
  for (const [name, separator] of [
    ["line", "\u2028"],
    ["paragraph", "\u2029"],
  ] as const) {
    const privateDeclarationContent =
      `do-not-dump-this-${name}-separator-dependency-content`;
    const declarations = [
      "interface OutputOptions {",
      "  target?: string;",
      `  // ${privateDeclarationContent}`,
      "  broken?: ;",
      "}",
    ].join(separator);

    assert.doesNotMatch(declarations, /[\r\n]/);
    assert.throws(
      () => readOrvalInterfaceFieldValueShapes(declarations, "OutputOptions"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /^Installed Orval declarations must contain valid TypeScript syntax: TS\d+ at 4:12: .+$/,
        );
        assert.doesNotMatch(error.message, new RegExp(privateDeclarationContent));
        assert.doesNotMatch(error.message, /interface OutputOptions/);
        return true;
      },
    );
  }
});

test("Orval declaration comments do not alter quoted or template-literal shapes", () => {
  const declarations = `
    type LiteralOutput =
      "https://example.test/a//b"
      | '/* retained block marker */'
      | \`route//segment/* retained */ \${string}\`
      // ignored line comment
      | false;

    interface OutputOptions {
      /* ignored field comment */
      target?: LiteralOutput;
      marker?: "  spaces // stay  " | \`/* exact */  \${number}\`;
      // ignored member comment
      clean?: string /* ignored inline comment */ | false;
    }
  `;

  assert.deepEqual(
    readOrvalInterfaceFieldValueShapes(declarations, "OutputOptions"),
    {
      target: [
        '"https://example.test/a//b"',
        "'/* retained block marker */'",
        "`route//segment/* retained */ ${string}`",
        "false",
      ],
      marker: [
        '"  spaces // stay  "',
        "`/* exact */  ${number}`",
      ],
      clean: ["string", "false"],
    },
  );
});

test("complex template substitutions cannot weaken Orval declaration shape checks", () => {
  const declarations = [
    "type NestedTemplate =",
    "  `root${{",
    '    nested: `child${"escaped \\` delimiter" | "escaped \\" quote"}`;',
    '    commented: /* ignored block | } ` */ "left" // ignored line | } `',
    '      | "right";',
    "  }[\"nested\"]}/tail`",
    "  | false;",
    "",
    "interface OutputOptions {",
    "  target?: NestedTemplate;",
    '  futureOutputDirectory?: `out/${Record<"a|b", `nested/${"x}" | "y\\`"}`>["a|b"]}`;',
    "}",
  ].join("\n");

  const shapes = readOrvalInterfaceFieldValueShapes(declarations, "OutputOptions");

  assert.equal(shapes.target.length, 2);
  assert.match(shapes.target[0], /^`root\$\{\{/);
  assert.ok(
    shapes.target[0].includes(
      '`child${"escaped \\` delimiter" | "escaped \\" quote"}`',
    ),
  );
  assert.match(shapes.target[0], /commented:\s*"left" \| "right"/);
  assert.doesNotMatch(shapes.target[0], /ignored (?:block|line)/);
  assert.equal(shapes.target[1], "false");
  assert.deepEqual(shapes.futureOutputDirectory, [
    '`out/${Record<"a|b", `nested/${"x}" | "y\\`"}`>["a|b"]}`',
  ]);
  assert.throws(
    () => assertOrvalOutputContractRecognized(Object.keys(shapes)),
    /output\.futureOutputDirectory/,
  );
});

test("separator-only formatting cannot hide new Orval output fields", () => {
  for (const separator of [",", ""]) {
    const declarations = `
      interface OutputOptions {
        target: string${separator}
        futureOutputDirectory:
          string
      }
    `;
    const installedOptions = readInterfaceFieldNames(declarations, "OutputOptions");

    assert.deepEqual(installedOptions, ["target", "futureOutputDirectory"]);
    assert.throws(
      () => assertOrvalOutputContractRecognized(installedOptions),
      /output\.futureOutputDirectory/,
    );
  }
});

test("multiline semantic shape changes report the exact Orval config path", () => {
  for (const separator of [",", ""]) {
    const declarations = `
    interface SchemaOptions {
      path?:
        string
        | FutureSchemaPathOptions${separator}
      type?: "typescript"
    }
  `;

    assert.throws(
      () => assertOrvalNestedFileProducingOutputValueShapesRecognized({
        SchemaOptions: readOrvalInterfaceFieldValueShapes(declarations, "SchemaOptions"),
      }),
      /output\.schemas\.path \(SchemaOptions\):[\s\S]*FutureSchemaPathOptions/,
    );
  }
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