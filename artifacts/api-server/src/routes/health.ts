import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getPoolStatus } from "@workspace/db";
import { schedulerHealthSnapshot } from "../lib/scheduler-resilience";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    databasePool: getPoolStatus(),
    schedulerJobs: schedulerHealthSnapshot(),
  });
  res.json(data);
});

export default router;
