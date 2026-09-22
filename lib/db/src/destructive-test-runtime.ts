export const destructiveTestGuardEnvironments = [
  { name: "NODE_ENV=production", values: { NODE_ENV: "production" } },
  { name: "REPLIT_DEPLOYMENT=1", values: { REPLIT_DEPLOYMENT: "1" } },
  { name: "REPL_DEPLOYMENT=1", values: { REPL_DEPLOYMENT: "1" } },
] as const;

export const playwrightDisposableDatabaseNamePatterns = {
  admin: /^lumera_admin_browser_\d+_[a-f0-9]{32}$/,
  adminFormResilience: /^lumera_form_browser_\d+_[a-f0-9]{32}$/,
  salonNotification: /^lumera_alert_browser_\d+_[a-f0-9]{32}$/,
  retailCheckout: /^lumera_retail_browser_\d+_[a-f0-9]{32}$/,
  retentionPreview: /^(?:lumera_retention_estimate_browser_|lumera_retention_exact_browser_|lumera_retention_stratified_browser_)\d+_[a-f0-9]{32}$/,
  infobipRegistration: /^lumera_infobip_registration_browser_\d+_[a-f0-9]{32}$/,
  beautyJobs: /^lumera_bjobs_\d+_[a-f0-9]{32}$/,
  educationGroupOnlineConsent: /^lumera_education_group_browser_\d+_[a-f0-9]{32}$/,
  educationGallery: /^lumera_education_gallery_browser_\d+_[a-f0-9]{32}$/,
  coverImageDescription: /^lumera_cover_\d+_[a-f0-9]{32}$/,
  bookingSettings: /^lumera_booking_settings_browser_\d+_[a-f0-9]{32}$/,
} as const;

const disposableDatabaseNames = new Set([
  "lumera_ci_database",
  "lumera_ci_browser",
]);

export function isProductionOrDeploymentRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    environment.NODE_ENV === "production"
    || environment.REPLIT_DEPLOYMENT === "1"
    || environment.REPL_DEPLOYMENT === "1"
  );
}

type DatabaseTargetInspection = {
  disposable: boolean;
  description: string;
};

function inspectDatabaseTarget(databaseUrl: string): DatabaseTargetInspection {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return { disposable: false, description: "database name unknown/malformed" };
    }

    // Do not classify connection strings whose query can independently name a
    // database. This remains fail-closed if pg's precedence rules change.
    if (
      parsed.searchParams.has("database")
      || parsed.searchParams.has("dbname")
      || parsed.searchParams.has("db")
    ) {
      return { disposable: false, description: "database name unknown/ambiguous" };
    }

    const encodedName = parsed.pathname.slice(1);
    if (!encodedName || encodedName.includes("/")) {
      return { disposable: false, description: "database name unknown/malformed" };
    }
    const databaseName = decodeURIComponent(encodedName);
    return {
      disposable: disposableDatabaseNames.has(databaseName)
      || Object.values(playwrightDisposableDatabaseNamePatterns)
        .some((pattern) => pattern.test(databaseName)),
      description: `database ${JSON.stringify(databaseName)}`,
    };
  } catch {
    return { disposable: false, description: "database name unknown/malformed" };
  }
}

export function assertDestructiveTestRuntimeAllowed(
  environment: NodeJS.ProcessEnv = process.env,
  label = "Destructive test harness",
): void {
  if (isProductionOrDeploymentRuntime(environment)) {
    throw new Error(
      `Destructive test harnesses refuse production or deployment runtimes. Blocked: ${label}.`,
    );
  }

  const databaseUrl = environment.DATABASE_URL;
  if (
    !databaseUrl
    || environment.LUMERA_DISPOSABLE_DATABASE === databaseUrl
  ) {
    return;
  }

  const targetInspection = inspectDatabaseTarget(databaseUrl);
  if (targetInspection.disposable) return;

  throw new Error(
    `Destructive test harnesses refuse non-disposable database targets. `
    + `Blocked ${targetInspection.description}: ${label}. `
    + "Use an empty DATABASE_URL or a harness-generated disposable database. "
    + "Run destructive commands through: pnpm --filter @workspace/scripts exec tsx "
    + "src/run-destructive-test.ts -- <command...>",
  );
}
