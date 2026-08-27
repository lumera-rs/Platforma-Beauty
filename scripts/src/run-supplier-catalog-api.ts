import {
  runIsolatedApiSuiteCommand,
  type IsolatedApiSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedApiSuiteConfiguration = {
  databasePrefix: "lumera_supplier_api_",
  manifestDirectoryName: "supplier-catalog-api-databases",
  testFilePath: "../artifacts/api-server/src/lib/supplier-catalog.test.ts",
  testLabel: "Supplier catalog API checks",
  environment: {
    LUMERA_ISOLATED_SUPPLIER_CATALOG_API_TEST: "1",
  },
};

void runIsolatedApiSuiteCommand(configuration);