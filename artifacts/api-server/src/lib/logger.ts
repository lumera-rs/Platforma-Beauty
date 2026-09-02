import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

/**
 * Requests completing at or above this many milliseconds emit a structured
 * `slow-api` event. Configurable via SLOW_API_THRESHOLD_MS; falls back to
 * 1000 ms when unset or invalid.
 */
export const SLOW_API_THRESHOLD_MS = (() => {
  const raw = process.env.SLOW_API_THRESHOLD_MS;
  if (!raw) return 1000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
})();

let processSafetyHandlersRegistered = false;

function processFailureMetadata(reason: unknown): Record<string, string> {
  if (reason instanceof Error) return { errorType: reason.name || "Error" };
  return { reasonType: reason === null ? "null" : typeof reason };
}

/**
 * Registers early process-level handlers for unhandled promise rejections and
 * uncaught exceptions using the shared Pino logger. Fatal uncaught exceptions
 * are logged, the logger is flushed, and the process exits so a supervisor can
 * restart it. Intended for real runtime entrypoints only; test entrypoints do
 * not call this so exceptions surface to the test runner instead of exiting.
 */
export function registerProcessSafetyHandlers(): void {
  if (processSafetyHandlersRegistered) return;
  processSafetyHandlersRegistered = true;

  process.on("unhandledRejection", (reason) => {
    logger.error(processFailureMetadata(reason), "Unhandled promise rejection");
  });

  process.on("uncaughtException", (error) => {
    logger.fatal(processFailureMetadata(error), "Uncaught exception; exiting");
    // Best-effort flush of buffered logs before the process terminates.
    try {
      logger.flush();
    } catch {
      // Ignore flush failures; we are already exiting.
    }
    setTimeout(() => process.exit(1), 100);
  });
}
