import {
  recoverInterruptedHarnessDatabases,
  runIsolatedBrowserSuite,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";

const estimateConfiguration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_retention_estimate_browser_",
  manifestDirectoryName: "retention-preview-estimate-browser-databases",
  specPath: "browser/retention-preview-estimate.spec.ts",
  testLabel: "Retention preview estimate browser checks",
  environment: {
    LUMERA_ISOLATED_RETENTION_PREVIEW_BROWSER_TEST: "1",
    LUMERA_RETENTION_PREVIEW_EXPECT_ESTIMATE: "1",
    RETENTION_PREVIEW_MAX_CUSTOMERS: "1",
    RETENTION_PREVIEW_SAMPLE_SIZE: "1",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

const exactConfiguration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_retention_exact_browser_",
  manifestDirectoryName: "retention-preview-exact-browser-databases",
  specPath: "browser/retention-preview-estimate.spec.ts",
  testLabel: "Retention preview exact control browser checks",
  environment: {
    LUMERA_ISOLATED_RETENTION_PREVIEW_BROWSER_TEST: "1",
    LUMERA_RETENTION_PREVIEW_EXPECT_ESTIMATE: "0",
    RETENTION_PREVIEW_MAX_CUSTOMERS: "3",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

async function run(): Promise<void> {
  const commandArguments = process.argv.slice(2);
  if (commandArguments.length === 1 && commandArguments[0] === "--recover-interrupted-databases") {
    await recoverInterruptedHarnessDatabases(estimateConfiguration);
    await recoverInterruptedHarnessDatabases(exactConfiguration);
    return;
  }
  if (commandArguments.length > 0) {
    throw new Error("Usage: run-retention-preview.ts [--recover-interrupted-databases]");
  }

  // Each pass gets a fresh database and API process, so the cap is applied at
  // server startup and the exact control run cannot inherit estimate mode.
  await runIsolatedBrowserSuite(estimateConfiguration);
  await runIsolatedBrowserSuite(exactConfiguration);
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
