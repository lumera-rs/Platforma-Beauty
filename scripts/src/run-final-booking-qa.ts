import {
  runIsolatedApiSuiteCommand,
  type IsolatedApiSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedApiSuiteConfiguration = {
  databasePrefix: "lumera_final_booking_qa_",
  manifestDirectoryName: "final-booking-qa-databases",
  testFilePath: "../artifacts/api-server/src/lib/final-booking-hardening.test.ts",
  testLabel: "Final booking QA checks",
  environment: {
    LUMERA_ISOLATED_FINAL_BOOKING_QA_TEST: "1",
  },
};

void runIsolatedApiSuiteCommand(configuration);