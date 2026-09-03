/**
 * Regression coverage for the MEDIUM finding: POST /auth/change-password
 * updated the user's password but left every existing session (on any
 * device/browser) valid, so a stolen lumera_session cookie -- including an
 * exact copy of the token that authenticated the change-password request
 * itself -- survived the victim changing their password.
 *
 * marketplace.ts's /auth/change-password handler now deletes EVERY session
 * for the user (including the one that authenticated the request) and
 * mints a brand-new replacement session, all inside the same database
 * transaction as the password update -- reusing the sessionsTable
 * delete-by-userId pattern already used by the customer-password-setup
 * "complete" flow and by employee deactivation, and reusing
 * lib/auth.ts's createSession() (now accepting an optional tx executor)
 * rather than inventing a parallel session-creation mechanism. The server
 * has no way to distinguish a legitimate client re-presenting its own
 * bearer token from an attacker who copied that exact token, so the only
 * way to guarantee no pre-change token remains usable is to rotate: no
 * bearer token that existed before the change -- current session included
 * -- survives it. This file verifies, against a real running Express app
 * instance and real HTTP requests:
 *
 *   1. With two active sessions for the same user, changing the password
 *      from session A revokes session A's own (pre-change) token AND
 *      session B, and issues a brand-new replacement token that works.
 *      This directly covers the "attacker copied the current token"
 *      threat: the copy and the original are the same string, so a copy
 *      is indistinguishable from -- and rejected exactly like -- the
 *      real old token.
 *   2. The old password no longer authenticates.
 *   3. The new password authenticates.
 *   4. A wrong current password rotates/revokes no session.
 *   5. An invalid new password (too short) rotates/revokes no session.
 *   6. This holds after the HTTP server restarts, because sessions live in
 *      Postgres, not in process memory.
 *   7. Two concurrent password-change requests from two different sessions
 *      of the same user do not corrupt state: both complete without
 *      error, the account ends up authenticable with exactly one of the
 *      two new passwords, and exactly one of the two newly-issued
 *      replacement tokens remains usable (the other is revoked by the
 *      transaction that committed last) -- old pre-race tokens from
 *      either session are unusable either way.
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
  return { status: response.status, body: await response.text(), headers: response.headers };
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
    await test(
      "changing the password rotates the authenticating session and revokes every other pre-change token, " +
        "including an exact copy of the current token",
      async () => {
        // 1. User logs in and receives session token A.
        const email = await createEmployee("two-sessions");
        const loginA = await login(baseUrl, email, KNOWN_PASSWORD);
        const loginB = await login(baseUrl, email, KNOWN_PASSWORD);
        const cookieA = sessionCookieFrom(loginA.headers);
        const cookieB = sessionCookieFrom(loginB.headers);
        // 2. Simulate an attacker copying token A: a copy is just the same
        // string, so cookieA below stands in for both the victim's own
        // reuse of it and an attacker's copy -- the server cannot tell
        // them apart, which is exactly the property being tested.
        const attackerCopyOfCookieA = cookieA;

        // 3. Victim changes the password while authenticated with token A.
        const newPassword = "brand new password 123";
        const changeResult = await changePassword(baseUrl, cookieA, KNOWN_PASSWORD, newPassword);
        assert.equal(changeResult.status, 200, "a valid password change must succeed");

        // 4. Server issues replacement session token B (named cookieReplacement
        // here to avoid confusion with the pre-existing "session B" above).
        const cookieReplacement = sessionCookieFrom(changeResult.headers);
        assert.notEqual(cookieReplacement, cookieA, "the replacement token must not equal the pre-change token");

        // 5 & 6. The old token A -- and therefore any attacker copy of it,
        // since they are the same string -- must return 401.
        const probeOldA = await probeAuthenticated(baseUrl, cookieA);
        assert.equal(probeOldA, 401, "the pre-change token must be rejected after the password change");
        const probeAttackerCopy = await probeAuthenticated(baseUrl, attackerCopyOfCookieA);
        assert.equal(probeAttackerCopy, 401, "an attacker's exact copy of the pre-change token must be rejected too");

        // 7. Request using the replacement token must succeed.
        const meReplacement = await me(baseUrl, cookieReplacement);
        assert.equal(meReplacement.status, 200);
        assert.ok(
          meReplacement.body.user && (meReplacement.body.user as { email: string }).email === email,
          "the newly issued replacement session must be valid and belong to the same user",
        );

        // 8. All other pre-existing sessions (a different browser/device)
        // must also return 401.
        const probeB = await probeAuthenticated(baseUrl, cookieB);
        assert.equal(probeB, 401, "every other pre-existing session must also be revoked");

        const oldPasswordLogin = await login(baseUrl, email, KNOWN_PASSWORD);
        assert.equal(oldPasswordLogin.status, 401, "the old password must no longer work");

        const newPasswordLogin = await login(baseUrl, email, newPassword);
        assert.equal(newPasswordLogin.status, 200, "the new password must work");
      },
    );

    await test("a wrong current password rotates/revokes no session", async () => {
      const email = await createEmployee("wrong-current");
      const loginA = await login(baseUrl, email, KNOWN_PASSWORD);
      const loginB = await login(baseUrl, email, KNOWN_PASSWORD);
      const cookieA = sessionCookieFrom(loginA.headers);
      const cookieB = sessionCookieFrom(loginB.headers);

      const rejected = await changePassword(baseUrl, cookieA, "totally wrong password", "irrelevant new password");
      assert.equal(rejected.status, 400, "a wrong current password must be rejected");
      assert.equal(rejected.headers.get("set-cookie"), null, "a rejected attempt must not issue a replacement session");

      const meA = await me(baseUrl, cookieA);
      const meB = await me(baseUrl, cookieB);
      assert.equal(meA.status, 200);
      assert.equal(meB.status, 200);
      assert.ok((meA.body.user as { email: string } | null)?.email === email, "session A must remain valid and unrotated");
      assert.ok((meB.body.user as { email: string } | null)?.email === email, "session B must remain valid");
    });

    await test("an invalid new password rotates/revokes no session", async () => {
      const email = await createEmployee("invalid-new");
      const loginA = await login(baseUrl, email, KNOWN_PASSWORD);
      const loginB = await login(baseUrl, email, KNOWN_PASSWORD);
      const cookieA = sessionCookieFrom(loginA.headers);
      const cookieB = sessionCookieFrom(loginB.headers);

      const rejected = await changePassword(baseUrl, cookieA, KNOWN_PASSWORD, "short");
      assert.equal(rejected.status, 400, "a too-short new password must be rejected");
      assert.equal(rejected.headers.get("set-cookie"), null, "a rejected attempt must not issue a replacement session");

      const meA = await me(baseUrl, cookieA);
      const meB = await me(baseUrl, cookieB);
      assert.ok((meA.body.user as { email: string } | null)?.email === email, "session A must remain valid and unrotated");
      assert.ok((meB.body.user as { email: string } | null)?.email === email, "session B must remain valid");
    });

    await test(
      "two concurrent password-change requests from different sessions leave the account in a consistent, " +
        "single-session state (rather than both succeeding)",
      async () => {
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
          "both racing requests authenticated with the correct (pre-race) current password must complete " +
            "successfully at the HTTP layer, not error out",
        );

        // The pre-race tokens (A and B) must be dead either way: each
        // transaction deletes every session for the user, including the
        // one that authenticated it, before minting its own replacement.
        const probeOldA = await probeAuthenticated(baseUrl, cookieA);
        const probeOldB = await probeAuthenticated(baseUrl, cookieB);
        assert.equal(probeOldA, 401, "the pre-race token from session A must not remain valid");
        assert.equal(probeOldB, 401, "the pre-race token from session B must not remain valid");

        // Exactly one candidate password must now work -- whichever
        // transaction committed last determines the final password.
        const [loginWithA, loginWithB] = await Promise.all([
          login(baseUrl, email, candidatePasswordA),
          login(baseUrl, email, candidatePasswordB),
        ]);
        const passwordSuccesses = [loginWithA.status === 200, loginWithB.status === 200].filter(Boolean).length;
        assert.equal(
          passwordSuccesses,
          1,
          "exactly one of the two racing password updates must have won -- the account must not end up " +
            "authenticable with both, or with neither, candidate password",
        );

        // Of the two brand-new replacement tokens the racing requests were
        // each issued, exactly one must still work: whichever transaction
        // committed last deleted every session that existed at that point,
        // including the replacement token the other (earlier-committing)
        // request had just minted for itself.
        const replacementA = sessionCookieFrom(resultA.headers);
        const replacementB = sessionCookieFrom(resultB.headers);
        assert.notEqual(replacementA, replacementB, "the two racing requests must not be issued the same token");
        const [meReplacementA, meReplacementB] = await Promise.all([
          me(baseUrl, replacementA),
          me(baseUrl, replacementB),
        ]);
        const sessionSuccesses = [
          Boolean((meReplacementA.body.user as { email: string } | null)?.email === email),
          Boolean((meReplacementB.body.user as { email: string } | null)?.email === email),
        ].filter(Boolean).length;
        assert.equal(
          sessionSuccesses,
          1,
          "exactly one of the two newly-issued replacement sessions must remain valid, matching the single " +
            "surviving password -- the account must never end up with two live sessions after a password change",
        );
      },
    );

    await test("session rotation survives an HTTP server restart because sessions are database-backed", async () => {
      const email = await createEmployee("restart");
      const loginA = await login(baseUrl, email, KNOWN_PASSWORD);
      const loginB = await login(baseUrl, email, KNOWN_PASSWORD);
      const cookieA = sessionCookieFrom(loginA.headers);
      const cookieB = sessionCookieFrom(loginB.headers);

      const newPassword = "restart survives password 456";
      const changeResult = await changePassword(baseUrl, cookieA, KNOWN_PASSWORD, newPassword);
      assert.equal(changeResult.status, 200);
      const cookieReplacement = sessionCookieFrom(changeResult.headers);

      await stopServer(server);
      const restarted = await startServer();
      server = restarted.server;
      baseUrl = restarted.baseUrl;

      const probeOldA = await probeAuthenticated(baseUrl, cookieA);
      const probeB = await probeAuthenticated(baseUrl, cookieB);
      assert.equal(probeOldA, 401, "the rotated-away pre-change token must still be rejected after a server restart");
      assert.equal(probeB, 401, "the revoked session must still be rejected after the server process restarts");

      const meReplacement = await me(baseUrl, cookieReplacement);
      assert.ok(
        (meReplacement.body.user as { email: string } | null)?.email === email,
        "the replacement session must still be valid after the server process restarts",
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
