import app from "./app";
import { closePool, databasePoolStats } from "@workspace/db";
import { logger } from "./lib/logger";
import { runRescheduledConfirmationRetries } from "./lib/rescheduled-confirmation-retries";
import { processUpcomingEducationSessions } from "./lib/education-sessions";
import {
  startSalonNotificationEventListener,
  stopSalonNotificationEventListener,
} from "./lib/salon-notification-events";
import { runEducationGalleryCleanup } from "./routes/marketplace";
import { cleanupExpiredImageAssets } from "./routes/image-media";
import { runMediaUploadCleanup } from "./routes/media";
import { migrateLegacyMediaReferences } from "./lib/media-migration";
import { ensureMediaSchema } from "./lib/media-schema";
import { ensureBusinessGrowthSchema } from "./lib/business-growth-schema";
import { ensureShippingConfigSchema } from "./lib/shipping-config";
import {
  catalogCacheStats,
  startCatalogCacheInvalidationListener,
  stopCatalogCacheInvalidationListener,
} from "./lib/catalog-cache";
import { runCommunicationArchiveBatch } from "./lib/communication-archive";
import { registerFatalHandlers } from "./lib/process-lifecycle";
import { runAutomationWorker } from "./lib/automation-worker";
import { runDeliveryReportRecoveryAlerts, runDeliveryReportSilenceAlerts, runMalformedWebhookAlerts } from "./lib/delivery-report-alerts";
import { ensureMarketplacePerformanceIndexes } from "./lib/marketplace-performance-schema";
import { createResilientScheduledJob } from "./lib/scheduler-resilience";
import { runBrevoWebhookCoverageMonitor } from "./lib/monitoring";
import { expireBeautyJobListings } from "./lib/beauty-jobs-maintenance";
import { runBeautyJobDeliveryFailureAlerts } from "./lib/beauty-jobs-delivery-monitor";
import { reconcileKnownTestListings } from "./lib/test-listing-reconciliation";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Production does not run drizzle-kit push. Roll out additive schema changes
// before DB listeners, listen(), and every scheduler/worker so the very first
// query sees the required objects.
await ensureBusinessGrowthSchema();
await ensureMediaSchema();
await ensureShippingConfigSchema();
await ensureMarketplacePerformanceIndexes();
await reconcileKnownTestListings();

