import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, emailDeliveriesTable, pool } from "@workspace/db";
import {
  enqueueTransactionalEmails,
  retryFailedRetryableEmails,
  type TransactionalEmailTransport,
} from "./brevo";

const suffix = randomUUID();
const types = [
  "appointment_created",
  "appointment_updated",
  "appointment_cancelled",
  "appointment_reminder",
];
const eventKeys = types.map((type) => `test-appointment-outbox:${type}:${suffix}`);

try {
  const now = new Date();
  await enqueueTransactionalEmails(db, types.map((emailType, index) => ({
    eventKey: eventKeys[index]!,
    emailType,
    to: { email: `appointment-${emailType}-${suffix}@example.test` },
    subject: `Test ${emailType}`,
    htmlContent: `<p>${emailType}</p>`,
    scheduledAt: now,
    metadata: { test: "appointment-email-outbox" },
  })));

  let calls = 0;
  const transport: TransactionalEmailTransport = {
    async send() {
      calls += 1;
      return { messageId: `test-${calls}` };
    },
  };
  const result = await retryFailedRetryableEmails(new Date(now.getTime() + 1), transport);
  assert.ok(result.retried >= types.length);

  const rows = await db.select().from(emailDeliveriesTable)
    .where(inArray(emailDeliveriesTable.eventKey, eventKeys));
  assert.equal(rows.length, types.length);
  assert.ok(rows.every((row) => row.status === "sent"));
  assert.equal(calls, types.length);
  console.log("Transactional appointment email outbox regression passed.");
} finally {
  await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.eventKey, eventKeys));
  await pool.end();
}