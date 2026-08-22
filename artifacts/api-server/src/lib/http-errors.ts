import type { ErrorRequestHandler } from "express";

type PgLikeError = Error & {
  code?: string;
  constraint?: string;
  type?: string;
};

function isZodError(error: unknown): error is Error & { issues: unknown[] } {
  return error instanceof Error
    && error.name === "ZodError"
    && Array.isArray((error as { issues?: unknown }).issues);
}

function clientError(error: PgLikeError): {
  status: number;
  code: string;
  message: string;
} | null {
  if (isZodError(error)) {
    return {
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Uneti podaci nisu ispravni.",
    };
  }

  if (error.type === "entity.parse.failed") {
    return {
      status: 400,
      code: "INVALID_JSON",
      message: "Telo zahteva nije ispravan JSON.",
    };
  }

  switch (error.code) {
    case "22P02":
    case "22003":
    case "23502":
    case "23514":
      return {
        status: 400,
        code: "INVALID_VALUE",
        message: "Jedna ili više vrednosti nisu ispravne.",
      };
    case "23503":
      return {
        status: 409,
        code: "REFERENCE_CONFLICT",
        message: "Izabrana povezana stavka ne postoji ili je još u upotrebi.",
      };
    case "23505":
      return {
        status: 409,
        code: "DUPLICATE_VALUE",
        message: "Stavka sa istim jedinstvenim podatkom već postoji.",
      };
    default:
      return null;
  }
}

export const apiErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized: PgLikeError = error instanceof Error
    ? error as PgLikeError
    : new Error("Unknown server error");
  const expected = clientError(normalized);

  if (expected) {
    req.log.warn(
      {
        err: normalized,
        errorCode: expected.code,
        constraint: normalized.constraint,
      },
      "Request rejected",
    );
    res.status(expected.status).json({
      error: expected.message,
      code: expected.code,
    });
    return;
  }

  req.log.error({ err: normalized }, "Unhandled request error");
  res.status(500).json({
    error: "Došlo je do neočekivane greške. Pokušajte ponovo.",
    code: "INTERNAL_ERROR",
  });
};