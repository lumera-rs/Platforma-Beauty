import { pool } from "@workspace/db";
import {
  invalidateCatalogCache,
  type CatalogCacheNamespace,
} from "./catalog-cache";

const namespace = process.argv[2] as CatalogCacheNamespace | undefined;
if (!namespace) throw new Error("Cache namespace is required.");

try {
  await invalidateCatalogCache(namespace);
} finally {
  await pool.end();
}