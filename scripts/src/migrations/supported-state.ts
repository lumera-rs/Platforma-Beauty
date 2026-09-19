import type { DatabaseClient } from "../backend-standards-database";
import { readPostgresFingerprintCompatibility, readPostgresSnapshot } from "../schema-drift/catalog";
import { fingerprintSnapshot } from "../schema-drift/fingerprint";
import { pinFingerprintEnvironment } from "../schema-drift/fingerprint-transaction";
import { ownershipExceptions } from "../schema-drift/ownership";

const CANONICAL = {
  structural: "938c62183adabae9fdab00c5d968c39feb3f216e521b9031d1642575f5875cad",
  physical: "673f3810d49a4be6899482d44281607dac06d3e1012cd001e8348a45fdf5ea1f",
} as const;
const FAST = {
  structural: "b8b39c5dfdc9c19dec105cfecef8f6688a4a00982dd25b47847cc3d92a5c8a29",
  physical: "25bedc22380e260a6d84f802f8b1c4a948159ac1d1f9266f171cd27d7fb4a048",
} as const;
const REFERENCE_TABLES = [
  "suppliers", "beauty_job_platform_settings", "beauty_job_categories",
  "shop_settings", "b2c_display_settings", "aftercare_settings",
  "education_placement_settings", "education_b2b_discount_settings",
] as const;
const FALLBACKS = new Map([
  ["Education Start", 5], ["Education Growth", 15], ["Education Academy", 30],
]);
const RESERVED_NAMES = new Set(FALLBACKS.keys());
const MIGRATION_LEDGER = "lumera_migration_ledger";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

async function rows(client: DatabaseClient, sql: string, values?: unknown[]): Promise<Record<string, unknown>[]> {
  return (await client.query(sql, values)).rows;
}

