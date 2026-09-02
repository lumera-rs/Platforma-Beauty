import { customerNotificationsTable } from "@workspace/db";

export type CustomerNotificationCategory =
  | "booking"
  | "cancellation"
  | "reminder"
  | "review"
  | "loyalty"
  | "commerce"
  | "education"
  | "system";

type NotificationWriter = {
  insert: (table: typeof customerNotificationsTable) => any;
};

function safeDeepLink(value: string | null | undefined) {
  if (!value) return null;
  if (value.length > 2_000 || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const origin = "https://customer-notification.invalid";
    const parsed = new URL(value, origin);
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
  } catch {
    return null;
  }
}

function safeMetadataValue(value: unknown, depth = 0): unknown {
  if (depth > 5 || value == null || typeof value === "string" && value.length > 2_000) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeMetadataValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50)
      .map(([key, item]) => [key.slice(0, 100), safeMetadataValue(item, depth + 1)]));
  }
  return null;
}

/**
 * The sole producer for the product-wide customer inbox. Call it inside the
 * domain transaction whenever possible. eventKey is a durable projection key,
 * so retries and concurrent workers collapse into the original row.
 */
export async function notifyCustomer(
  writer: NotificationWriter,
  input: {
    userId: string | null | undefined;
    eventKey: string;
    category: CustomerNotificationCategory;
    title: string;
    body: string;
    deepLink?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  if (!input.userId) return null;
  const eventKey = input.eventKey.trim();
  if (!eventKey || eventKey.length > 500) throw new RangeError("Customer notification eventKey is invalid.");
  const [inserted] = await writer.insert(customerNotificationsTable).values({
    userId: input.userId,
    eventKey,
    category: input.category,
    title: input.title.slice(0, 500),
    body: input.body.slice(0, 4_000),
    deepLink: safeDeepLink(input.deepLink),
    metadata: safeMetadataValue(input.metadata ?? {}) as Record<string, unknown>,
  }).onConflictDoNothing().returning();
  return inserted ?? null;
}