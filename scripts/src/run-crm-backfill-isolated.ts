/**
 * Real fixture/maintenance integration coverage, deliberately separate from
 * the DB-free production boundary suite. This provisions a disposable schema;
 * do not run it when schema setup is prohibited.
 */
import { runIsolatedApiSuiteCommand } from "./run-isolated-browser-suite";

await runIsolatedApiSuiteCommand({
  databasePrefix: "lumera_crm_backfill_",
  manifestDirectoryName: "crm-backfill-databases",
  testLabel: "Explicit fixtures and CRM maintenance",
  testFilePath: "../artifacts/api-server/src/lib/seed.test.ts",
  environment: {},
});