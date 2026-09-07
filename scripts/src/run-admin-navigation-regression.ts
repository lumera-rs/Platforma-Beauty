import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_admin_browser_",
  manifestDirectoryName: "admin-browser-databases",
  specPath: "browser/admin-navigation-regression.spec.ts",
  testLabel: "Admin navigation regression browser checks",
  environment: {
    LUMERA_ISOLATED_ADMIN_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);