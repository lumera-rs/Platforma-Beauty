import {
  runIsolatedApiRegressionSuiteCommand,
  type IsolatedApiRegressionSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedApiRegressionSuiteConfiguration = {
  databasePrefix: "lumera_api_regression_",
  manifestDirectoryName: "api-regression-databases",
  testLabel: "API regression checks",
  scriptPaths: [
    "scripts/test-admin-authorization.sh",
    "scripts/test-admin-input-validation.sh",
    "scripts/test-b2b-catalog.sh",
    "scripts/test-education-authorization.sh",
    "scripts/test-marketplace-discovery.sh",
  ],
  environment: {
    LUMERA_ISOLATED_API_REGRESSION_TEST: "1",
  },
};

void runIsolatedApiRegressionSuiteCommand(configuration);