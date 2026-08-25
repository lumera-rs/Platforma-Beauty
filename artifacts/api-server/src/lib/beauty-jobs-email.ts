import { and, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  BEAUTY_JOB_EMAIL_TYPES,
  deliverQueuedTransactionalEmail,
  enqueueTransactionalEmail,
  lumeraEmailHtml,
  retryBeautyJobEmailDelivery as retryTransactionalBeautyJobEmailDelivery,
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

function configuredAppBaseUrl() {
  const configured = process.env["APP_BASE_URL"]?.trim().replace(/\/+$/, "");
  if (!configured) {
    throw new Error("APP_BASE_URL mora biti podešen pre slanja Beauty Poslovi mejla.");
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("APP_BASE_URL nije validan apsolutni URL za Beauty Poslovi mejlove.");
  }
  if (!["http:", "https:"].includes(url.protocol)
    || (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new Error("APP_BASE_URL nije bezbedan osnovni URL za Beauty Poslovi mejlove.");
  }
  return url.toString().replace(/\/+$/, "");
}

function beautyJobsDestination(
  emailType: BeautyJobEmailType,
  role: string,
  listingId?: string,
  contactId?: string,
) {
  const dashboard = role === "CUSTOMER" || role === "STUDENT"
    ? "/moji-oglasi"
    : "/biznis/poslovi";
  if ((emailType === "beauty_job_new_contact" || emailType === "beauty_job_author_reply") && contactId) {
    return {
      path: `${dashboard}?tab=inbox&contactId=${encodeURIComponent(contactId)}`,
      label: emailType === "beauty_job_new_contact" ? "Otvori kontakt" : "Otvori odgovor",
    };
  }
  if ((emailType === "beauty_job_moderation" || emailType === "beauty_job_expiry_warning") && listingId) {
    return {
      path: `${dashboard}?tab=my-jobs&listingId=${encodeURIComponent(listingId)}`,
      label: emailType === "beauty_job_expiry_warning" ? "Upravljaj oglasom" : "Otvori oglas",
    };
  }
  return null;
}

function beautyJobsCallToAction(
  emailType: BeautyJobEmailType,
  role: string,
  listingId?: string,
  contactId?: string,
) {
  const destination = beautyJobsDestination(emailType, role, listingId, contactId);
  const baseUrl = configuredAppBaseUrl();
  if (!destination) throw new Error(`Beauty Poslovi mejl ${emailType} nema validan ciljni resurs.`);
  return `<p style="margin:28px 0 0"><a href="${emailSafe(`${baseUrl}${destination.path}`)}" style="display:inline-block;background:#302a23;color:#e1bd6b;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:700">${emailSafe(destination.label)}</a></p>`;
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
    role: usersTable.role,
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
      `<p>${emailSafe(input.content)}</p>${beautyJobsCallToAction(input.emailType, recipient.role, input.listingId, input.contactId)}`,
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

export async function retryBeautyJobEmailDelivery(deliveryId: string) {
  return retryTransactionalBeautyJobEmailDelivery(
    deliveryId,
    new Date(),
    transportOverrideForTests,
  );
}
