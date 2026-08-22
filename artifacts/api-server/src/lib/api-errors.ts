import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import { logger } from "./logger";

type PgError = Error & {
  code?: string;
  constraint?: string;
  detail?: string;
};

type ApiIssue = {
  path: string;
  message: string;
};

export type ApiErrorBody = {
  error: string;
  code: string;
  issues?: ApiIssue[];
};

const statusCodes: Record<number, string> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "UNPROCESSABLE_ENTITY",
  429: "RATE_LIMITED",
};

function zodIssuesFromMessage(message: string): ApiIssue[] {
  if (!message.trimStart().startsWith("[")) return [];
  try {
    const parsed = JSON.parse(message) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((issue): ApiIssue[] => {
      if (!issue || typeof issue !== "object") return [];
      const candidate = issue as { path?: unknown; message?: unknown };
      if (typeof candidate.message !== "string") return [];
      const path = Array.isArray(candidate.path)
        ? candidate.path.map(String).join(".")
        : "";
      return [{ path, message: candidate.message }];
    });
  } catch {
    return [];
  }
}

/**
 * Existing handlers return early with res.status(...).json(...). This boundary
 * keeps every admin error response on the same structured contract while the
 * generated request schemas remain the source of field validation.
 */
export const normalizeAdminErrorResponses: RequestHandler = (req, res, next): void => {
  if (!req.path.startsWith("/api/admin/") && !req.path.startsWith("/admin/")) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (
      res.statusCode >= 400
      && res.statusCode < 500
      && body
      && typeof body === "object"
      && typeof (body as { error?: unknown }).error === "string"
      && typeof (body as { code?: unknown }).code !== "string"
    ) {
      const originalError = (body as { error: string }).error;
      const issues = zodIssuesFromMessage(originalError);
      const normalized: ApiErrorBody = {
        error: issues.length ? "Uneti podaci nisu ispravni." : originalError,
        code: statusCodes[res.statusCode] ?? "REQUEST_REJECTED",
        ...(issues.length ? { issues } : {}),
      };
      return originalJson(normalized);
    }
    return originalJson(body);
  }) as Response["json"];
  next();
};

const expectedDatabaseErrors: Record<string, { status: number; code: string; message: string }> = {
  "23502": {
    status: 400,
    code: "REQUIRED_FIELD",
    message: "Nedostaje obavezna vrednost.",
  },
  "23503": {
    status: 409,
    code: "REFERENCE_CONFLICT",
    message: "Zapis se ne može promeniti jer je povezan sa drugim podacima.",
  },
  "23505": {
    status: 409,
    code: "DUPLICATE_VALUE",
    message: "Zapis sa ovom vrednošću već postoji.",
  },
  "23514": {
    status: 400,
    code: "INVALID_VALUE",
    message: "Jedna od vrednosti nije dozvoljena.",
  },
  "22P02": {
    status: 400,
    code: "INVALID_FORMAT",
    message: "Vrednost nije u očekivanom formatu.",
  },
  "22003": {
    status: 400,
    code: "NUMBER_OUT_OF_RANGE",
    message: "Broj je van dozvoljenog opsega.",
  },
  "22023": {
    status: 400,
    code: "INVALID_PARAMETER",
    message: "Prosleđeni parametar nije dozvoljen.",
  },
};

function isMalformedJson(error: unknown): boolean {
  return error instanceof SyntaxError
    && "status" in error
    && (error as SyntaxError & { status?: number }).status === 400;
}

export function validationError(
  response: Response,
  error: string,
  issues: ApiIssue[] = [],
): void {
  const body: ApiErrorBody = {
    error,
    code: "VALIDATION_ERROR",
    ...(issues.length ? { issues } : {}),
  };
  response.status(400).json(body);
}

export const apiErrorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next,
): void => {
  if (res.headersSent) {
    req.log.error({ err: error }, "Request failed after response headers were sent");
    res.end();
    return;
  }

  if (isMalformedJson(error)) {
    res.status(400).json({
      error: "Telo zahteva nije ispravan JSON.",
      code: "MALFORMED_JSON",
    } satisfies ApiErrorBody);
    return;
  }

  const databaseError = error as PgError;
  const expected = databaseError.code
    ? expectedDatabaseErrors[databaseError.code]
    : undefined;
  if (expected) {
    req.log.warn(
      {
        databaseCode: databaseError.code,
        constraint: databaseError.constraint,
      },
      "Expected database constraint rejected request",
    );
    res.status(expected.status).json({
      error: expected.message,
      code: expected.code,
    } satisfies ApiErrorBody);
    return;
  }

  req.log.error({ err: error }, "Unhandled API request error");
  res.status(500).json({
    error: "Došlo je do neočekivane greške. Pokušajte ponovo.",
    code: "INTERNAL_ERROR",
  } satisfies ApiErrorBody);
};

process.on("uncaughtExceptionMonitor", (error) => {
  logger.fatal({ err: error }, "Uncaught process exception");
});