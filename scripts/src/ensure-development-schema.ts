import { closePool } from "@workspace/db";

try {
  const rolloutModulePath = "../../artifacts/api-server/src/lib/business-growth-schema";
  const webPushRolloutModulePath = "../../artifacts/api-server/src/lib/web-push-schema";
  const bookingDevelopmentSchemaModulePath = "./booking-development-schema";
  const { ensureBusinessGrowthSchema } = await import(rolloutModulePath);
  const { ensureWebPushSchema } = await import(webPushRolloutModulePath);
  const { ensureBookingDevelopmentSchema } = await import(bookingDevelopmentSchemaModulePath);
  await ensureBusinessGrowthSchema();
  await ensureWebPushSchema();
  await ensureBookingDevelopmentSchema();
} finally {
  await closePool();
}