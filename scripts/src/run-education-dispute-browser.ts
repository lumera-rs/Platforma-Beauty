import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_education_dispute_browser_",
  manifestDirectoryName: "education-dispute-browser-databases",
  specPath: "browser/education-dispute.spec.ts",
  testLabel: "Education dispute browser checks",
  environment: {
    LUMERA_ISOLATED_EDUCATION_DISPUTE_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);