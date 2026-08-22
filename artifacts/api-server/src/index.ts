import app from "./app";
import { logger } from "./lib/logger";
import { runScheduledRescheduledConfirmationRetries } from "./lib/rescheduled-confirmation-retries";
import { runScheduledEducationSessionMaintenance } from "./lib/education-scheduler";
import {
  startSalonNotificationEventListener,
  stopSalonNotificationEventListener,
} from "./lib/salon-notification-events";
import { runEducationGalleryCleanup } from "./routes/marketplace";
import { cleanupExpiredImageAssets } from "./routes/media";

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

void startSalonNotificationEventListener();

const server = app.listen(port, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

const retryInterval = setInterval(() => {
  void runScheduledRescheduledConfirmationRetries();
}, 60_000);
retryInterval.unref();
void runScheduledRescheduledConfirmationRetries();

// Education session lifecycle: drain expired waitlist offers and auto-cancel
// under-enrolled sessions. Runs every 5 minutes on a self-unreferencing timer
// so it never keeps the process alive on its own.
const educationMaintenanceInterval = setInterval(() => {
  void runScheduledEducationSessionMaintenance();
}, 5 * 60_000);
educationMaintenanceInterval.unref();
void runScheduledEducationSessionMaintenance();

const educationGalleryCleanupInterval = setInterval(() => {
  void runEducationGalleryCleanup().catch((error) => {
    logger.warn({ err: error }, "Education gallery cleanup scheduler failed");
  });
}, 5 * 60_000);
educationGalleryCleanupInterval.unref();
void runEducationGalleryCleanup().catch((error) => {
  logger.warn({ err: error }, "Education gallery cleanup scheduler failed");
});

const imageAssetCleanupInterval = setInterval(() => {
  void cleanupExpiredImageAssets().catch((error) => {
    logger.warn({ err: error }, "Image asset cleanup scheduler failed");
  });
}, 10 * 60_000);
imageAssetCleanupInterval.unref();
void cleanupExpiredImageAssets().catch((error) => {
  logger.warn({ err: error }, "Image asset cleanup scheduler failed");
});

let shuttingDown = false;
function shutDown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Server shutting down");
  clearInterval(retryInterval);
  clearInterval(educationMaintenanceInterval);
  clearInterval(educationGalleryCleanupInterval);
  clearInterval(imageAssetCleanupInterval);

  void stopSalonNotificationEventListener().finally(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));
