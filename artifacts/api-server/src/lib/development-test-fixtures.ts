/**
 * Development/test-only fixture entry point.
 *
 * Keep this module behind the runtime check in seed.ts.  It is intentionally
 * loaded lazily so importing the compatibility facade in production cannot
 * import fixture dependencies or issue a database query.
 */
import { isExplicitFixtureRuntime, runDemoFixtureSequence } from "./seed";

export async function initializeDevelopmentTestFixtures(): Promise<void> {
  if (!isExplicitFixtureRuntime(process.env)) {
    throw new Error(
      "Development/test fixtures require NODE_ENV=development or NODE_ENV=test.",
    );
  }
  // Re-check with the repository's authoritative deployment guard after the
  // explicit environment pre-check and before loading DB-backed fixtures.
  const { isProductionOrDeploymentRuntime } = await import("@workspace/db/destructive-test-runtime");
  if (isProductionOrDeploymentRuntime()) {
    throw new Error(
      "Development/test fixtures refuse production or deployment runtimes.",
    );
  }
  await runDemoFixtureSequence();
}
