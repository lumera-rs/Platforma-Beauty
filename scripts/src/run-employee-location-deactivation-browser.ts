import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_employee_deactivation_browser_",
  manifestDirectoryName: "employee-location-deactivation-browser-databases",
  specPath: "browser/employee-location-deactivation.spec.ts",
  testLabel: "Employee location deactivation browser checks",
  environment: {
    LUMERA_ISOLATED_EMPLOYEE_LOCATION_DEACTIVATION_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
