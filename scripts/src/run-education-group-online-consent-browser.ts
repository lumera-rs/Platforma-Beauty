import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_education_group_browser_",
  manifestDirectoryName: "education-group-online-consent-browser-databases",
  specPath: "browser/education-group-online-consent.spec.ts",
  testLabel: "Education online group consent browser checks",
  environment: {
    LUMERA_ISOLATED_EDUCATION_GROUP_ONLINE_CONSENT_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);