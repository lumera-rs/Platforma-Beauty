import {
  recoverInterruptedHarnessDatabases,
  runIsolatedBrowserSuite,
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

async function run(): Promise<void> {
  const commandArguments = process.argv.slice(2);
  if (commandArguments.length === 1 && commandArguments[0] === "--recover-interrupted-databases") {
    await recoverInterruptedHarnessDatabases(configuration, "browser");
    return;
  }
  if (commandArguments.length > 0) {
    throw new Error(
      "Usage: run-infobip-registration-browser.ts [--recover-interrupted-databases]",
    );
  }

  // A forced stop bypasses Playwright's afterAll cleanup. Recover any stale
  // disposable run before creating the next database so its synthetic
  // provider receipt cannot influence a later check.
  await recoverInterruptedHarnessDatabases(configuration, "browser");
  await runIsolatedBrowserSuite(configuration);
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
