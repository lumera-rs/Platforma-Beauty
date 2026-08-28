import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiErrorHandler, normalizeAdminErrorResponses } from "./lib/api-errors";

const app: Express = express();
// Replit deployments have one controlled edge proxy. Local/test processes are
// directly reachable, so forwarded headers must not influence req.ip there.
app.set("trust proxy", process.env["REPLIT_DEPLOYMENT"] ? 1 : false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // safePathname strips the query string AND redacts path-embedded
          // capability tokens (webhook URLs) before the path reaches the log.
          url: safePathname(req.url),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

export const slowRequestThresholdMs: number = (() => {
  const raw = process.env["SLOW_REQUEST_THRESHOLD_MS"];
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1000;
})();

/**
 * Provider webhook endpoints authenticate with a capability token embedded in
 * the URL path (/api/webhooks/<provider>/<token>) — for those routes the path
 * IS the secret. Every path that reaches any log sink must therefore pass
 * through this redaction first, or the log stream would leak a replayable
 * credential to anyone with log access.
 */
const WEBHOOK_TOKEN_PATTERN = /(\/webhooks\/[^/?#]+\/)[^?#]+/g;
export function redactPathSecrets(path: string): string {
  return path.replace(WEBHOOK_TOKEN_PATTERN, "$1:token");
}

/**
 * Strips the query string from a URL and returns only the pathname portion,
 * with path-embedded secrets redacted. Used to ensure neither query parameter
 * values nor capability tokens are ever emitted in logs.
 */
export function safePathname(url: string | undefined): string {
  if (!url) return "/";
  const qIndex = url.indexOf("?");
  return redactPathSecrets(qIndex === -1 ? url : url.slice(0, qIndex));
}

/**
 * Express middleware that measures request duration and emits a single
 * structured `slow_request` warning log when the response takes longer than
 * `slowRequestThresholdMs`. The log entry contains:
 *   event, requestId, method, pathname (no query), statusCode, durationMs.
 */
export function makeSlowRequestMiddleware(
  thresholdMs: number,
  log: typeof logger,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = Date.now();

    res.once("finish", () => {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= thresholdMs) {
        log.warn({
          event: "slow_request",
          requestId: String(req.id ?? ""),
          method: req.method,
          pathname: safePathname(req.url),
          statusCode: res.statusCode,
          durationMs,
        }, "slow_request");
      }
    });

    next();
  };
}

app.use(makeSlowRequestMiddleware(slowRequestThresholdMs, logger));
// CORS: intentionally NOT enabled globally. The web app reaches this API
// same-origin through the path-routing proxy; only the public booking-widget
// routes opt into cross-origin access (see routes/widget.ts).
app.use(cookieParser());
// Providers may replay thousands of delivery events in one request. This
// parser must run before the general JSON parser below, whose 100 KB default
// would reject those authenticated webhook batches before state handling.
// Keep it bounded: webhooks need room for operational replay batches, not
// unlimited request bodies.
app.use("/api/webhooks", express.json({ limit: "5mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(normalizeAdminErrorResponses);

app.use("/api", router);
app.use(apiErrorHandler);

export default app;
