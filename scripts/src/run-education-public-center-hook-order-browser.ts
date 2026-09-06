import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_edu_center_hook_order_browser_",
  manifestDirectoryName: "education-public-center-hook-order-browser-databases",
  specPath: "browser/education-public-center-hook-order.spec.ts",
  testLabel: "Task #9C: EducationPublicCenterPage hook-order regression",
  environment: {
    LUMERA_ISOLATED_EDU_CENTER_HOOK_ORDER_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
