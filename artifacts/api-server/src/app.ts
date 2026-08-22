import express, { type Express, type RequestHandler } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger, SLOW_API_THRESHOLD_MS } from "./lib/logger";
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

/**
 * Emits a structured `slow-api` event for completed requests whose duration is
 * at or above the configured threshold. The payload is deliberately minimal:
 * request id, method, sanitized pathname (query stripped), response status and
 * duration. No request/response body, raw query string, cookies, authorization
 * headers, client IP, or provider/database error detail is ever included.
 */
export const slowApiMonitor: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    if (durationMs < SLOW_API_THRESHOLD_MS) return;

    const pathname = req.originalUrl.split("?")[0] ?? req.path;
    req.log.warn(
      {
        event: "slow-api",
        reqId: req.id,
        method: req.method,
        pathname,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs),
      },
      "slow-api",
    );
  });
  next();
};

app.use(slowApiMonitor);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(normalizeAdminErrorResponses);

app.use("/api", router);
app.use(apiErrorHandler);

export default app;
