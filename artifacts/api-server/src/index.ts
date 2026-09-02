import app from "./app";
import { closePool, databasePoolStats } from "@workspace/db";
import { logger } from "./lib/logger";
import { retryFailedRetryableEmails } from "./lib/brevo";
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
import { seedProductionMarketplaceDemoContent } from "./lib/production-marketplace-demo-seed";
import { runReferralMaintenance } from "./lib/referral-service";
import { ensureReferralSchema } from "./lib/referral-schema";
import { ensureWebPushSchema } from "./lib/web-push-schema";
import { ensureBookingCommandSchema } from "./lib/booking-command-schema";
import { ensureEducationBundlePurchaseSchema } from "./lib/education-bundle-purchase-schema";
import { runSystemPushWorker } from "./lib/web-push";
import { drainSmsOutbox } from "./lib/sms";
import { runProductWaitlistNotificationWorker } from "./lib/product-waitlist-worker";
import { runRetailSubscriptionWorker } from "./lib/retail-subscription-worker";
import { runRetailCartReminderSweep } from "./lib/retail-cart-reminders";
import { runRetailReviewInvitationSweep } from "./lib/review-invitations";
import { runAftercareWorker } from "./lib/aftercare-worker";
import {
  runAppointmentReminderSweep,
  runAppointmentReviewInvitationSweep,
} from "./lib/appointment-customer-events";
import { enqueueEducationReminderSweep, processEducationOutbox } from "./lib/education-outbox";
import { runFeaturedPlacementPaymentReminderSweep } from "./lib/featured-placement-payment-reminders";
import { runEducationSubscriptionLifecycle } from "./lib/education-subscription-worker";

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
await ensureReferralSchema();
await ensureWebPushSchema();
await ensureBookingCommandSchema();
await ensureEducationBundlePurchaseSchema();
await reconcileKnownTestListings();
if (process.env.NODE_ENV === "production") {
  await seedProductionMarketplaceDemoContent();
}

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

