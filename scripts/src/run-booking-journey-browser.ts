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
  // These specs drive the whole booking journey across desktop and mobile
  // viewports; the heaviest take well over a minute on a modest runner, and
  // several sit at 45-52 s. Playwright's 30 s default would fail them for being
  // slow rather than wrong, so the suite carries its own budget instead of
  // depending on how fast the machine happens to be.
  timeoutMs: 180_000,
  environment: {
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
