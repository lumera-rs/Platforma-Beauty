/**
 * Attributed-appointments NEW vs RETURNING indicator — regression suite
 *
 * Verifies that GET /growth/automations/:automationId/attributed-appointments
 * derives `isReturning` per row:
 *   1. true when the salon customer had a completed appointment strictly
 *      before the run's send date (sentAt, falling back to executedAt then
 *      createdAt)
 *   2. false when the customer had no appointments before the send
 *   3. false when the only prior appointment is cancelled/no-show (not
 *      completed) or dated on/after the send date
 *   4. null (unknown) when the appointment has no linked salon customer
 *   5. the attributed appointment itself never counts as its own prior visit,
 *      even if completed and dated before the send
 *   6. sentAt falls back to executedAt, then createdAt, while keeping the
 *      comparison strictly before the selected campaign timestamp
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/attributed-appointments-returning.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  appointmentsTable,
  automationRulesTable,
  automationRunsTable,
  db,
  pool,
  salonCustomersTable,
  salonsTable,
  servicesTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

const suffix = randomUUID().slice(0, 8);
const cleanup = { userIds: [] as string[], salonIds: [] as string[] };

async function main() {
  const hash = await hashPassword(`pass-ret-${suffix}`);
  const [owner] = await db.insert(usersTable).values({
    firstName: "Owner", lastName: "Ret",
    email: `ret-owner-${suffix}@bg.test`, passwordHash: hash, passwordSetAt: new Date(), role: "SALON_OWNER",
  }).returning();
  assert.ok(owner);
  cleanup.userIds.push(owner.id);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner.id, name: `Ret Salon ${suffix}`, slug: `ret-salon-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", postalCode: "11000",
    phone: `+38111${Math.floor(Math.random() * 9000000) + 1000000}`,
    email: `ret-salon-${suffix}@bg.test`,
    shortDescription: "Test", description: "Test salon", imageUrl: "/t.jpg",
  }).returning();
  assert.ok(salon);
  cleanup.salonIds.push(salon.id);
  await db.update(usersTable).set({ activeSalonId: salon.id }).where(eq(usersTable.id, owner.id));
  const token = await createSession(owner.id);

  const [svc] = await db.insert(servicesTable).values({
    salonId: salon.id, categoryName: "Hair", name: `Ret Service ${suffix}`, description: "Test",
    durationMinutes: 60, price: 3000, imageUrl: "/t.jpg", active: true,
  }).returning();
  assert.ok(svc);
  const [rule] = await db.insert(automationRulesTable).values({
    salonId: salon.id, name: `Ret Rule ${suffix}`,
    trigger: "inactive_days", triggerConfig: { inactiveDays: 30 },
    action: "send_email", emailSubject: "T", emailBody: "T",
    status: "active",
  }).returning();
  assert.ok(rule);

  const makeCustomer = async (tag: string) => {
    const [cust] = await db.insert(salonCustomersTable).values({
      salonId: salon.id, firstName: `Cust`, lastName: tag,
      email: `ret-cust-${tag}-${suffix}@bg.test`, phone: null, smsOptOut: false,
    }).returning();
    assert.ok(cust);
    return cust;
  };
  const makeAppointment = async (opts: {
    customerId: string | null; date: string; status: "completed" | "cancelled" | "no-show" | "confirmed"; price?: number;
  }) => {
    const [appt] = await db.insert(appointmentsTable).values({
      salonId: salon.id, salonCustomerId: opts.customerId, serviceId: svc.id,
      date: opts.date, startTime: "10:00", endTime: "11:00", durationMinutes: 60,
      status: opts.status, price: opts.price ?? 2000, treatmentLocation: "salon",
    }).returning();
    assert.ok(appt);
    return appt;
  };
  const SENT_AT = new Date("2026-02-01T10:00:00Z");
  let runSeq = 0;
  const makeRun = async (
    customerId: string,
    attributedAppointmentId: string,
    opts?: { noSentAt?: boolean; noExecutedAt?: boolean; createdAt?: Date },
  ) => {
    await db.insert(automationRunsTable).values({
      eventKey: `ret-run-${runSeq++}-${suffix}`, ruleId: rule.id, salonId: salon.id, salonCustomerId: customerId,
      status: "sent",
      executedAt: opts?.noExecutedAt ? null : SENT_AT,
      sentAt: opts?.noSentAt ? null : SENT_AT,
      createdAt: opts?.createdAt,
      attributedAppointmentId,
    });
  };

  // 1. Returning: completed appointment well before the send date.
  const returning = await makeCustomer("returning");
  await makeAppointment({ customerId: returning.id, date: "2026-01-10", status: "completed" });
  const returningAppt = await makeAppointment({ customerId: returning.id, date: "2026-02-05", status: "confirmed" });
  await makeRun(returning.id, returningAppt.id);

  // 2. New: no prior appointments at all.
  const brandNew = await makeCustomer("new");
  const newAppt = await makeAppointment({ customerId: brandNew.id, date: "2026-02-05", status: "confirmed" });
  await makeRun(brandNew.id, newAppt.id);

  // 3a. Not returning: only prior appointment was cancelled.
  const cancelledPrior = await makeCustomer("cancelled-prior");
  await makeAppointment({ customerId: cancelledPrior.id, date: "2026-01-10", status: "cancelled" });
  const cancelledPriorAppt = await makeAppointment({ customerId: cancelledPrior.id, date: "2026-02-06", status: "confirmed" });
  await makeRun(cancelledPrior.id, cancelledPriorAppt.id);

  // 3b. Not returning: completed appointment exists only ON/AFTER the send date.
  const laterOnly = await makeCustomer("later-only");
  await makeAppointment({ customerId: laterOnly.id, date: "2026-02-01", status: "completed" });
  const laterOnlyAppt = await makeAppointment({ customerId: laterOnly.id, date: "2026-02-07", status: "confirmed" });
  await makeRun(laterOnly.id, laterOnlyAppt.id);

  // 4. Unknown: attributed appointment has no linked salon customer.
  const runCustomer = await makeCustomer("run-holder");
  const walkInAppt = await makeAppointment({ customerId: null, date: "2026-02-08", status: "confirmed" });
  await makeRun(runCustomer.id, walkInAppt.id);

  // 5. Self-exclusion: attributed appointment is itself completed and dated
  //    before the send, with no other appointments — must NOT count as prior.
  //    Run has no sentAt, so the executedAt fallback anchors the send date.
  const selfOnly = await makeCustomer("self-only");
  const selfOnlyAppt = await makeAppointment({ customerId: selfOnly.id, date: "2026-01-20", status: "completed" });
  await makeRun(selfOnly.id, selfOnlyAppt.id, { noSentAt: true });

  // 6. executedAt is the anchor when a legacy run has no sentAt.
  const executedFallback = await makeCustomer("executed-fallback");
  await makeAppointment({ customerId: executedFallback.id, date: "2026-01-10", status: "completed" });
  const executedFallbackAppt = await makeAppointment({ customerId: executedFallback.id, date: "2026-02-05", status: "confirmed" });
  await makeRun(executedFallback.id, executedFallbackAppt.id, { noSentAt: true });

  // 7. createdAt is the final fallback. A completed visit ON its date is not
  // prior: date comparison must remain strictly before the coalesced value.
  const createdFallback = await makeCustomer("created-fallback");
  await makeAppointment({ customerId: createdFallback.id, date: "2026-03-01", status: "completed" });
  const createdFallbackAppt = await makeAppointment({ customerId: createdFallback.id, date: "2026-03-02", status: "confirmed" });
  await makeRun(createdFallback.id, createdFallbackAppt.id, {
    noSentAt: true,
    noExecutedAt: true,
    createdAt: new Date("2026-03-01T10:00:00Z"),
  });

  const server = app.listen(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const response = await fetch(
      `${baseUrl}/api/growth/automations/${rule.id}/attributed-appointments?limit=100`,
      { headers: { cookie: `${sessionCookieName}=${token}` } },
    );
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.total, 8, "all eight attributed appointments present");
    const byId = new Map<string, any>(body.items.map((i: any) => [i.appointmentId, i]));

    assert.equal(byId.get(returningAppt.id)?.isReturning, true, "prior completed appointment → returning");
    assert.equal(byId.get(newAppt.id)?.isReturning, false, "no prior appointments → new");
    assert.equal(byId.get(cancelledPriorAppt.id)?.isReturning, false, "cancelled prior appointment does not count → new");
    assert.equal(byId.get(laterOnlyAppt.id)?.isReturning, false, "completed on/after the send date does not count → new");
    assert.equal(byId.get(walkInAppt.id)?.isReturning, null, "no linked salon customer → unknown");
    assert.equal(byId.get(selfOnlyAppt.id)?.isReturning, false, "attributed appointment never counts as its own prior visit");
    assert.equal(byId.get(executedFallbackAppt.id)?.isReturning, true, "executedAt fallback finds a strictly prior completed appointment");
    assert.equal(byId.get(createdFallbackAppt.id)?.isReturning, false, "createdAt fallback keeps same-day completed appointment new");
    console.log("✓ isReturning derived correctly for all coalesce fallback scenarios");

    // Summary aggregates: same derivation as the per-row field, over the whole
    // attributed set. new = brandNew, cancelledPrior, laterOnly, selfOnly,
    // createdFallback; returning = priorCompleted, executedFallback.
    assert.equal(body.newClientCount, 5, "five new clients");
    assert.equal(body.returningClientCount, 2, "two returning clients");
    assert.equal(body.unknownClientCount, 1, "one unknown (no linked salon customer)");
    assert.equal(
      body.newClientCount + body.returningClientCount + body.unknownClientCount,
      body.total,
      "summary buckets partition the unfiltered total exactly",
    );

    // The campaign overview must expose the exact same period-wide mix as the
    // attributed-appointments response for this rule.
    const overviewResponse = await fetch(
      `${baseUrl}/api/growth/automation-stats`,
      { headers: { cookie: `${sessionCookieName}=${token}` } },
    );
    assert.equal(overviewResponse.status, 200);
    const overviewBody = await overviewResponse.json() as any[];
    const overviewRule = overviewBody.find((item) => item.ruleId === rule.id);
    assert.ok(overviewRule, "rule present in overview stats");
    assert.equal(overviewRule.newClientCount, body.newClientCount, "overview new-client count matches drill-down");
    assert.equal(overviewRule.returningClientCount, body.returningClientCount, "overview returning-client count matches drill-down");
    assert.equal(overviewRule.unknownClientCount, body.unknownClientCount, "overview unknown-client count matches drill-down");
    assert.equal(
      overviewRule.newClientCount + overviewRule.returningClientCount + overviewRule.unknownClientCount,
      overviewRule.attributedAppointments,
      "overview client-mix buckets partition attributed appointments",
    );
    assert.equal(
      overviewRule.newClientShare,
      80,
      "overview new-client share excludes the one unknown client from its denominator",
    );

    const statsResponse = await fetch(
      `${baseUrl}/api/growth/automations/${rule.id}/stats?period=all`,
      { headers: { cookie: `${sessionCookieName}=${token}` } },
    );
    assert.equal(statsResponse.status, 200);
    const statsBody = await statsResponse.json() as any;
    assert.equal(
      statsBody.newClientShare,
      80,
      "per-rule stats report the same new-client share as the overview",
    );
    console.log("✓ overview client mix matches the attributed-appointments summary");

    // Pagination must not change the summary: a small page still reports the
    // full-set counts, so the dialog summary stays stable while pages load.
    const pagedResponse = await fetch(
      `${baseUrl}/api/growth/automations/${rule.id}/attributed-appointments?limit=2&offset=0`,
      { headers: { cookie: `${sessionCookieName}=${token}` } },
    );
    assert.equal(pagedResponse.status, 200);
    const pagedBody = await pagedResponse.json() as any;
    assert.equal(pagedBody.items.length, 2, "page size respected");
    assert.equal(pagedBody.total, 8, "paged total unchanged");
    assert.equal(pagedBody.newClientCount, 5, "paged newClientCount covers the full set");
    assert.equal(pagedBody.returningClientCount, 2, "paged returningClientCount covers the full set");
    assert.equal(pagedBody.unknownClientCount, 1, "paged unknownClientCount covers the full set");
    console.log("✓ new/returning/unknown summary counts aggregate the full attributed set");

    // clientType=returning: only the customer with a prior completed visit.
    const returningResp = await fetch(
      `${baseUrl}/api/growth/automations/${rule.id}/attributed-appointments?limit=100&clientType=returning`,
      { headers: { cookie: `${sessionCookieName}=${token}` } },
    );
    assert.equal(returningResp.status, 200);
    const returningBody = await returningResp.json() as any;
    assert.equal(returningBody.total, 2, "clientType=returning total counts only returning rows");
    assert.equal(returningBody.items.length, 2, "clientType=returning returns only returning rows");
    assert.deepEqual(
      new Set(returningBody.items.map((item: any) => item.appointmentId)),
      new Set([returningAppt.id, executedFallbackAppt.id]),
      "returning segment includes sentAt and executedAt-anchor cases",
    );
    assert.ok(returningBody.items.every((item: any) => item.isReturning === true));
    // The mix summary describes the whole window, not the filtered segment,
    // so the "X novih · Y vraćenih" line stays stable while filtering.
    assert.equal(returningBody.newClientCount, 5, "summary newClientCount ignores clientType filter");
    assert.equal(returningBody.returningClientCount, 2, "summary returningClientCount ignores clientType filter");
    assert.equal(returningBody.unknownClientCount, 1, "summary unknownClientCount ignores clientType filter");
    console.log("✓ clientType=returning filters to both returning clients");

    // clientType=new: the five isReturning=false rows; the walk-in (null)
    // matches neither segment.
    const newResp = await fetch(
      `${baseUrl}/api/growth/automations/${rule.id}/attributed-appointments?limit=100&clientType=new`,
      { headers: { cookie: `${sessionCookieName}=${token}` } },
    );
    assert.equal(newResp.status, 200);
    const newBody = await newResp.json() as any;
    assert.equal(newBody.total, 5, "clientType=new total counts only new rows");
    const newIds = new Set(newBody.items.map((i: any) => i.appointmentId));
    assert.deepEqual(
      newIds,
      new Set([newAppt.id, cancelledPriorAppt.id, laterOnlyAppt.id, selfOnlyAppt.id, createdFallbackAppt.id]),
      "clientType=new returns exactly the five new-client rows",
    );
    assert.ok(!newIds.has(walkInAppt.id), "unknown (no salon customer) row excluded from new segment");
    assert.ok(newBody.items.every((i: any) => i.isReturning === false), "every new-segment row has isReturning=false");
    assert.equal(newBody.newClientCount, 5, "summary newClientCount ignores clientType filter");
    assert.equal(newBody.returningClientCount, 2, "summary returningClientCount ignores clientType filter");
    console.log("✓ clientType=new filters to the five new clients and excludes the unknown row");

    // Invalid clientType is rejected.
    const badResp = await fetch(
      `${baseUrl}/api/growth/automations/${rule.id}/attributed-appointments?clientType=vip`,
      { headers: { cookie: `${sessionCookieName}=${token}` } },
    );
    assert.equal(badResp.status, 400, "invalid clientType → 400");
    console.log("✓ invalid clientType rejected with 400");
  } finally {
    server.close();
    await db.delete(automationRunsTable).where(eq(automationRunsTable.ruleId, rule.id));
    await db.delete(appointmentsTable).where(eq(appointmentsTable.salonId, salon.id));
    await db.delete(automationRulesTable).where(eq(automationRulesTable.id, rule.id));
    await db.delete(salonCustomersTable).where(eq(salonCustomersTable.salonId, salon.id));
    await db.delete(servicesTable).where(eq(servicesTable.salonId, salon.id));
    await db.update(usersTable).set({ activeSalonId: null }).where(inArray(usersTable.id, cleanup.userIds));
    await db.delete(salonsTable).where(inArray(salonsTable.id, cleanup.salonIds));
    await db.delete(usersTable).where(inArray(usersTable.id, cleanup.userIds));
    await pool.end();
  }
  console.log("All attributed-appointments returning-indicator checks passed.");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
