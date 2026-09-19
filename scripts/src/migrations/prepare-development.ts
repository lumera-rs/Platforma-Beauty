import type { DatabaseClient } from "../backend-standards-database";
import {
  classifyDeploymentEligibility,
  type DeploymentEligibilityReport,
} from "./deployment-eligibility";
import { applyMigrations } from "./runner";
import type {
  LoadedMigration,
  MigrationRunResult,
  MigrationRunnerOptions,
} from "./types";

export interface DevelopmentPreparationEnvironment {
  readonly NODE_ENV?: string;
  readonly REPLIT_DEPLOYMENT?: string;
  readonly REPLIT_DEPLOYMENT_ID?: string;
  readonly REPLIT_ENVIRONMENT?: string;
}

export interface PrepareDevelopmentOptions
  extends Omit<MigrationRunnerOptions, "migrations"> {
  readonly migrations?: readonly LoadedMigration[];
  readonly environment?: DevelopmentPreparationEnvironment;
}

export interface DevelopmentPreparationResult {
  readonly eligibility: DeploymentEligibilityReport;
  readonly migration: MigrationRunResult;
}

export class DevelopmentPreparationError extends Error {
  readonly eligibility: DeploymentEligibilityReport;

  constructor(eligibility: DeploymentEligibilityReport) {
    super(
      `Development migration preparation refused: ${eligibility.reasons.join(", ") || "unsupported database state"}`,
    );
    this.name = "DevelopmentPreparationError";
    this.eligibility = eligibility;
  }
}

/**
 * Prepares an explicitly supplied development client using the migration
 * runner. This function deliberately has no pool or DATABASE_URL fallback.
 *
 * Eligibility is read in a repeatable-read, read-only transaction before the
 * runner is called. The runner repeats the admission check while holding its
 * migration locks, so the first report is advisory only and cannot create a
 * time-of-check/time-of-use write window.
 */
export async function prepareDevelopmentMigrations(
  client: DatabaseClient,
  options: PrepareDevelopmentOptions = {},
): Promise<DevelopmentPreparationResult> {
  const environment = options.environment ?? process.env;
  if (
    environment.NODE_ENV === "production"
    || environment.REPLIT_DEPLOYMENT === "1"
    || environment.REPLIT_DEPLOYMENT_ID
    || environment.REPLIT_ENVIRONMENT === "production"
  ) {
    throw new Error("Development migration preparation refuses production or deployment runtimes");
  }

  const { environment: _environment, ...runnerOptions } = options;
  let eligibility: DeploymentEligibilityReport;
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    eligibility = await classifyDeploymentEligibility(client, {
      migrations: options.migrations,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  if (eligibility.path === "UNSUPPORTED") {
    throw new DevelopmentPreparationError(eligibility);
  }

  const migration = await applyMigrations(client, {
    ...runnerOptions,
    migrations: options.migrations,
  });
  return { eligibility, migration };
}