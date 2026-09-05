import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_cache_residue_browser_",
  manifestDirectoryName: "logout-login-cache-residue-browser-databases",
  specPath: "browser/logout-login-cache-residue.spec.ts",
  testLabel: "Task #9A: logout/login cross-user cache residue checks",
  environment: {
    LUMERA_ISOLATED_CACHE_RESIDUE_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
