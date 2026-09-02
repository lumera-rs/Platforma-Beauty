import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_form_browser_",
  manifestDirectoryName: "admin-form-resilience-browser-databases",
  specPath: "browser/admin-form-resilience.spec.ts",
  testLabel: "Admin form resilience browser checks",
  environment: {
    LUMERA_ISOLATED_ADMIN_FORM_RESILIENCE_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
