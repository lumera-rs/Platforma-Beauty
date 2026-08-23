/**
 * Emergency-SMS fallback audience notice — regression suite
 *
 * The delivery-report silence SMS fallback can only reach active
 * ADMIN/SUPER_ADMIN users with a phone number on file. When nobody qualifies,
 * the fallback degrades to a log line — so GET /admin/integrations reports
 * `smsFallback.reachableAdminCount` (computed by smsFallbackReachableAdminCount,
 * which shares the exact audience and phone predicate with the send path) and
 * the admin panel shows a standing warning while the count is zero.
 *
 * Verified here:
 *   1. Zero state: with every active admin phone cleared, the endpoint
 *      reports reachableAdminCount = 0 (the notice condition)
 *   2. Whitespace-only phones do NOT count (same predicate as the send path)
 *   3. A non-admin role with a phone does NOT count (audience is admins only)
 *   4. An active admin with a real phone flips the count to 1 (notice clears)
 *   5. Deactivating that admin drops the count back to 0 (active-only audience)
 *
 * The users table is global, so the suite snapshots the phone columns of every
 * active admin up front and restores the exact prior values afterwards.
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/sms-fallback-admin-phone-notice.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { smsFallbackReachableAdminCount } from "./delivery-report-alerts";

const suffix = randomUUID().slice(0, 8);
const cleanup = { userIds: [] as string[] };

async function run() {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Snapshot every active admin's phone columns for exact restoration, then
  // clear them so the suite starts from the deterministic zero state.
  const priorPhones = await db.select({
    id: usersTable.id,
    phone: usersTable.phone,
    phoneNormalized: usersTable.phoneNormalized,
  }).from(usersTable).where(and(
    eq(usersTable.active, true),
    inArray(usersTable.role, ["ADMIN", "SUPER_ADMIN"]),
    isNotNull(usersTable.phone),
  ));
  await db.update(usersTable).set({ phone: null, phoneNormalized: null })
    .where(inArray(usersTable.id, priorPhones.map((row) => row.id)));

  try {
    const [admin] = await db.insert(usersTable).values({
      firstName: "Admin", lastName: "SmsFallback",
      email: `sms-fallback-admin-${suffix}@bg.test`,
      passwordHash: await hashPassword(`sms-fallback-${suffix}`),
      passwordSetAt: new Date(), role: "ADMIN",
    }).returning();
    assert.ok(admin);
    cleanup.userIds.push(admin.id);
    const cookie = `${sessionCookieName}=${await createSession(admin.id)}`;

    const reachableAdminCount = async () => {
      const response = await fetch(`${baseUrl}/api/admin/integrations`, { headers: { cookie } });
      assert.equal(response.status, 200, "admin integrations read must succeed");
      const body = await response.json() as { smsFallback?: { reachableAdminCount?: number } };
      assert.ok(body.smsFallback, "response must carry the smsFallback audience health block");
      assert.equal(typeof body.smsFallback.reachableAdminCount, "number",
        "reachableAdminCount must be a number");
      return body.smsFallback.reachableAdminCount!;
    };

    // ── 1. Zero state: no active admin has a phone ─────────────────────────
    assert.equal(await reachableAdminCount(), 0,
      "with every active admin phone cleared the endpoint must report 0 (notice shows)");
    assert.equal(await smsFallbackReachableAdminCount(), 0,
      "helper must agree with the endpoint in the zero state");
    console.log("✓ zero state: endpoint reports reachableAdminCount = 0");

    // ── 2. Whitespace-only phones do not count ─────────────────────────────
    await db.update(usersTable).set({ phone: "   " }).where(eq(usersTable.id, admin.id));
    assert.equal(await reachableAdminCount(), 0,
      "a whitespace-only phone must not count — same predicate as the SMS send path");
    console.log("✓ whitespace-only phone does not count");

    // ── 3. Non-admin roles with phones do not count ────────────────────────
    const [customer] = await db.insert(usersTable).values({
      firstName: "Customer", lastName: "SmsFallback",
      email: `sms-fallback-customer-${suffix}@bg.test`,
      passwordHash: await hashPassword(`sms-fallback-c-${suffix}`),
      passwordSetAt: new Date(), role: "CUSTOMER", phone: "+381601234567",
    }).returning();
    assert.ok(customer);
    cleanup.userIds.push(customer.id);
    assert.equal(await reachableAdminCount(), 0,
      "a non-admin phone must not count — the fallback audience is ADMIN/SUPER_ADMIN only");
    console.log("✓ non-admin phone does not count");

    // ── 4. An active admin with a real phone clears the notice ─────────────
    const [phoneAdmin] = await db.insert(usersTable).values({
      firstName: "Admin", lastName: "WithPhone",
      email: `sms-fallback-phone-admin-${suffix}@bg.test`,
      passwordHash: await hashPassword(`sms-fallback-p-${suffix}`),
      passwordSetAt: new Date(), role: "SUPER_ADMIN", phone: "+381609876543",
    }).returning();
    assert.ok(phoneAdmin);
    cleanup.userIds.push(phoneAdmin.id);
    assert.equal(await reachableAdminCount(), 1,
      "one active admin with a phone must flip the count to 1 (notice disappears)");
    console.log("✓ one active admin with a phone clears the notice condition");

    // ── 5. Deactivated admins fall out of the audience ─────────────────────
    await db.update(usersTable).set({ active: false }).where(eq(usersTable.id, phoneAdmin.id));
    assert.equal(await reachableAdminCount(), 0,
      "a deactivated admin's phone must not count — the audience is active admins only");
    console.log("✓ deactivated admin drops out of the reachable audience");

    console.log("\n✅ All emergency-SMS fallback audience notice tests passed");
  } finally {
    server.close();
    if (cleanup.userIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, cleanup.userIds));
    }
    // Restore the exact prior phone values of the real admins.
    for (const row of priorPhones) {
      await db.update(usersTable)
        .set({ phone: row.phone, phoneNormalized: row.phoneNormalized })
        .where(eq(usersTable.id, row.id));
    }
    await pool.end();
  }
}

run().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
