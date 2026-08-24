import { and, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  BEAUTY_JOB_EMAIL_TYPES,
  deliverQueuedTransactionalEmail,
  enqueueTransactionalEmail,
  lumeraEmailHtml,
  type TransactionalEmailTransport,
} from "./brevo";

type BeautyJobEmailType = typeof BEAUTY_JOB_EMAIL_TYPES[number];
type BeautyJobTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
let transportOverrideForTests: TransactionalEmailTransport | undefined;

export type BeautyJobEmailInput = {
  eventKey: string;
  emailType: BeautyJobEmailType;
  recipientUserId: string;
  subject: string;
  title: string;
  content: string;
  listingId?: string;
  contactId?: string;
  metadata?: Record<string, unknown>;
};

export function setBeautyJobEmailTransportForTests(transport?: TransactionalEmailTransport) {
  transportOverrideForTests = transport;
}

function emailSafe(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

/**
 * Beauty Poslovi messages are transactional. The marketing preference is
 * intentionally not consulted here: a user who opts out of campaigns must
 * still receive a contact, reply, moderation, or expiry notification.
 */
export async function enqueueBeautyJobEmail(
  tx: BeautyJobTransaction,
  input: BeautyJobEmailInput,
) {
  const [recipient] = await tx.select({
    id: usersTable.id,
    email: usersTable.email,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    active: usersTable.active,
  }).from(usersTable).where(and(
    eq(usersTable.id, input.recipientUserId),
    eq(usersTable.active, true),
  )).limit(1);

  if (!recipient) return { skipped: true as const, reason: "recipient_inactive_or_missing" };

  await enqueueTransactionalEmail(tx, {
    eventKey: input.eventKey,
    emailType: input.emailType,
    to: {
      email: recipient.email,
      name: `${recipient.firstName} ${recipient.lastName}`.trim(),
    },
    subject: `LUMERA Beauty Poslovi — ${input.subject}`,
    htmlContent: lumeraEmailHtml(
      emailSafe(input.title),
      `<p>${emailSafe(input.content)}</p>`,
    ),
    metadata: {
      ...(input.metadata ?? {}),
      recipientUserId: recipient.id,
      ...(input.contactId ? { contactId: input.contactId } : {}),
      ...(input.listingId ? { listingId: input.listingId } : {}),
    },
  });
  return { enqueued: true as const };
}

export async function deliverBeautyJobEmail(
  eventKey: string,
  transport?: TransactionalEmailTransport,
) {
  return deliverQueuedTransactionalEmail(eventKey, transport ?? transportOverrideForTests);
}

export async function sendBeautyJobEmail(
  input: BeautyJobEmailInput,
  transport?: TransactionalEmailTransport,
) {
  const result = await db.transaction((tx) => enqueueBeautyJobEmail(tx, input));
  if ("skipped" in result) return result;
  return deliverBeautyJobEmail(input.eventKey, transport);
}