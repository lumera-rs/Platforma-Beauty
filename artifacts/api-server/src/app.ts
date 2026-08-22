import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiErrorHandler, normalizeAdminErrorResponses } from "./lib/api-errors";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
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
 * Strips the query string from a URL and returns only the pathname portion.
 * Used to ensure no query parameter values (which may contain sensitive data)
 * are ever emitted in logs.
 */
export function safePathname(url: string | undefined): string {
  if (!url) return "/";
  const qIndex = url.indexOf("?");
  return qIndex === -1 ? url : url.slice(0, qIndex);
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
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(normalizeAdminErrorResponses);

app.use("/api", router);
app.use(apiErrorHandler);

export default app;
