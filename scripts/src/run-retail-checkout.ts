import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_retail_browser_",
  manifestDirectoryName: "retail-checkout-browser-databases",
  specPath: "browser/retail-checkout.spec.ts",
  testLabel: "Retail checkout browser checks",
  environment: {
    LUMERA_ISOLATED_RETAIL_CHECKOUT_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);