import {
  runIsolatedApiRegressionSuiteCommand,
  type IsolatedApiRegressionSuiteConfiguration,
} from "./run-isolated-browser-suite";
import { startObjectStorageStubIfAbsent } from "./object-storage-stub";

const configuration: IsolatedApiRegressionSuiteConfiguration = {
  databasePrefix: process.env.LUMERA_API_REGRESSION_DATABASE_PREFIX ?? "lumera_api_regression_",
  manifestDirectoryName:
    process.env.LUMERA_API_REGRESSION_MANIFEST_DIRECTORY ?? "api-regression-databases",
  testLabel: "API regression checks",
  scriptPaths: [
    "scripts/test-admin-authorization.sh",
    "scripts/test-admin-input-validation.sh",
    "scripts/test-b2b-catalog.sh",
    "scripts/test-damaged-timestamp-serialization.sh",
    "scripts/test-education-authorization.sh",
    "scripts/test-marketplace-discovery.sh",
  ],
  environment: {
    LUMERA_ISOLATED_API_REGRESSION_TEST: "1",
  },
};

/**
 * test-b2b-catalog.sh drives the real product-image flow (request upload ->
 * PUT bytes -> finalize) and product creation refuses images the caller did not
 * upload, so the suite genuinely needs an App Storage sidecar. Replit provides
 * one; GitHub runners do not. The stub supplies only that contract when nothing
 * is already listening, so the media assertions keep running everywhere instead
 * of being skipped, while Replit continues to use real App Storage untouched.
 */
void (async () => {
  const objectStorage = await startObjectStorageStubIfAbsent();
  try {
    await runIsolatedApiRegressionSuiteCommand({
      ...configuration,
      environment: { ...configuration.environment, ...objectStorage.environment },
    });
  } finally {
    await objectStorage.close();
  }
})();