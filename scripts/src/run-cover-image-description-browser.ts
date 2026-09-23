import {
  recoverInterruptedHarnessDatabases,
  runIsolatedBrowserSuite,
  type IsolatedBrowserSuiteConfiguration,
} from "./run-isolated-browser-suite";
import { startObjectStorageStubIfAbsent } from "./object-storage-stub";

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

const mobileConfiguration: IsolatedBrowserSuiteConfiguration = {
  ...configuration,
  testLabel: "Mobile cover image description browser regression",
  environment: {
    ...configuration.environment,
    LUMERA_COVER_IMAGE_DESCRIPTION_MOBILE: "1",
  },
};

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--recover-interrupted-databases") {
    await recoverInterruptedHarnessDatabases(configuration, "browser");
    return;
  }
  const mobile = args.length === 1 && args[0] === "--mobile";
  if (args.length > 0 && !mobile) {
    throw new Error(
      "Usage: run-cover-image-description-browser.ts [--mobile|--recover-interrupted-databases]",
    );
  }
  const selected = mobile ? mobileConfiguration : configuration;
  await recoverInterruptedHarnessDatabases(selected, "browser");
  const objectStorage = await startObjectStorageStubIfAbsent();
  try {
    await runIsolatedBrowserSuite({
      ...selected,
      environment: { ...selected.environment, ...objectStorage.environment },
    });
  } finally {
    await objectStorage.close();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});