import { defineConfig, InputTransformerFn } from "orval";
import path from "path";
import {
  apiOutputInventory,
  defineInventoriedGeneratorConfig,
} from "./api-output-inventory.mjs";

const root = path.resolve(__dirname, "..", "..");
const outputRoot = process.env.API_CODEGEN_OUTPUT_ROOT
  ? path.resolve(process.env.API_CODEGEN_OUTPUT_ROOT)
  : root;
function generatorDestination(name: string) {
  const source = apiOutputInventory.generators[name].source;
  return {
    workspace: path.resolve(outputRoot, path.dirname(source)),
    target: path.basename(source),
  };
}

const apiClientReactDestination = generatorDestination("api-client-react");
const apiZodDestination = generatorDestination("zod");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig(defineInventoriedGeneratorConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactDestination.workspace,
      target: apiClientReactDestination.target,
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      // Generates a typed `headers` function/mutation parameter for any
      // operation that declares OpenAPI header parameters (using the same
      // mechanism already used for query params), instead of leaving
      // required headers reachable only through the generic, untyped
      // `request` mutator-options passthrough. Endpoints with no header
      // parameters are unaffected; optional headers stay optional.
      headers: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactDestination.workspace, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodDestination.workspace,
      client: "zod",
      target: apiZodDestination.target,
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
}, outputRoot));