export async function lockSupportedStartupTables(client: DatabaseClient): Promise<void> {
  const tables = await rows(client, `
    SELECT c.relname AS name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY c.oid
  `);
  const names = tables.map((row) => String(row.name));
  // A truly fresh database has no relations to lock. The runner must apply
  // 000001 before checking the supported existing-schema contract; this helper
  // must not turn that fresh precondition into a false failure.
  if (!names.length) return;
  await client.query(`LOCK TABLE ${names.map((name) => `public.${quoteIdentifier(name)}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
}

async function assertEmpty(client: DatabaseClient, table: string, message: string): Promise<void> {
  const result = await rows(client, `SELECT 1 FROM public.${quoteIdentifier(table)} LIMIT 1`);
  if (result.length) throw new Error(message);
}

async function assertEmptyBusinessTables(client: DatabaseClient): Promise<void> {
  const allowed = new Set<string>([
    ...REFERENCE_TABLES, "subscription_plans", "education_salon_cleanup_reports", MIGRATION_LEDGER,
  ]);
  const tables = await rows(client, `
    SELECT c.relname AS name
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname
  `);
  for (const row of tables) {
    const table = String(row.name);
    if (!allowed.has(table)) await assertEmpty(client, table, `SUPPORTED_STARTUP_UNSUPPORTED_DATA:${table}`);
  }
}

async function assertHistoricalBoundariesEmpty(client: DatabaseClient): Promise<void> {
  const relationships = await rows(client, `
    SELECT
      (SELECT count(*) FROM public.subscriptions) AS salon_subscriptions,
      (SELECT count(*) FROM public.education_center_subscriptions) AS education_subscriptions,
      (SELECT count(*) FROM public.education_payment_obligations) AS payment_obligations`);
  const relation = relationships[0]!;
  if (Number(relation.salon_subscriptions) > 0 || Number(relation.education_subscriptions) > 0) {
    throw new Error("SUPPORTED_STARTUP_PLAN_RELATIONSHIPS_REQUIRE_RECONCILIATION");
  }
  if (Number(relation.payment_obligations) > 0) {
    throw new Error("SUPPORTED_STARTUP_HISTORICAL_OBLIGATIONS_UNSUPPORTED");
  }
  const snapshots = await rows(client, `
    SELECT count(*) AS missing
    FROM public.education_center_subscriptions
    WHERE status IN ('trial','active','free_via_loyalty')
      AND (current_price_snapshot IS NULL OR current_course_limit_snapshot IS NULL)`);
  if (Number(snapshots[0]?.missing) > 0) {
    throw new Error("SUPPORTED_STARTUP_EMPTY_SUBSCRIPTION_SNAPSHOT");
  }
  const cleanupOwners = await rows(client, `
    SELECT
      (SELECT count(*) FROM public.users) AS users,
      (SELECT count(*) FROM public.salons) AS salons,
      (SELECT count(*) FROM public.education_centers) AS education_centers`);
  const owners = cleanupOwners[0]!;
  if (Number(owners.users) > 0 || Number(owners.salons) > 0 || Number(owners.education_centers) > 0) {
    throw new Error("SUPPORTED_STARTUP_CLEANUP_CANDIDATES_REQUIRE_PROVENANCE");
  }
  const audits = await rows(client, `
    SELECT 1
    FROM public.education_financial_audit_log
    LIMIT 1`);
  if (audits.length) throw new Error("SUPPORTED_STARTUP_AUDIT_HISTORY_UNSUPPORTED");
  const rollout = await rows(client, `
    SELECT 1
    FROM public.business_growth_schema_rollout
    LIMIT 1`);
  if (rollout.length) throw new Error("SUPPORTED_STARTUP_ROLLOUT_MARKER_NOT_MIGRATED");
}

async function assertReferenceState(client: DatabaseClient): Promise<void> {
  const supplierConflict = await rows(client, `
    SELECT 1 FROM public.suppliers
    WHERE (slug='lumera-legacy' AND id <> '9b5970ea-0a8c-5e60-9d32-2a09f0890560')
       OR (id='9b5970ea-0a8c-5e60-9d32-2a09f0890560' AND slug <> 'lumera-legacy') LIMIT 1`);
  if (supplierConflict.length) throw new Error("SUPPORTED_STARTUP_SUPPLIER_IDENTITY_CONFLICT");
  for (const table of ["beauty_job_platform_settings", "shop_settings", "b2c_display_settings"]) {
    const count = await rows(client, `SELECT count(*)::integer AS count FROM public.${quoteIdentifier(table)}`);
    if (Number(count[0]?.count) > 1) throw new Error(`SUPPORTED_STARTUP_AMBIGUOUS_SINGLETON:${table}`);
  }
  const categoryConflict = await rows(client, `
    SELECT 1 FROM public.beauty_job_categories p
    JOIN (VALUES
      ('frizeri','Frizeri','["Ženski frizer", "Muški frizer", "Kolorista"]'::jsonb,true,NULL::text),
      ('barberi','Barberi','["Šišanje", "Brijanje", "Stilizovanje brade"]'::jsonb,true,NULL),
      ('kozmetika','Kozmetika','[]'::jsonb,true,NULL),
      ('kozmeticari','Kozmetičari','["Nega lica", "Depilacija", "Tretmani tela"]'::jsonb,true,NULL),
      ('nokti','Nokti (Manikir/Pedikir)','["Manikir", "Pedikir", "Nail artist"]'::jsonb,true,NULL),
      ('lash-brow','Lash/Brow','["Ekstenzije trepavica", "Laminacija trepavica", "Obrve"]'::jsonb,true,NULL),
      ('make-up','Make-up','["Dnevna šminka", "Svečana šminka"]'::jsonb,true,NULL),
      ('sminkeri','Šminkeri','["Dnevna šminka", "Svečana šminka", "Editorial"]'::jsonb,true,NULL),
      ('pmu','PMU','["Obrve", "Usne", "Eyeliner"]'::jsonb,true,NULL),
      ('estetika-masaza','Estetika i masaža','["Estetika", "Masaža", "Terapeut"]'::jsonb,true,NULL),
      ('masaza-terapeuti','Masaža/Terapeuti','["Relaks masaža", "Sportska masaža", "Terapeut"]'::jsonb,true,NULL),
      ('estetika-anti-aging','Estetika/anti-aging','["Anti-aging", "Mezoterapija", "Nega lica"]'::jsonb,true,NULL),
      ('pomocno-osoblje','Pomoćno osoblje','["Recepcija", "Asistent u salonu", "Šampon"]'::jsonb,true,NULL),
      ('tattoo-piercing','Tattoo/Piercing','["Tattoo", "Piercing"]'::jsonb,true,'beauty_jobs_tattoo_piercing'),
      ('iznajmljivanje-opreme','Iznajmljivanje opreme','[]'::jsonb,true,NULL),
      ('iznajmljivanje-prostora-stolice','Iznajmljivanje prostora/stolice','["Stolica", "Kabina", "Prostor"]'::jsonb,true,NULL),
      ('freelance-angazmani','Freelance/angažmani','[]'::jsonb,true,NULL)
    ) s(slug,name,subtype_labels,enabled,feature_flag) USING (slug)
    WHERE ROW(p.name,p.subtype_labels,p.enabled,p.feature_flag)
      IS DISTINCT FROM ROW(s.name,s.subtype_labels,s.enabled,s.feature_flag) LIMIT 1`);
  if (categoryConflict.length) throw new Error("SUPPORTED_STARTUP_CATEGORY_PAYLOAD_CONFLICT");
}

async function assertPlanState(client: DatabaseClient): Promise<void> {
  const plans = await rows(client, `SELECT name,price,trial_days,features,limits,audience,course_limit,vat_included,price_copy,active FROM public.subscription_plans ORDER BY name`);
  const seen = new Set<number>();
  for (const plan of plans) {
    const name = String(plan.name);
    if (RESERVED_NAMES.has(name)) {
      const limit = FALLBACKS.get(name)!;
      if (plan.audience !== "education" || Number(plan.course_limit) !== limit
        || Number(plan.price) !== 0 || Number(plan.trial_days) !== 30
        || JSON.stringify(plan.features) !== "[]"
        || JSON.stringify(plan.limits) !== JSON.stringify({ courses: limit })
        || plan.vat_included !== true || plan.price_copy !== "Cena uključuje PDV." || plan.active !== false) {
        throw new Error(`SUPPORTED_STARTUP_FALLBACK_PAYLOAD_CONFLICT:${name}`);
      }
      if (seen.has(limit)) throw new Error(`SUPPORTED_STARTUP_DUPLICATE_FALLBACK_LIMIT:${limit}`);
      seen.add(limit);
    } else if (plan.audience !== "salon") {
      throw new Error(`SUPPORTED_STARTUP_UNSUPPORTED_PLAN_AUDIENCE:${name}`);
    }
  }
}

async function assertCleanupState(client: DatabaseClient): Promise<void> {
  const reports = await rows(client, `SELECT version,candidates,detached_users,deleted_salons,retired_salons FROM public.education_salon_cleanup_reports ORDER BY version`);
  for (const report of reports) {
    if (Number(report.version) !== 99 || Number(report.candidates) !== 0
      || Number(report.detached_users) !== 0 || Number(report.deleted_salons) !== 0
      || Number(report.retired_salons) !== 0) throw new Error("SUPPORTED_STARTUP_CLEANUP_PROVENANCE_UNSUPPORTED");
  }
}

export async function assertSupportedStartupState(client: DatabaseClient): Promise<{ state: "canonical" | "fast-path" }> {
  // Fingerprints are only comparable under the exact session settings used by
  // the catalog/fingerprint contract. This function is called inside the
  // caller's transaction; SET LOCAL does not open or nest a transaction.
  await pinFingerprintEnvironment(client);
  const compatibility = await readPostgresFingerprintCompatibility(client);
  const snapshot = await readPostgresSnapshot(client);
  const fingerprint = fingerprintSnapshot(snapshot, ownershipExceptions, compatibility);
  const accepted = fingerprint.structuralFingerprint === CANONICAL.structural
    && fingerprint.physicalFingerprint === CANONICAL.physical
    ? "canonical"
    : fingerprint.structuralFingerprint === FAST.structural
      && fingerprint.physicalFingerprint === FAST.physical ? "fast-path" : null;
  if (!accepted) {
    throw new Error(
      "SUPPORTED_STARTUP_SCHEMA_FINGERPRINT_UNSUPPORTED"
      + `:structural=${fingerprint.structuralFingerprint}`
      + `:physical=${fingerprint.physicalFingerprint}`
      + `:objects=${fingerprint.normalizedObjectCount}`
      + `:enums=${fingerprint.enumCount}`
      + `:triggers=${fingerprint.triggerCount}`
      + `:functions=${fingerprint.functionCount}`,
    );
  }
  await assertHistoricalBoundariesEmpty(client);
  await assertEmptyBusinessTables(client);
  await assertReferenceState(client);
  await assertPlanState(client);
  await assertCleanupState(client);
  return { state: accepted };
}