void startSalonNotificationEventListener().catch((error: unknown) => {
  logger.error({ err: error }, "Salon notification event listener failed to start");
});
void startCatalogCacheInvalidationListener().catch((error: unknown) => {
  logger.error({ err: error }, "Catalog cache invalidation listener failed to start");
});
const server = app.listen(port, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// ---------------------------------------------------------------------------
// Scheduled tasks
// ---------------------------------------------------------------------------

const rescheduledConfirmationRetries = createResilientScheduledJob({
  job: "rescheduled-confirmation-retries",
  run: runRescheduledConfirmationRetries,
});
const educationSessionMaintenance = createResilientScheduledJob({
  job: "education-session-maintenance",
  run: processUpcomingEducationSessions,
});
const educationGalleryCleanup = createResilientScheduledJob({
  job: "education-gallery-cleanup",
  run: runEducationGalleryCleanup,
});
const mediaUploadCleanup = createResilientScheduledJob({
  job: "media-upload-cleanup",
  run: runMediaUploadCleanup,
});
const compatibilityImageCleanup = createResilientScheduledJob({
  job: "compatibility-image-cleanup",
  run: cleanupExpiredImageAssets,
});
const communicationArchive = createResilientScheduledJob({
  job: "communication-archive",
  run: runCommunicationArchiveBatch,
});
const automationWorker = createResilientScheduledJob({
  job: "automation-worker",
  run: runAutomationWorker,
});
const deliveryReportSilenceAlerts = createResilientScheduledJob({
  job: "delivery-report-silence-alerts",
  run: runDeliveryReportSilenceAlerts,
});
const deliveryReportRecoveryAlerts = createResilientScheduledJob({
  job: "delivery-report-recovery-alerts",
  run: runDeliveryReportRecoveryAlerts,
});

const brevoWebhookCoverageMonitor = createResilientScheduledJob({
  job: "brevo-webhook-coverage-monitor",
  run: runBrevoWebhookCoverageMonitor,
});
const malformedWebhookAlerts = createResilientScheduledJob({
  job: "malformed-webhook-alerts",
  run: runMalformedWebhookAlerts,
});
const beautyJobsExpirySweep = createResilientScheduledJob({
  job: "beauty-jobs-expiry-sweep",
  run: expireBeautyJobListings,
});
const beautyJobEmailDeliveryAlerts = createResilientScheduledJob({
  job: "beauty-job-email-delivery-alerts",
  run: runBeautyJobDeliveryFailureAlerts,
});
const scheduledJobs = [
  rescheduledConfirmationRetries,
  educationSessionMaintenance,
  educationGalleryCleanup,
  mediaUploadCleanup,
  compatibilityImageCleanup,
  communicationArchive,
  automationWorker,
  deliveryReportSilenceAlerts,
  deliveryReportRecoveryAlerts,
  brevoWebhookCoverageMonitor,
  malformedWebhookAlerts,
  beautyJobsExpirySweep,
  beautyJobEmailDeliveryAlerts,
];

const retryInterval = setInterval(() => {
  void rescheduledConfirmationRetries.run();
}, 60_000);
retryInterval.unref();
void rescheduledConfirmationRetries.run();

// Education session lifecycle: drain expired waitlist offers and auto-cancel
// under-enrolled sessions. Runs every 5 minutes on a self-unreferencing timer
// so it never keeps the process alive on its own.
const educationMaintenanceInterval = setInterval(() => {
  void educationSessionMaintenance.run();
}, 5 * 60_000);
educationMaintenanceInterval.unref();
void educationSessionMaintenance.run();

const beautyJobsExpiryInterval = setInterval(() => {
  void beautyJobsExpirySweep.run();
}, 5 * 60_000);
beautyJobsExpiryInterval.unref();
void beautyJobsExpirySweep.run();

const educationGalleryCleanupInterval = setInterval(() => {
  void educationGalleryCleanup.run();
}, 5 * 60_000);
educationGalleryCleanupInterval.unref();
void educationGalleryCleanup.run();

const mediaCleanupInterval = setInterval(() => {
  void mediaUploadCleanup.run();
}, 5 * 60_000);
mediaCleanupInterval.unref();
void mediaUploadCleanup.run();

const compatibilityImageCleanupInterval = setInterval(() => {
  void compatibilityImageCleanup.run();
}, 10 * 60_000);

const communicationArchiveInterval = setInterval(() => {
  void communicationArchive.run();
}, 24 * 60 * 60_000);
communicationArchiveInterval.unref();

// Automation worker: evaluate active rules every 15 minutes
const automationWorkerInterval = setInterval(() => {
  void automationWorker.run();
}, 15 * 60_000);
automationWorkerInterval.unref();
void automationWorker.run();

// Delivery-report silence alerts: if automation messages went out recently but
// no verified webhook events arrived, email administrators (deduplicated per
// cooldown window through the email outbox — never one email per tick).
const deliveryReportAlertInterval = setInterval(() => {
  void deliveryReportSilenceAlerts.run();
  void deliveryReportRecoveryAlerts.run();
  void brevoWebhookCoverageMonitor.run();
  void malformedWebhookAlerts.run();
  void beautyJobEmailDeliveryAlerts.run();
}, 15 * 60_000);
deliveryReportAlertInterval.unref();
void deliveryReportSilenceAlerts.run();
void deliveryReportRecoveryAlerts.run();
void brevoWebhookCoverageMonitor.run();
void malformedWebhookAlerts.run();
void beautyJobEmailDeliveryAlerts.run();
compatibilityImageCleanupInterval.unref();
void compatibilityImageCleanup.run();
void communicationArchive.run();

const databaseMetricsInterval = setInterval(() => {
  logger.debug(
    {
      databasePool: databasePoolStats(),
      catalogCache: catalogCacheStats(),
    },
    "Database and catalog cache metrics",
  );
}, 60_000);
databaseMetricsInterval.unref();

// Safe on every boot: already-managed references are ignored and legacy
// sources are never removed. Running after listen keeps readiness fast.
void migrateLegacyMediaReferences().catch((error) => {
  logger.warn({ err: error }, "Legacy media migration failed");
});

let shuttingDown = false;

function clearScheduledTasks(): void {
  clearInterval(retryInterval);
  clearInterval(educationMaintenanceInterval);
  clearInterval(beautyJobsExpiryInterval);
  clearInterval(educationGalleryCleanupInterval);
  clearInterval(mediaCleanupInterval);
  clearInterval(compatibilityImageCleanupInterval);
  clearInterval(communicationArchiveInterval);
  clearInterval(automationWorkerInterval);
  clearInterval(deliveryReportAlertInterval);
  clearInterval(databaseMetricsInterval);
  for (const scheduledJob of scheduledJobs) scheduledJob.stop();
}
function shutDown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Server shutting down");
  clearScheduledTasks();
  void performCleanup().finally(() => flushAndExit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));

registerFatalHandlers({
  logger,
  cleanup: () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearScheduledTasks();
    return performCleanup();
  },
});

function flushAndExit(exitCode: number): void {
  logger.flush(() => process.exit(exitCode));
}

async function performCleanup(): Promise<void> {
  await Promise.allSettled([
    stopSalonNotificationEventListener(),
    stopCatalogCacheInvalidationListener(),
  ]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await closePool();
  } catch (error) {
    logger.warn({ err: error }, "Pool close failed during shutdown");
  }
}
