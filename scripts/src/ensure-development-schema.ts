import { closePool } from "@workspace/db";

try {
  const rolloutModulePath = "../../artifacts/api-server/src/lib/business-growth-schema";
  const { ensureBusinessGrowthSchema } = await import(rolloutModulePath);
  await ensureBusinessGrowthSchema();
} finally {
  await closePool();
}