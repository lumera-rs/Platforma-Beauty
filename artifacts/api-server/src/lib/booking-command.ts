import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { bookingCommandReceiptsTable, db } from "@workspace/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const IDEMPOTENCY_MISMATCH_BODY = {
  code: "IDEMPOTENCY_KEY_REUSED",
  error: "Idempotency-Key je već upotrebljen za drugačiji zahtev.",
} as const;

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Booking command payload contains a non-finite number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().flatMap((key) =>
      source[key] === undefined ? [] : [[key, canonicalValue(source[key])]]));
  }
  throw new Error("Booking command payload is not JSON-compatible.");
}

export function canonicalBookingPayload(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function bookingPayloadFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalBookingPayload(value)).digest("hex");
}

export function bookingIdempotencyKey(req: Request, res: Response): string | null {
  const raw = req.get("Idempotency-Key");
  if (!raw || raw.length > 200 || !/^[\x21-\x7e]+$/.test(raw)) {
    res.status(400).json({
      code: "IDEMPOTENCY_KEY_REQUIRED",
      error: "Pošaljite važeći Idempotency-Key za zahtev zakazivanja.",
    });
    return null;
  }
  return raw;
}

export type BookingCommandScope = {
  salonId: string;
  actorType: "user" | "widget_guest";
  actorId: string;
  idempotencyKey: string;
  commandType: string;
  payload: unknown;
};

export type BookingCommandResult<T = unknown> = {
  status: number;
  body: T;
  replayed: boolean;
};

/**
 * Serializes one scoped key, replays a terminal receipt, or runs mutation and
 * receipt insertion in the same database transaction.
 */
export async function executeBookingCommand(
  scope: BookingCommandScope,
  mutate: (tx: Transaction) => Promise<{ status: number; body: unknown }>,
): Promise<BookingCommandResult> {
  const fingerprint = bookingPayloadFingerprint(scope.payload);
  const lockScope = [
    scope.salonId, scope.actorType, scope.actorId, scope.idempotencyKey,
  ].join("\u001f");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockScope}, 0))`);
    const [existing] = await tx.select().from(bookingCommandReceiptsTable).where(and(
      eq(bookingCommandReceiptsTable.salonId, scope.salonId),
      eq(bookingCommandReceiptsTable.actorType, scope.actorType),
      eq(bookingCommandReceiptsTable.actorId, scope.actorId),
      eq(bookingCommandReceiptsTable.idempotencyKey, scope.idempotencyKey),
    )).limit(1);
    if (existing) {
      if (existing.payloadFingerprint !== fingerprint || existing.commandType !== scope.commandType) {
        return { status: 409, body: IDEMPOTENCY_MISMATCH_BODY, replayed: false };
      }
      return {
        status: existing.responseStatus,
        body: existing.responseBody,
        replayed: true,
      };
    }
    const result = await mutate(tx);
    if (result.status < 200 || result.status >= 300) return { ...result, replayed: false };
    await tx.insert(bookingCommandReceiptsTable).values({
      salonId: scope.salonId,
      actorType: scope.actorType,
      actorId: scope.actorId,
      idempotencyKey: scope.idempotencyKey,
      commandType: scope.commandType,
      payloadFingerprint: fingerprint,
      responseStatus: result.status,
      responseBody: result.body,
    });
    return { ...result, replayed: false };
  });
}

export function sendBookingCommandResult(res: Response, result: BookingCommandResult): void {
  if (result.replayed) res.setHeader("Idempotency-Replayed", "true");
  res.status(result.status).json(result.body);
}

export async function findAuthenticatedBookingCommand(input: {
  actorId: string;
  salonId: string;
  idempotencyKey: string;
}) {
  const [receipt] = await db.select().from(bookingCommandReceiptsTable).where(and(
    eq(bookingCommandReceiptsTable.salonId, input.salonId),
    eq(bookingCommandReceiptsTable.actorType, "user"),
    eq(bookingCommandReceiptsTable.actorId, input.actorId),
    eq(bookingCommandReceiptsTable.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  return receipt ?? null;
}