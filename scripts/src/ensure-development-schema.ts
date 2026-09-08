import { closePool } from "@workspace/db";

try {
  const rolloutModulePath = "../../artifacts/api-server/src/lib/business-growth-schema";
  const webPushRolloutModulePath = "../../artifacts/api-server/src/lib/web-push-schema";
  const bookingDevelopmentSchemaModulePath = "./booking-development-schema";
  const retailCartIndexModulePath = "./retail-cart-index-development-schema";
  const { ensureBusinessGrowthSchema } = await import(rolloutModulePath);
  const { ensureWebPushSchema } = await import(webPushRolloutModulePath);
  const { ensureBookingDevelopmentSchema } = await import(bookingDevelopmentSchemaModulePath);
  const { ensureRetailCartIndexDevelopmentSchema } = await import(retailCartIndexModulePath);
  await ensureBusinessGrowthSchema();
  await ensureWebPushSchema();
  await ensureBookingDevelopmentSchema();
  const retailCartIndex = await ensureRetailCartIndexDevelopmentSchema();
  console.log(`Retail cart NULL-safe standalone index verified (changed=${retailCartIndex.changed}).`);
} finally {
  await closePool();
}