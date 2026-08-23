import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_infobip_registration_browser_",
  manifestDirectoryName: "infobip-registration-browser-databases",
  specPath: "browser/infobip-registration.spec.ts",
  testLabel: "Infobip registration browser checks",
  environment: {
    LUMERA_ISOLATED_INFOBIP_REGISTRATION_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);