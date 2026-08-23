import {
  runIsolatedApiSuiteCommand,
  type IsolatedApiSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedApiSuiteConfiguration = {
  databasePrefix: "lumera_retail_api_",
  manifestDirectoryName: "retail-checkout-api-databases",
  testFilePath: "../artifacts/api-server/src/lib/retail-checkout.test.ts",
  testLabel: "Retail checkout API checks",
  environment: {
    LUMERA_ISOLATED_RETAIL_CHECKOUT_API_TEST: "1",
  },
};

void runIsolatedApiSuiteCommand(configuration);