import {
  runIsolatedApiSuiteCommand,
  type IsolatedApiSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedApiSuiteConfiguration = {
  databasePrefix: "lumera_edu_ips_safety_",
  manifestDirectoryName: "education-ips-production-safety-databases",
  testFilePath: "../artifacts/api-server/src/lib/education-ips-production-safety.test.ts",
  testLabel: "Education IPS production-safety guard checks",
  environment: {
    LUMERA_ISOLATED_EDUCATION_IPS_PRODUCTION_SAFETY_TEST: "1",
  },
};

void runIsolatedApiSuiteCommand(configuration);
