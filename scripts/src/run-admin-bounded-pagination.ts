import {
  runIsolatedBrowserSuiteCommand,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

/**
 * Runs the bounded admin pagination spec against its own database and web/API
 * processes, the way every other browser suite in the release chain runs.
 *
 * The script previously went through `playwright:checked`, whose pre-flight
 * expects the shared dev workflows to already be listening on :80. That is fine
 * locally but cannot hold in the release gate, where nothing starts those
 * workflows — the suite failed at pre-flight before a single spec ran. Its
 * sibling, admin-navigation-regression, already had this runner; this is the
 * same thing for the same reason.
 */
const configuration: IsolatedBrowserSuiteConfiguration = {
  // Shares the admin browser prefix and marker with run-admin-navigation-
  // regression.ts on purpose: playwright.config.ts validates the harness
  // database name against a per-marker pattern, and a new prefix would need its
  // own branch there for no benefit. The manifest directory stays separate so
  // the two suites never claim each other's databases.
  databasePrefix: "lumera_admin_browser_",
  manifestDirectoryName: "admin-bounded-pagination-databases",
  specPath: "browser/admin-bounded-pagination.spec.ts",
  testLabel: "Admin bounded pagination browser checks",
  environment: {
    LUMERA_ISOLATED_ADMIN_BROWSER_TEST: "1",
  },
};

void runIsolatedBrowserSuiteCommand(configuration);
