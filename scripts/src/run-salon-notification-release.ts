import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_alert_browser_",
  manifestDirectoryName: "salon-notification-browser-databases",
  specPath: "browser/salon-notification-isolation.spec.ts",
  testLabel: "Salon notification release checks",
  environment: {
    LUMERA_ISOLATED_SALON_NOTIFICATION_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);