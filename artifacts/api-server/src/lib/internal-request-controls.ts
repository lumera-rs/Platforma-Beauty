import type { NextFunction, Request, Response } from "express";
import { databaseQueryObservationHeader } from "@workspace/db";
import { isProductionOrDeploymentRuntime } from "@workspace/db/destructive-test-runtime";

export type InternalRequestControlTransport =
  | "header"
  | "query"
  | "path"
  | "cookie"
  | "body";

export type InternalRequestControl = Readonly<{
  transport: InternalRequestControlTransport;
  name: string;
  purpose: string;
}>;

/**
 * Declaration convention for test-only HTTP inputs:
 *
 * 1. Add a descriptor to this inventory, regardless of its transport or name.
 * 2. Read it only through readInternalRequestControl().
 * 3. Never read a test-only input directly from Express' req object.
 *
 * The repository check enforces step 2 even for ordinary-looking names.
 */
export const databaseQueryObservationControl = {
  transport: "header",
  name: databaseQueryObservationHeader,
  purpose: "Associate SQL observations with an explicitly enabled test capture",
} as const satisfies InternalRequestControl;

export const mediaRouteRegressionControl = {
  transport: "header",
  name: "x-lumera-media-regression-token",
  purpose: "Authorize the in-process media route regression harness",
} as const satisfies InternalRequestControl;

/** Kept as the public header-name constant used by existing test clients. */
export const mediaRouteRegressionHeader = mediaRouteRegressionControl.name;

/**
 * Complete inventory of HTTP controls that exist only for test or diagnostic
 * harnesses. Production rejects these at the application boundary before a
 * route can accidentally interpret them.
 */
export const internalRequestControls = [
  databaseQueryObservationControl,
  mediaRouteRegressionControl,
] as const;

export const internalRequestControlHeaders = internalRequestControls
  .filter((control) => control.transport === "header")
  .map((control) => control.name);

class InternalRequestControlDeniedError extends Error {
  constructor() {
    super("Internal request control denied");
    this.name = "InternalRequestControlDeniedError";
  }
}

function readInternalRequestControlValue(
  req: Request,
  control: InternalRequestControl,
): unknown {
  switch (control.transport) {
    case "header":
      return req.get(control.name);
    case "query":
      return req.query?.[control.name];
    case "path":
      return req.params?.[control.name];
    case "cookie":
      return req.cookies?.[control.name];
    case "body":
      return req.body != null && typeof req.body === "object"
        ? (req.body as Record<string, unknown>)[control.name]
        : undefined;
  }
}

export function readInternalRequestControl(
  req: Request,
  control: InternalRequestControl,
): unknown {
  const value = readInternalRequestControlValue(req, control);
  if (value !== undefined && isProductionOrDeploymentRuntime()) {
    throw new InternalRequestControlDeniedError();
  }
  return value;
}

export function makeDenyInternalRequestControlsInProduction(
  controls: readonly InternalRequestControl[],
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next): void => {
    if (
      isProductionOrDeploymentRuntime()
      && controls.some(
        (control) => readInternalRequestControlValue(req, control) !== undefined,
      )
    ) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  };
}

export const denyInternalRequestControlsInProduction =
  makeDenyInternalRequestControlsInProduction(internalRequestControls);

export function denyInternalRequestControlErrors(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof InternalRequestControlDeniedError) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next(error);
}