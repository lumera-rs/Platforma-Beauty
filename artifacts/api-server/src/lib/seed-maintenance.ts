/**
 * Explicit production-data maintenance.
 *
 * These routines are deliberately not imported by request handlers, startup
 * code, or the automatic fixture sequence.  Callers that have an independently
 * scheduled and reviewed maintenance operation may invoke one explicitly.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  appointmentsTable,
  db,
  oauthIdentitiesTable,
  productsTable,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";

const postalCodesByCity: Record<string, string> = {
  Beograd: "11000",
  "Novi Sad": "21000",
  Niš: "18000",
  Kragujevac: "34000",
  Subotica: "24000",
  Čačak: "32000",
  Pančevo: "26000",
};

/** Set a missing local-password timestamp without touching OAuth identities. */
export async function backfillPasswordSetAt(): Promise<void> {
  await db.execute(sql`
    update ${usersTable}
    set password_set_at = now()
    where ${usersTable.passwordSetAt} is null
      and not exists (
        select 1 from ${oauthIdentitiesTable}
        where ${oauthIdentitiesTable.userId} = ${usersTable.id}
      )
  `);
}

/** Fill only missing postal codes using the salon's existing city value. */
export async function backfillSalonPostalCodes(): Promise<void> {
  for (const [city, postalCode] of Object.entries(postalCodesByCity)) {
    await db.update(salonsTable).set({ postalCode }).where(
      sql`${salonsTable.postalCode} is null and ${salonsTable.city} = ${city}`,
    );
  }
}

function serviceTargetsMen(
  service: Pick<typeof servicesTable.$inferSelect, "categoryName" | "tags">,
): boolean {
  return service.categoryName === "Muški frizeri"
    || service.tags.some((tag) => tag.toLowerCase().includes("muškar"));
}

/**
 * Reconcile the inferred servesMen flag for salons that have not manually
 * overridden it.  This is a maintenance operation, not fixture setup.
 */
export async function synchronizeInferredServesMen(): Promise<void> {
  const activeServices = await db.select({
    salonId: servicesTable.salonId,
    categoryName: servicesTable.categoryName,
    tags: servicesTable.tags,
  }).from(servicesTable).where(eq(servicesTable.active, true));
  const salonIdsServingMen = [...new Set(activeServices.filter(serviceTargetsMen).map((service) => service.salonId))];

  await db.update(salonsTable)
    .set({ servesMen: false })
    .where(eq(salonsTable.servesMenManuallySet, false));
  if (salonIdsServingMen.length) {
    await db.update(salonsTable)
      .set({ servesMen: true })
      .where(and(
        eq(salonsTable.servesMenManuallySet, false),
        inArray(salonsTable.id, salonIdsServingMen),
      ));
  }
}

/**
 * Reconcile CRM contacts from historical appointments.  Existing contacts
 * remain authoritative, including their communication preferences.
 */
export async function backfillSalonCustomers(): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${salonCustomersTable}
      (salon_id, user_id, first_name, last_name, email, phone)
    SELECT DISTINCT ON (a.salon_id, a.customer_id)
      a.salon_id, u.id, u.first_name, u.last_name, u.email, u.phone
    FROM ${appointmentsTable} a
    INNER JOIN ${usersTable} u ON u.id = a.customer_id
    WHERE a.customer_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM ${salonCustomersTable} existing_contact
        WHERE existing_contact.salon_id = a.salon_id
          AND existing_contact.user_id = a.customer_id
      )
    ORDER BY a.salon_id, a.customer_id, a.created_at
    ON CONFLICT (salon_id, user_id) DO NOTHING
  `);

  await db.execute(sql`
    UPDATE ${appointmentsTable} a
    SET salon_customer_id = contact.id
    FROM ${salonCustomersTable} contact
    WHERE a.salon_customer_id IS NULL
      AND a.customer_id IS NOT NULL
      AND contact.salon_id = a.salon_id
      AND contact.user_id = a.customer_id
  `);
}

/** Backfill gift-card variant adjustments only when they are absent. */
export async function backfillGiftCardVariantPriceAdjustments(): Promise<void> {
  const [giftCard] = await db.select().from(productsTable)
    .where(eq(productsTable.sku, "GPK-045")).limit(1);
  if (!giftCard?.variants?.some((variant) => variant.label === "Vrednost" && variant.priceAdjust === undefined)) return;

  const variants = giftCard.variants.map((variant) => {
    if (variant.label !== "Vrednost" || variant.priceAdjust !== undefined) return variant;
    const amount = Number.parseInt(variant.value.replace(/\D/g, ""), 10);
    return Number.isFinite(amount) ? { ...variant, priceAdjust: amount - giftCard.price } : variant;
  });
  await db.update(productsTable).set({ variants }).where(eq(productsTable.id, giftCard.id));
}

/** Populate missing product weights without changing an existing weight. */
export async function backfillProductWeights(): Promise<void> {
  await db.execute(
    sql`UPDATE products SET weight_grams = CASE
      WHEN unit ~* '^[0-9]+\\s*ml$' THEN GREATEST(50, (substring(unit from '^([0-9]+)'))::int + 80)
      WHEN unit ~* '^[0-9]+\\s*g$'  THEN GREATEST(50, (substring(unit from '^([0-9]+)'))::int + 60)
      WHEN unit ~* 'set\\s*[0-9]+' OR unit ~* '^set$' THEN 500
      WHEN unit ~* '[0-9]+\\s*kom$' THEN GREATEST(150, (substring(unit from '([0-9]+)\\s*kom'))::int * 5)
      WHEN unit ~* '^[0-9]+\\s*m$' THEN 400
      WHEN unit ~* 'kom' AND (name ~* 'krevet|stolica|frezark|fen|presa|mašinic|lampa|steriliz|aparat|kabinet') THEN 3500
      WHEN unit ~* 'kom' THEN 400
      ELSE 300
    END
    WHERE weight_grams IS NULL`,
  );
}
