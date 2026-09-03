/**
 * Regression coverage for the MEDIUM finding: POST /auth/change-password
 * updated the user's password but left every existing session (on any
 * device/browser) valid, so a stolen lumera_session cookie survived the
 * victim changing their password.
 *
 * marketplace.ts's /auth/change-password handler now deletes every session
 * for the user EXCEPT the one the request authenticated with, in the same
 * database transaction as the password update -- reusing the same
 * sessionsTable-delete-by-userId pattern already used by the
 * customer-password-setup "complete" flow and by employee deactivation,
 * rather than inventing a new revocation mechanism. This file verifies,
 * against a real running Express app instance and real HTTP requests:
 *
 *   1. With two active sessions for the same user, changing the password
 *      from session A revokes session B (it can no longer reach an
 *      authenticated endpoint).
 *   2. The old password no longer authenticates.
 *   3. The new password authenticates.
 *   4. Session A -- the one the change was made from -- remains valid
 *      (the chosen policy: preserve the current session, revoke every
 *      other one).
 *   5. A wrong current password revokes no session.
 *   6. An invalid new password (too short) revokes no session.
 *   7. This holds after the HTTP server restarts, because sessions live in
 *      Postgres, not in process memory.
 *   8. Two concurrent password-change requests from two different sessions
 *      of the same user do not corrupt state: both complete without error
 *      and the account ends up authenticable with exactly one of the two
 *      new passwords.
 *
 * Run:
 *   NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test \
 *     ../artifacts/api-server/src/lib/change-password-session-revocation.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import app from "../app";
import { hashPassword } from "./auth";

const suffix = randomUUID().slice(0, 8);
const createdEmails: string[] = [];
const KNOWN_PASSWORD = "correct horse battery staple";

// POST /auth/login now carries its own brute-force rate limiter (a separate
// fix). Route every login() call in this file through a run-unique
// synthetic source IP (two full bytes decoded from the random suffix, as in
// login-rate-limit.test.ts) so this file's logins can never collide with,
// or be starved by, that limiter's shared real-loopback-IP bucket.
const runOctetA = Number.parseInt(suffix.slice(0, 2), 16);
const runOctetB = Number.parseInt(suffix.slice(2, 4), 16);
const SYNTHETIC_SOURCE_IP = `10.${runOctetA}.${runOctetB}.1`;

async function createEmployee(emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}-${suffix}-${randomUUID().slice(0, 8)}@example.test`;
  createdEmails.push(email);
  await db.insert(usersTable).values({
    firstName: "Change",
    lastName: "Password",
    email,
    passwordHash: await hashPassword(KNOWN_PASSWORD),
    passwordSetAt: new Date(),
    mustChangePassword: false,
    role: "SALON_EMPLOYEE",
  });
  return email;
}

function sessionCookieFrom(headers: Headers): string {
  const setCookie = headers.get("set-cookie");
  assert.ok(setCookie, "a successful login must set a session cookie");
  const cookie = setCookie.split(";")[0];
  assert.ok(cookie?.startsWith("lumera_session="), "the session cookie must be lumera_session");
  return cookie;
}

async function login(baseUrl: string, email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": SYNTHETIC_SOURCE_IP },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

async function changePassword(baseUrl: string, cookie: string, currentPassword: string, newPassword: string) {
  const response = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return { status: response.status, body: await response.text() };
}

async function me(baseUrl: string, cookie: string) {
  const response = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
  return { status: response.status, body: (await response.json()) as { user: unknown } };
}

/** Any endpoint requiring auth via current(); 401 here proves the session is dead. */
async function probeAuthenticated(baseUrl: string, cookie: string) {
  const response = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ currentPassword: "irrelevant-probe-value", newPassword: "irrelevant-probe-value" }),
  });
  return response.status;
}

async function startServer() {
  app.set("trust proxy", true);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, baseUrl };
}

