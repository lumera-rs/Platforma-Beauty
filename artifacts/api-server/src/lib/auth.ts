import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "lumera_session";

export const sessionCookieName = SESSION_COOKIE;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expected] = storedHash.split(":");
  if (!salt || !expected) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.insert(sessionsTable).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
  });
  return token;
}

export async function getCurrentUser(req: Request) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string") return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [session] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(and(
      eq(sessionsTable.tokenHash, tokenHash),
      gt(sessionsTable.expiresAt, new Date()),
      eq(usersTable.active, true),
    ))
    .limit(1);
  return session?.user ?? null;
}

export async function destroySession(req: Request): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string") return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, tokenHash));
}

export function publicUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    marketingEmailsEnabled: user.marketingEmailsEnabled,
  };
}

export function isAdmin(user: typeof usersTable.$inferSelect): boolean {
  return user.role === "ADMIN" || user.role === "SUPER_ADMIN";
}