const transactionalEmailOutbox = createResilientScheduledJob({
  job: "transactional-email-outbox",
  run: retryFailedRetryableEmails,
});
const educationSessionMaintenance = createResilientScheduledJob({
  job: "education-session-maintenance",
  run: processUpcomingEducationSessions,
});
const educationOutboxDeliveries = createResilientScheduledJob({ job: "education-outbox-deliveries", run: processEducationOutbox });
const educationReminderSweep = createResilientScheduledJob({ job: "education-reminder-sweep", run: enqueueEducationReminderSweep });
const featuredPlacementPaymentReminders = createResilientScheduledJob({
  job: "featured-placement-payment-reminders",
  run: runFeaturedPlacementPaymentReminderSweep,
});
const educationSubscriptionLifecycle = createResilientScheduledJob({
  job: "education-subscription-lifecycle",
  run: runEducationSubscriptionLifecycle,
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
const referralMaintenance = createResilientScheduledJob({
  job: "referral-maintenance",
  run: runReferralMaintenance,
});
const productWaitlistNotifications = createResilientScheduledJob({
  job: "product-waitlist-notifications",
  run: runProductWaitlistNotificationWorker,
});
const retailSubscriptionCycles = createResilientScheduledJob({
  job: "retail-subscription-cycles",
  run: runRetailSubscriptionWorker,
});
const retailCartReminderSweep = createResilientScheduledJob({
  job: "retail-cart-reminder-sweep",
  run: runRetailCartReminderSweep,
});
const retailReviewInvitationSweep = createResilientScheduledJob({
  job: "retail-review-invitation-sweep",
  run: runRetailReviewInvitationSweep,
});
const aftercareWorker = createResilientScheduledJob({
  job: "aftercare-worker",
  run: runAftercareWorker,
});
const appointmentReminders = createResilientScheduledJob({
  job: "appointment-reminders",
  run: runAppointmentReminderSweep,
});
const appointmentReviewInvitations = createResilientScheduledJob({
  job: "appointment-review-invitations",
  run: runAppointmentReviewInvitationSweep,
});
const systemPushDeliveries = createResilientScheduledJob({
  job: "system-push-deliveries",
  run: runSystemPushWorker,
});
const smsOutboxDeliveries = createResilientScheduledJob({
  job: "sms-outbox-deliveries",
  run: drainSmsOutbox,
});
const scheduledJobs = [
  transactionalEmailOutbox,
  educationSessionMaintenance,
  educationOutboxDeliveries,
  educationReminderSweep,
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
  referralMaintenance,
  productWaitlistNotifications,
  retailSubscriptionCycles,
  retailCartReminderSweep,
  retailReviewInvitationSweep,
  aftercareWorker,
  appointmentReminders,
  appointmentReviewInvitations,
  systemPushDeliveries,
  smsOutboxDeliveries,
  featuredPlacementPaymentReminders,
  educationSubscriptionLifecycle,
];

const retryInterval = setInterval(() => {
  void transactionalEmailOutbox.run();
}, 60_000);
retryInterval.unref();
void transactionalEmailOutbox.run();
const smsOutboxInterval = setInterval(() => {
  void smsOutboxDeliveries.run();
}, 60_000);
smsOutboxInterval.unref();
void smsOutboxDeliveries.run();

// Education session lifecycle: drain expired waitlist offers and auto-cancel
// under-enrolled sessions. Runs every 5 minutes on a self-unreferencing timer
// so it never keeps the process alive on its own.
const educationMaintenanceInterval = setInterval(() => {
  void educationSessionMaintenance.run();
}, 5 * 60_000);
educationMaintenanceInterval.unref();
void educationSessionMaintenance.run();
const educationOutboxInterval = setInterval(() => {
  void educationOutboxDeliveries.run();
  void educationReminderSweep.run();
}, 60_000);
educationOutboxInterval.unref();
void educationOutboxDeliveries.run();
void educationReminderSweep.run();

const featuredPlacementPaymentReminderInterval = setInterval(() => {
  void featuredPlacementPaymentReminders.run();
}, 15 * 60_000);
featuredPlacementPaymentReminderInterval.unref();
void featuredPlacementPaymentReminders.run();
const educationSubscriptionInterval = setInterval(() => {
  void educationSubscriptionLifecycle.run();
}, 60 * 60_000);
educationSubscriptionInterval.unref();
void educationSubscriptionLifecycle.run();

const beautyJobsExpiryInterval = setInterval(() => {
  void beautyJobsExpirySweep.run();
}, 5 * 60_000);
beautyJobsExpiryInterval.unref();
void beautyJobsExpirySweep.run();

const referralMaintenanceInterval = setInterval(() => {
  void referralMaintenance.run();
}, 5 * 60_000);
referralMaintenanceInterval.unref();
void referralMaintenance.run();

// The database trigger writes this durable queue in the same stock-update
// transaction (including admin adjustments and cancellation credits). Drain it
// frequently; the worker is safe to run concurrently on every application node.
const productWaitlistNotificationsInterval = setInterval(() => {
  void productWaitlistNotifications.run();
}, 60_000);
productWaitlistNotificationsInterval.unref();
void productWaitlistNotifications.run();

const retailSubscriptionCyclesInterval = setInterval(() => {
  void retailSubscriptionCycles.run();
}, 60_000);
retailSubscriptionCyclesInterval.unref();
void retailSubscriptionCycles.run();

const retailCartReminderSweepInterval = setInterval(() => {
  void retailCartReminderSweep.run();
}, 15 * 60_000);
retailCartReminderSweepInterval.unref();
void retailCartReminderSweep.run();
const retailReviewInvitationSweepInterval = setInterval(() => { void retailReviewInvitationSweep.run(); }, 60 * 60_000);
retailReviewInvitationSweepInterval.unref();
void retailReviewInvitationSweep.run();
const appointmentCustomerEventsInterval = setInterval(() => {
  void appointmentReminders.run();
  void appointmentReviewInvitations.run();
}, 60_000);
appointmentCustomerEventsInterval.unref();
void appointmentReminders.run();
void appointmentReviewInvitations.run();
const systemPushDeliveriesInterval = setInterval(() => {
  void systemPushDeliveries.run();
}, 30_000);
systemPushDeliveriesInterval.unref();
void systemPushDeliveries.run();

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

// Platform B2C aftercare outbox, delivery, conversion and replenishment sweep.
const aftercareWorkerInterval = setInterval(() => {
  void aftercareWorker.run();
}, 15 * 60_000);
aftercareWorkerInterval.unref();
void aftercareWorker.run();

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
  clearInterval(productWaitlistNotificationsInterval);
  clearInterval(retailSubscriptionCyclesInterval);
  clearInterval(retailCartReminderSweepInterval);
  clearInterval(retailReviewInvitationSweepInterval);
  clearInterval(appointmentCustomerEventsInterval);
  clearInterval(systemPushDeliveriesInterval);
  clearInterval(educationMaintenanceInterval);
  clearInterval(educationOutboxInterval);
  clearInterval(featuredPlacementPaymentReminderInterval);
  clearInterval(beautyJobsExpiryInterval);
  clearInterval(referralMaintenanceInterval);
  clearInterval(educationGalleryCleanupInterval);
  clearInterval(mediaCleanupInterval);
  clearInterval(compatibilityImageCleanupInterval);
  clearInterval(communicationArchiveInterval);
  clearInterval(automationWorkerInterval);
  clearInterval(aftercareWorkerInterval);
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
