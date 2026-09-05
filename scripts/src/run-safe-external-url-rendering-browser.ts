import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_safe_url_browser_",
  manifestDirectoryName: "safe-external-url-rendering-browser-databases",
  specPath: "browser/safe-external-url-rendering.spec.ts",
  testLabel: "Task #9B: safe external-URL scheme regression",
  environment: {
    LUMERA_ISOLATED_SAFE_EXTERNAL_URL_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
