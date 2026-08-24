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
    RETENTION_PREVIEW_MAX_CUSTOMERS: "100",
    RETENTION_PREVIEW_SHARE_MIN_CUSTOMERS: "40",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

const stratifiedEstimateConfiguration: IsolatedBrowserSuiteConfiguration = {
  databasePrefix: "lumera_retention_stratified_browser_",
  manifestDirectoryName: "retention-preview-stratified-browser-databases",
  specPath: "browser/retention-preview-estimate.spec.ts",
  testLabel: "Retention preview stratified estimate browser checks",
  environment: {
    LUMERA_ISOLATED_RETENTION_PREVIEW_BROWSER_TEST: "1",
    LUMERA_RETENTION_PREVIEW_EXPECT_ESTIMATE: "1",
    LUMERA_RETENTION_PREVIEW_EXPECT_SALON_ESTIMATE: "1",
    RETENTION_PREVIEW_MAX_CUSTOMERS: "79",
    RETENTION_PREVIEW_SAMPLE_SIZE: "80",
    RETENTION_PREVIEW_SALON_SAMPLE_SIZE: "30",
    RETENTION_PREVIEW_SALON_MIN_SAMPLE_SIZE: "3",
    RETENTION_PREVIEW_SALON_MAX_STRATA: "5",
    LUMERA_RELEASE_BROWSER_TEST: "1",
  },
};

async function run(): Promise<void> {
  const commandArguments = process.argv.slice(2);
  if (commandArguments.length === 1 && commandArguments[0] === "--recover-interrupted-databases") {
    await recoverInterruptedHarnessDatabases(estimateConfiguration);
    await recoverInterruptedHarnessDatabases(exactConfiguration);
    await recoverInterruptedHarnessDatabases(stratifiedEstimateConfiguration);
    return;
  }
  if (commandArguments.length > 0) {
    throw new Error("Usage: run-retention-preview.ts [--recover-interrupted-databases]");
  }

  // Each pass gets a fresh database and API process, so the cap is applied at
  // server startup and the exact control run cannot inherit estimate mode.
  await runIsolatedBrowserSuite(estimateConfiguration);
  await runIsolatedBrowserSuite(exactConfiguration);
  await runIsolatedBrowserSuite(stratifiedEstimateConfiguration);
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
