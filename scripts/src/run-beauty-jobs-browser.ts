import {
  recoverInterruptedHarnessDatabases,
  runIsolatedBrowserSuite,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const configuration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_bjobs_",
  manifestDirectoryName: "beauty-jobs-browser-databases",
  specPath: "browser/beauty-jobs-isolation.spec.ts",
  testLabel: "Beauty Poslovi browser isolation checks",
  environment: {
    LUMERA_ISOLATED_BEAUTY_JOBS_BROWSER_TEST: "1",
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
      "Usage: run-beauty-jobs-browser.ts [--recover-interrupted-databases]",
    );
  }

  await recoverInterruptedHarnessDatabases(configuration, "browser");
  await runIsolatedBrowserSuite(configuration);
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});