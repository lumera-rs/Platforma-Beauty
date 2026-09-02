import {
  runIsolatedApiSuiteCommand,
  type IsolatedApiSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedApiSuiteConfiguration = {
  databasePrefix: "lumera_edu_place_",
  manifestDirectoryName: "education-placement-databases",
  testFilePath: "../artifacts/api-server/src/lib/education-placement-lifecycle.test.ts",
  testLabel: "Education placement lifecycle API checks",
  environment: {
    LUMERA_ISOLATED_EDUCATION_PLACEMENT_TEST: "1",
  },
};

void runIsolatedApiSuiteCommand(configuration);