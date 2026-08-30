import {
  runIsolatedApiSuiteCommand,
  type IsolatedApiSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedApiSuiteConfiguration = {
  databasePrefix: "lumera_rescheduled_confirmation_",
  manifestDirectoryName: "rescheduled-confirmation-databases",
  testFilePath: "../artifacts/api-server/src/lib/rescheduled-confirmation-retries.test.ts",
  testLabel: "Rescheduled confirmation retry checks",
  environment: {
    LUMERA_ISOLATED_RESCHEDULED_CONFIRMATION_TEST: "1",
  },
};

void runIsolatedApiSuiteCommand(configuration);