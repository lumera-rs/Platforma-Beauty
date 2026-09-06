import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

/**
 * Runs the customer booking journey against a disposable database and its own
 * web/API processes, the same way the wired browser suites run on CI.
 *
 * `pnpm run test:booking-journey` expects the shared dev workflows to already
 * be listening on :80, so it cannot run unattended. This entry point exists so
 * the booking audit can exercise the journey; it is deliberately NOT part of
 * any `validate:release` phase until it has passed on CI.
 */
const configuration: IsolatedBrowserSuiteConfiguration = {
  // Short on purpose: the harness appends a pid and a 32-char hex suffix, and
  // PostgreSQL truncates identifiers at 63 characters.
  databasePrefix: "lumera_bjourney_",
  manifestDirectoryName: "booking-journey-browser-databases",
  specPath: "browser/booking-journey.spec.ts",
  testLabel: "Customer booking journey browser checks",
  environment: {
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
