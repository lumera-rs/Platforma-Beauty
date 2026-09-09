import {
  recoverInterruptedHarnessDatabases,
  runIsolatedBrowserSuite,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_cover_",
  manifestDirectoryName: "cover-image-description-browser-databases",
  specPath: "browser/cover-image-description-isolation.spec.ts",
  testLabel: "Cover image description browser regression",
  environment: {
    LUMERA_ISOLATED_COVER_IMAGE_DESCRIPTION_BROWSER_TEST: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--recover-interrupted-databases") {
    await recoverInterruptedHarnessDatabases(configuration, "browser");
    return;
  }
  if (args.length > 0) {
    throw new Error("Usage: run-cover-image-description-browser.ts [--recover-interrupted-databases]");
  }
  await recoverInterruptedHarnessDatabases(configuration, "browser");
  await runIsolatedBrowserSuite(configuration);
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});