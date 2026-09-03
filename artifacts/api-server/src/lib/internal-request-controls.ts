import type { NextFunction, Request, Response } from "express";
import { databaseQueryObservationHeader } from "@workspace/db";
import { isProductionOrDeploymentRuntime } from "@workspace/db/destructive-test-runtime";

export const mediaRouteRegressionHeader = "x-lumera-media-regression-token";

/**
 * Complete inventory of HTTP controls that exist only for test or diagnostic
 * harnesses. Production rejects these at the application boundary before a
 * route can accidentally interpret them.
 */
export const internalRequestControlHeaders = [
  databaseQueryObservationHeader,
  mediaRouteRegressionHeader,
] as const;

export function denyInternalRequestControlsInProduction(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    isProductionOrDeploymentRuntime()
    && internalRequestControlHeaders.some((header) => req.get(header) !== undefined)
  ) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}