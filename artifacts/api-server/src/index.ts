import app from "./app";
import { closePool, databasePoolStats } from "@workspace/db";
import { logger, registerProcessSafetyHandlers } from "./lib/logger";
import { runScheduledRescheduledConfirmationRetries } from "./lib/rescheduled-confirmation-retries";
import { runScheduledEducationSessionMaintenance } from "./lib/education-scheduler";
import {
  startSalonNotificationEventListener,
  stopSalonNotificationEventListener,
} from "./lib/salon-notification-events";
import { runEducationGalleryCleanup } from "./routes/marketplace";
import { cleanupExpiredImageAssets } from "./routes/image-media";
import { runMediaUploadCleanup } from "./routes/media";
import { migrateLegacyMediaReferences } from "./lib/media-migration";
import { ensureMediaSchema } from "./lib/media-schema";
import {
  catalogCacheStats,
  startCatalogCacheInvalidationListener,
  stopCatalogCacheInvalidationListener,
} from "./lib/catalog-cache";
import { runCommunicationArchiveBatch } from "./lib/communication-archive";

// Register early so failures during startup are captured by the shared logger
// and fatal uncaught exceptions flush/log before exiting in real runtime.
registerProcessSafetyHandlers();

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

await ensureMediaSchema();

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

const retryInterval = setInterval(() => {
  void runScheduledRescheduledConfirmationRetries().catch((error: unknown) => {
    logger.warn({ err: error }, "Rescheduled confirmation retry scheduler failed");
  });
}, 60_000);
retryInterval.unref();
void runScheduledRescheduledConfirmationRetries().catch((error: unknown) => {
  logger.warn({ err: error }, "Rescheduled confirmation retry initial run failed");
});

// Education session lifecycle: drain expired waitlist offers and auto-cancel
// under-enrolled sessions. Runs every 5 minutes on a self-unreferencing timer
// so it never keeps the process alive on its own.
const educationMaintenanceInterval = setInterval(() => {
  void runScheduledEducationSessionMaintenance().catch((error: unknown) => {
    logger.warn({ err: error }, "Education session maintenance scheduler failed");
  });
}, 5 * 60_000);
educationMaintenanceInterval.unref();
void runScheduledEducationSessionMaintenance().catch((error: unknown) => {
  logger.warn({ err: error }, "Education session maintenance initial run failed");
});

const educationGalleryCleanupInterval = setInterval(() => {
  void runEducationGalleryCleanup().catch((error) => {
    logger.warn({ err: error }, "Education gallery cleanup scheduler failed");
  });
}, 5 * 60_000);
educationGalleryCleanupInterval.unref();
void runEducationGalleryCleanup().catch((error) => {
  logger.warn({ err: error }, "Education gallery cleanup scheduler failed");
});

const mediaCleanupInterval = setInterval(() => {
  void runMediaUploadCleanup().catch((error) => {
    logger.warn({ err: error }, "Media upload cleanup scheduler failed");
  });
}, 5 * 60_000);
mediaCleanupInterval.unref();
void runMediaUploadCleanup().catch((error) => {
  logger.warn({ err: error }, "Media upload cleanup scheduler failed");
});

const compatibilityImageCleanupInterval = setInterval(() => {
  void cleanupExpiredImageAssets().catch((error) => {
    logger.warn({ err: error }, "Compatibility image asset cleanup scheduler failed");
  });
}, 10 * 60_000);

const communicationArchiveInterval = setInterval(() => {
  void runCommunicationArchiveBatch().catch((error) => {
    logger.warn({ err: error }, "Communication archive batch scheduler failed");
  });
}, 24 * 60 * 60_000);
communicationArchiveInterval.unref();
compatibilityImageCleanupInterval.unref();
void cleanupExpiredImageAssets().catch((error) => {
  logger.warn({ err: error }, "Compatibility image asset cleanup scheduler failed");
});
void runCommunicationArchiveBatch().catch((error) => {
  logger.warn({ err: error }, "Communication archive batch initial run failed");
});

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
function shutDown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Server shutting down");
  clearInterval(retryInterval);
  clearInterval(educationMaintenanceInterval);
  clearInterval(educationGalleryCleanupInterval);
  clearInterval(mediaCleanupInterval);
  clearInterval(compatibilityImageCleanupInterval);
  clearInterval(communicationArchiveInterval);
  clearInterval(databaseMetricsInterval);

  void Promise.allSettled([
    stopSalonNotificationEventListener(),
    stopCatalogCacheInvalidationListener(),
  ]).finally(() => {
    server.close(() => {
      void closePool().then(
        () => { process.exit(0); },
        (error: unknown) => {
          logger.warn({ err: error }, "Pool close failed during shutdown");
          process.exit(0);
        },
      );
    });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));
