import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_booking_settings_browser_",
  manifestDirectoryName: "booking-settings-browser-databases",
  specPath: "browser/booking-settings.spec.ts",
  testLabel: "Booking settings browser checks",
  environment: {
    LUMERA_ISOLATED_BOOKING_SETTINGS_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
