import { closePool } from "@workspace/db";

try {
  const rolloutModulePath = "../../artifacts/api-server/src/lib/business-growth-schema";
  const webPushRolloutModulePath = "../../artifacts/api-server/src/lib/web-push-schema";
  const { ensureBusinessGrowthSchema } = await import(rolloutModulePath);
  const { ensureWebPushSchema } = await import(webPushRolloutModulePath);
  await ensureBusinessGrowthSchema();
  await ensureWebPushSchema();
} finally {
  await closePool();
}