async function stopServer(server: ReturnType<typeof app.listen>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function run(): Promise<void> {
  let { server, baseUrl } = await startServer();

  try {
    await test("changing the password from one session revokes every other session for that user", async () => {
      const email = await createEmployee("two-sessions");
      const loginA = await login(baseUrl, email, KNOWN_PASSWORD);
      const loginB = await login(baseUrl, email, KNOWN_PASSWORD);
      const cookieA = sessionCookieFrom(loginA.headers);
      const cookieB = sessionCookieFrom(loginB.headers);

      const newPassword = "brand new password 123";
      const changeResult = await changePassword(baseUrl, cookieA, KNOWN_PASSWORD, newPassword);
      assert.equal(changeResult.status, 200, "a valid password change must succeed");

      const probeB = await probeAuthenticated(baseUrl, cookieB);
      assert.equal(probeB, 401, "session B must no longer be able to reach an authenticated endpoint");

      const oldPasswordLogin = await login(baseUrl, email, KNOWN_PASSWORD);
      assert.equal(oldPasswordLogin.status, 401, "the old password must no longer work");

      const newPasswordLogin = await login(baseUrl, email, newPassword);
      assert.equal(newPasswordLogin.status, 200, "the new password must work");

      const meA = await me(baseUrl, cookieA);
      assert.equal(meA.status, 200);
      assert.ok(
        meA.body.user && (meA.body.user as { email: string }).email === email,
        "session A (the one the change was made from) must remain valid under the chosen preserve-current-session policy",
      );
    });

    await test("a wrong current password revokes no session", async () => {
      const email = await createEmployee("wrong-current");
      const loginA = await login(baseUrl, email, KNOWN_PASSWORD);
      const loginB = await login(baseUrl, email, KNOWN_PASSWORD);
      const cookieA = sessionCookieFrom(loginA.headers);
      const cookieB = sessionCookieFrom(loginB.headers);

      const rejected = await changePassword(baseUrl, cookieA, "totally wrong password", "irrelevant new password");
      assert.equal(rejected.status, 400, "a wrong current password must be rejected");

      const meA = await me(baseUrl, cookieA);
      const meB = await me(baseUrl, cookieB);
      assert.equal(meA.status, 200);
      assert.equal(meB.status, 200);
      assert.ok((meA.body.user as { email: string } | null)?.email === email, "session A must remain valid");
      assert.ok((meB.body.user as { email: string } | null)?.email === email, "session B must remain valid");
    });

    await test("an invalid new password revokes no session", async () => {
      const email = await createEmployee("invalid-new");
      const loginA = await login(baseUrl, email, KNOWN_PASSWORD);
      const loginB = await login(baseUrl, email, KNOWN_PASSWORD);
      const cookieA = sessionCookieFrom(loginA.headers);
      const cookieB = sessionCookieFrom(loginB.headers);

      const rejected = await changePassword(baseUrl, cookieA, KNOWN_PASSWORD, "short");
      assert.equal(rejected.status, 400, "a too-short new password must be rejected");

      const meA = await me(baseUrl, cookieA);
      const meB = await me(baseUrl, cookieB);
      assert.ok((meA.body.user as { email: string } | null)?.email === email, "session A must remain valid");
      assert.ok((meB.body.user as { email: string } | null)?.email === email, "session B must remain valid");
    });

    await test("two concurrent password-change requests from different sessions leave the account in a consistent state", async () => {
      const email = await createEmployee("concurrent");
      const loginA = await login(baseUrl, email, KNOWN_PASSWORD);
      const loginB = await login(baseUrl, email, KNOWN_PASSWORD);
      const cookieA = sessionCookieFrom(loginA.headers);
      const cookieB = sessionCookieFrom(loginB.headers);

      const candidatePasswordA = "concurrent password from session a";
      const candidatePasswordB = "concurrent password from session b";
      const [resultA, resultB] = await Promise.all([
        changePassword(baseUrl, cookieA, KNOWN_PASSWORD, candidatePasswordA),
        changePassword(baseUrl, cookieB, KNOWN_PASSWORD, candidatePasswordB),
      ]);
      assert.ok(
        resultA.status === 200 && resultB.status === 200,
        "both racing requests authenticated with the correct current password must complete successfully, not error out",
      );

      const [loginWithA, loginWithB] = await Promise.all([
        login(baseUrl, email, candidatePasswordA),
        login(baseUrl, email, candidatePasswordB),
      ]);
      const successes = [loginWithA.status === 200, loginWithB.status === 200].filter(Boolean).length;
      assert.equal(
        successes,
        1,
        "exactly one of the two racing password updates must have won -- the account must not end up " +
          "authenticable with both, or with neither, candidate password",
      );
    });

    await test("session revocation survives an HTTP server restart because sessions are database-backed", async () => {
      const email = await createEmployee("restart");
      const loginA = await login(baseUrl, email, KNOWN_PASSWORD);
      const loginB = await login(baseUrl, email, KNOWN_PASSWORD);
      const cookieA = sessionCookieFrom(loginA.headers);
      const cookieB = sessionCookieFrom(loginB.headers);

      const newPassword = "restart survives password 456";
      const changeResult = await changePassword(baseUrl, cookieA, KNOWN_PASSWORD, newPassword);
      assert.equal(changeResult.status, 200);

      await stopServer(server);
      const restarted = await startServer();
      server = restarted.server;
      baseUrl = restarted.baseUrl;

      const probeB = await probeAuthenticated(baseUrl, cookieB);
      assert.equal(probeB, 401, "the revoked session must still be rejected after the server process restarts");

      const meA = await me(baseUrl, cookieA);
      assert.ok(
        (meA.body.user as { email: string } | null)?.email === email,
        "the preserved session must still be valid after the server process restarts",
      );
    });
  } finally {
    await stopServer(server);
    if (createdEmails.length) {
      await db.delete(usersTable).where(inArray(usersTable.email, createdEmails));
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
