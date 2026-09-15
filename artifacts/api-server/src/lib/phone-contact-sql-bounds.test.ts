import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  salonCustomersTable,
  salonsTable,
  serbianPhoneNormalizedSqlExpression,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "./auth";
import { findSalonCustomerByPhone, linkPhoneContactsToUser, normalizedPhone } from "../routes/marketplace";

async function run() {
  const suffix = randomUUID();
  const phoneTail = [...suffix.replaceAll("-", "")].map((character) => character.charCodeAt(0) % 10).join("").slice(0, 7);
  const matchingPhone = `38164${phoneTail}`;
  const localMatchingPhone = `064${phoneTail}`;
  const userIds: string[] = [];
  const salonIds: string[] = [];
  const originalQuery = pool.query.bind(pool);

  try {
    const passwordHash = await hashPassword(`Phone-sql-${suffix}`);
    const [owner, customer] = await db.insert(usersTable).values([
      { firstName: "Phone", lastName: "Owner", email: `phone-owner-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "SALON_OWNER" },
      { firstName: "Phone", lastName: "Customer", email: `phone-customer-${suffix}@example.test`, passwordHash, passwordSetAt: new Date(), role: "CUSTOMER", phone: `+${matchingPhone}`, phoneNormalized: matchingPhone },
    ]).returning();
    assert.ok(owner && customer);
    userIds.push(owner.id, customer.id);
    const salons = await db.insert(salonsTable).values([0, 1, 2].map((number) => ({
      ownerId: owner.id, name: `Phone SQL ${number} ${suffix}`, slug: `phone-sql-${number}-${suffix}`,
      city: "Beograd", municipality: "Vračar", address: "Test 1", phone: `+3816012345${number}`,
      email: `phone-salon-${number}-${suffix}@example.test`, shortDescription: "Phone SQL test",
      description: "Phone SQL test", imageUrl: "",
    }))).returning();
    assert.equal(salons.length, 3);
    salonIds.push(...salons.map((salon) => salon.id));

    const [legacyDuplicate, canonical, otherTenantMatch, unrelated, phoneless] = await db.insert(salonCustomersTable).values([
      { salonId: salons[0]!.id, firstName: "Legacy", lastName: "Match", phone: `${localMatchingPhone.slice(0, 3)} / ${localMatchingPhone.slice(3, 6)}-${localMatchingPhone.slice(6)}`, phoneNormalized: null },
      { salonId: salons[0]!.id, firstName: "Canonical", lastName: "Match", phone: `+${matchingPhone}`, phoneNormalized: matchingPhone },
      { salonId: salons[1]!.id, firstName: "Other tenant", lastName: "Match", phone: `00${matchingPhone}`, phoneNormalized: null },
      { salonId: salons[0]!.id, firstName: "Unrelated", lastName: "Contact", phone: "0651112222", phoneNormalized: "381651112222" },
      { salonId: salons[0]!.id, firstName: "No", lastName: "Phone", phone: null, phoneNormalized: null },
      ...Array.from({ length: 40 }, (_, index) => ({
        salonId: salons[2]!.id, firstName: `Unrelated ${index}`, lastName: "Bulk",
        phone: `+38163${String(index).padStart(7, "0")}`, phoneNormalized: `38163${String(index).padStart(7, "0")}`,
      })),
    ]).returning();
    assert.ok(canonical && legacyDuplicate && otherTenantMatch && unrelated && phoneless);
    for (const input of [matchingPhone, `+${matchingPhone}`, `00${matchingPhone}`, localMatchingPhone]) {
      assert.equal(normalizedPhone(input), matchingPhone, `valid Serbian form ${input} must keep canonical +381 semantics`);
    }

    const legacyPhoneNormalized = sql.raw(
      serbianPhoneNormalizedSqlExpression("\"salon_customers\".\"phone\""),
    );
    const lookupPlan = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      return tx.execute(sql`
        EXPLAIN (FORMAT JSON)
        SELECT id FROM salon_customers
        WHERE phone_normalized = ${matchingPhone}
           OR ${legacyPhoneNormalized} = ${matchingPhone}
      `);
    });
    const lookupPlanText = JSON.stringify(lookupPlan.rows);
    assert.match(lookupPlanText, /salon_customers_phone_normalized_idx/,
      "canonical phone matching must use its bounded index branch");
    assert.match(lookupPlanText, /salon_customers_phone_legacy_normalized_expr_idx/,
      "legacy Serbian phone matching must use its bounded expression-index branch");

    const [phonelessLookup] = await db.select({
      normalized: legacyPhoneNormalized,
    }).from(salonCustomersTable).where(eq(salonCustomersTable.id, phoneless.id));
    assert.equal(phonelessLookup?.normalized, null, "NULL phones must remain unmatchable");
    assert.equal(normalizedPhone("bez-broja"), "", "digit-free input must normalize to an invalid empty value");

    let queryCount = 0;
    const queryTexts: string[] = [];
    pool.query = ((...args: Parameters<typeof pool.query>) => {
      queryCount += 1;
      const query = args[0] as unknown;
      queryTexts.push(typeof query === "string"
        ? query
        : query && typeof query === "object" && "text" in query ? String((query as { text: unknown }).text) : "");
      return originalQuery(...args);
    }) as typeof pool.query;

    const emptyMatch = await findSalonCustomerByPhone(db, salons[0]!.id, "");
    assert.equal(emptyMatch, undefined, "an empty normalized phone must never enter contact lookup");
    assert.equal(queryCount, 0, "an empty normalized phone must be rejected before querying CRM contacts");

    const found = await findSalonCustomerByPhone(db, salons[0]!.id, matchingPhone);
    assert.equal(found?.id, canonical.id, "canonical +381 matching must be retained");
    assert.equal(queryCount, 1, "guest contact resolution has a one-query budget");
    assert.match(queryTexts[0]!.toLowerCase(), /where/, "phone filtering must be emitted to SQL rather than applied after loading rows");
    assert.match(queryTexts[0]!.toLowerCase(), /salon_id/, "guest matching must remain tenant-scoped in SQL");

    queryCount = 0;
    queryTexts.length = 0;
    await linkPhoneContactsToUser(db, customer.id, localMatchingPhone);
    assert.ok(queryCount <= 9, `contact linking exceeded its fixed merge query budget: ${queryCount}`);
    assert.match(queryTexts[0]!.toLowerCase(), /where/, "global contact linking must load only matching rows");

    const linked = await db.select().from(salonCustomersTable).where(eq(salonCustomersTable.userId, customer.id));
    assert.equal(linked.length, 2, "matching contacts must merge once per salon while preserving cross-tenant records");
    assert.deepEqual(new Set(linked.map((contact) => contact.salonId)), new Set([salons[0]!.id, salons[1]!.id]));
    assert.equal(linked.find((contact) => contact.salonId === salons[0]!.id)?.id, canonical.id, "the existing canonical contact must win the merge");
    assert.equal((await db.select().from(salonCustomersTable).where(eq(salonCustomersTable.id, legacyDuplicate.id))).length, 0);
    const [unrelatedAfter] = await db.select().from(salonCustomersTable).where(and(
      eq(salonCustomersTable.id, unrelated.id),
      eq(salonCustomersTable.phoneNormalized, "381651112222"),
    ));
    assert.ok(unrelatedAfter, "unrelated contact data must remain untouched");
  } finally {
    pool.query = originalQuery as typeof pool.query;
    if (salonIds.length) await db.delete(salonsTable).where(inArray(salonsTable.id, salonIds));
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});