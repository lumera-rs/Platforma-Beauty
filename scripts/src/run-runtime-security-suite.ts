import {
  runIsolatedApiRegressionSuiteCommand,
  type IsolatedApiRegressionSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedApiRegressionSuiteConfiguration = {
  databasePrefix: "lumera_runtime_security_",
  manifestDirectoryName: "runtime-security-suite-databases",
  testLabel: "Task #10: runtime adversarial security suite",
  scriptPaths: ["scripts/test-runtime-security-suite.sh"],
  environment: {
    LUMERA_ISOLATED_RUNTIME_SECURITY_TEST: "1",
  },
};

void runIsolatedApiRegressionSuiteCommand(configuration);
