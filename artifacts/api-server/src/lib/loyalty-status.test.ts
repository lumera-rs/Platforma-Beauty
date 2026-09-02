import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  loyaltyTiersTable,
  pool,
  salonLoyaltyStatusesTable,
  salonsTable,
  usersTable,
} from "@workspace/db";
import { GetLoyaltyStatusResponse } from "@workspace/api-zod";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureDemoData } from "./seed";

// Regression: with zero active loyalty tiers the loyalty status endpoint must
// return a schema-valid neutral default (preserving any accrued spend) instead
// of throwing / returning HTTP 500. We temporarily deactivate all active tiers,
// exercise the endpoint, then restore the tiers exactly as they were.
async function run(): Promise<void> {
  await ensureDemoData();

  const suffix = randomUUID();
  const passwordHash = await hashPassword(`loyalty-zero-tier-${suffix}`);
  const preservedSpend = 4210;

  let deactivatedTierIds: string[] = [];
  let ownerId: string | undefined;
  let salonId: string | undefined;
  let server: ReturnType<typeof app.listen> | undefined;

  try {
    const [owner] = await db.insert(usersTable).values({
      firstName: "Vlasnik",
      lastName: "Loyalty zero",
      email: `loyalty-zero-owner-${suffix}@example.test`,
      passwordHash,
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    }).returning();
    assert.ok(owner);
    ownerId = owner.id;

    const [salon] = await db.insert(salonsTable).values({
      ownerId: owner.id,
      name: `Loyalty zero salon ${suffix}`,
      slug: `loyalty-zero-salon-${suffix}`,
      city: "Beograd",
      municipality: "Vračar",
      address: "Test 1",
      postalCode: "11000",
      phone: "+381110000099",
      email: `loyalty-zero-salon-${suffix}@example.test`,
      shortDescription: "Izolovan salon za loyalty regresioni test.",
      description: "Salon za proveru ponašanja kada nema aktivnih loyalty nivoa.",
      imageUrl: "/test.jpg",
    }).returning();
    assert.ok(salon);
    salonId = salon.id;
    await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));

    // Give this salon an accrued spend so we can assert it is preserved.
    await db.insert(salonLoyaltyStatusesTable).values({
      salonId: salon.id,
      tierId: null,
      currentPeriodSpend: preservedSpend,
    });

    // Deactivate every currently active tier so the endpoint sees zero tiers.
    const activeTiers = await db.update(loyaltyTiersTable)
      .set({ active: false })
      .where(eq(loyaltyTiersTable.active, true))
      .returning({ id: loyaltyTiersTable.id });
    deactivatedTierIds = activeTiers.map((tier) => tier.id);

    const token = await createSession(owner.id);
    const cookie = `${sessionCookieName}=${token}`;
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const response = await fetch(`${baseUrl}/loyalty/status`, {
      headers: { cookie },
    });
    const body = await response.json();

    assert.equal(response.status, 200, `zero active tiers must not fail: ${JSON.stringify(body)}`);
    assert.notEqual(response.status, 500, "zero active tiers must never become a 500");

    // Must be schema-valid.
    const parsed = GetLoyaltyStatusResponse.parse(body);

    // Neutral defaults + preserved spend.
    assert.equal(parsed.monthlySpend, preservedSpend, "accrued spend must be preserved");
    assert.equal(parsed.amountToNextTier, 0, "no next tier when there are zero tiers");
    assert.equal(parsed.nextTier ?? null, null, "no next tier name when there are zero tiers");
    assert.equal(parsed.tierThreshold, 0, "neutral tier threshold with zero tiers");
    assert.equal(parsed.subscriptionDiscountPercent, 0, "no subscription discount with zero tiers");
    assert.equal(parsed.productDiscountPercent, 0, "no product discount with zero tiers");
    assert.equal(parsed.freeSubscription, false, "no free subscription with zero tiers");
    assert.deepEqual(parsed.benefits, [], "no benefits with zero tiers");
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    }
    // Restore tiers exactly as they were before the test.
    if (deactivatedTierIds.length) {
      await db.update(loyaltyTiersTable)
        .set({ active: true })
        .where(inArray(loyaltyTiersTable.id, deactivatedTierIds));
    }
    if (salonId) {
      await db.delete(salonLoyaltyStatusesTable).where(eq(salonLoyaltyStatusesTable.salonId, salonId));
      await db.delete(salonsTable).where(eq(salonsTable.id, salonId));
    }
    if (ownerId) {
      await db.delete(usersTable).where(eq(usersTable.id, ownerId));
    }
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
