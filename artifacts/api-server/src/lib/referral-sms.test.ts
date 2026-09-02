import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  phoneVerificationProofsTable,
  pool,
  salonCustomersTable,
  salonsTable,
  smsDeliveriesTable,
  usersTable,
} from "@workspace/db";
import {
  enqueueReferralSmsInTx,
  sendSms,
  type SmsProvider,
} from "./sms";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { ensureReferralSchema } from "./referral-schema";

const suffix = randomUUID();
const eventKeys = [
  `referral-sms-verified:${suffix}`,
  `referral-sms-unverified:${suffix}`,
  `referral-sms-revoked:${suffix}`,
  `referral-sms-optout:${suffix}`,
  `referral-sms-retry:${suffix}`,
];

test("referral SMS outbox enforces durable phone proof, opt-out, dedupe and retry", async () => {
  await ensureBusinessGrowthSchema();
  await ensureReferralSchema();
  const phoneDigits = [...suffix].map((character) => character.charCodeAt(0) % 10).join("").slice(0, 8);
  const phone = `+3816${phoneDigits}`;
  const [verified, unverified] = await db.insert(usersTable).values([
    {
      firstName: "Referral", lastName: "Verified", email: `ref-sms-v-${suffix}@example.test`,
      passwordHash: "test-only", phone, phoneNormalized: phone,
    },
    {
      firstName: "Referral", lastName: "Unverified", email: `ref-sms-u-${suffix}@example.test`,
      passwordHash: "test-only", phone: `${phone}1`, phoneNormalized: `${phone}1`,
    },
  ]).returning();
  const [proof] = await db.insert(phoneVerificationProofsTable).values({
    userId: verified!.id,
    phoneNormalized: phone,
  }).returning();
  const [salon] = await db.insert(salonsTable).values({
    ownerId: verified!.id,
    name: `Referral SMS ${suffix}`,
    slug: `referral-sms-${suffix}`,
    city: "Beograd",
    municipality: "Vračar",
    address: "Test 1",
    phone,
    email: `ref-sms-salon-${suffix}@example.test`,
    shortDescription: "Referral SMS test.",
    description: "Referral SMS durable outbox test.",
    imageUrl: "/test.jpg",
  }).returning();
  const [optedOut] = await db.insert(salonCustomersTable).values({
    salonId: salon!.id,
    firstName: "Opted",
    lastName: "Out",
    phone,
    phoneNormalized: phone,
    smsOptOut: true,
  }).returning();

  try {
    const inserted = await db.transaction((tx) => enqueueReferralSmsInTx(tx, {
      eventKey: eventKeys[0]!,
      userId: verified!.id,
      text: "Verified referral message",
    }));
    assert.ok(inserted, "verified current phone is queued");
    assert.equal(inserted.recipientPhone, phone, "the exact normalized verified phone is persisted");
    assert.equal(inserted.messageType, "referral");
    assert.equal(inserted.status, "queued");

    const duplicate = await db.transaction((tx) => enqueueReferralSmsInTx(tx, {
      eventKey: eventKeys[0]!,
      userId: verified!.id,
      text: "Must not replace original",
    }));
    assert.equal(duplicate, null, "duplicate event key is ignored");
    const duplicateRows = await db.select().from(smsDeliveriesTable)
      .where(eq(smsDeliveriesTable.eventKey, eventKeys[0]!));
    assert.equal(duplicateRows.length, 1);
    assert.equal(duplicateRows[0]!.body, "Verified referral message");

    const noProof = await db.transaction((tx) => enqueueReferralSmsInTx(tx, {
      eventKey: eventKeys[1]!,
      userId: unverified!.id,
      text: "Unverified",
    }));
    assert.equal(noProof, null, "unverified phone is not queued");

    await db.update(phoneVerificationProofsTable).set({
      revokedAt: new Date(),
      revocationReason: "test",
    }).where(eq(phoneVerificationProofsTable.id, proof!.id));
    const revoked = await db.transaction((tx) => enqueueReferralSmsInTx(tx, {
      eventKey: eventKeys[2]!,
      userId: verified!.id,
      text: "Revoked",
    }));
    assert.equal(revoked, null, "revoked proof is not queued");
    await db.update(phoneVerificationProofsTable).set({
      revokedAt: null,
      revocationReason: null,
    }).where(eq(phoneVerificationProofsTable.id, proof!.id));

    const optOut = await db.transaction((tx) => enqueueReferralSmsInTx(tx, {
      eventKey: eventKeys[3]!,
      userId: verified!.id,
      salonId: salon!.id,
      salonCustomerId: optedOut!.id,
      text: "Opted out",
    }));
    assert.equal(optOut, null, "relationship-scoped CRM opt-out prevents queueing");

    let sends = 0;
    const retryProvider: SmsProvider = {
      lookupByMessageId: async () => ({ accepted: false }),
      send: async () => {
        sends += 1;
        if (sends === 1) throw new Error("transient provider error");
        return { messageId: "retry-success" };
      },
    };
    const first = await sendSms({
      eventKey: eventKeys[4]!, salonId: null, appointmentId: null, type: "referral",
      phone, text: "Retry referral message",
    }, retryProvider);
    assert.deepEqual(first, { failed: true });
    const second = await sendSms({
      eventKey: eventKeys[4]!, salonId: null, appointmentId: null, type: "referral",
      phone, text: "Retry referral message",
    }, retryProvider);
    assert.deepEqual(second, { messageId: "retry-success" });
    assert.equal(sends, 2, "failed row is reclaimed and sent once on retry");
  } finally {
    await db.delete(smsDeliveriesTable).where(inArray(smsDeliveriesTable.eventKey, eventKeys));
    await db.delete(salonCustomersTable).where(eq(salonCustomersTable.id, optedOut!.id));
    await db.delete(salonsTable).where(eq(salonsTable.id, salon!.id));
    await db.delete(phoneVerificationProofsTable).where(inArray(
      phoneVerificationProofsTable.userId,
      [verified!.id, unverified!.id],
    ));
    await db.delete(usersTable).where(inArray(usersTable.id, [verified!.id, unverified!.id]));
  }
});

test.after(async () => {
  await pool.end();
});