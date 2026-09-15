import type { OwnershipException } from "./model";

/**
 * Reviewable registry for objects intentionally outside the Drizzle schema.
 * Entries are exact (no globs), so a newly introduced object is actionable.
 */
export const ownershipExceptions: OwnershipException[] = [
  {
    objectType: "TABLE",
    schema: "public",
    name: "education_salon_cleanup_reports",
    owner: "startup Business Growth bootstrap",
    mechanism: "ensureBusinessGrowthSchema cleanup-report DDL",
    reason: "Transition cleanup evidence is currently bootstrap-owned and has no Drizzle declaration.",
    temporary: true,
  },
  {
    objectType: "TABLE",
    schema: "public",
    name: "spatial_ref_sys",
    owner: "PostGIS extension",
    mechanism: "CREATE EXTENSION postgis",
    reason: "PostGIS owns its spatial reference-system catalog, not the application.",
    temporary: false,
  },
];