/**
 * Regression coverage for the HIGH finding: POST /auth/login had no
 * brute-force protection at all, letting an attacker attempt unlimited
 * password guesses against any account (or spray guesses across many
 * accounts from one source) with no throttle, lockout, or delay.
 *
 * marketplace.ts's admitLoginAttempt() now requires BOTH a per-account and
 * a per-IP fixed-window admission before the password is even checked,
 * reusing the same durable, advisory-lock-protected rate-limit table and
 * pattern already proven by admitCustomerSetupRequest for the password-setup
 * flow. This file verifies, against a real running Express app instance and
 * real HTTP requests:
 *
 *   1. A targeted run against one account is blocked once it exceeds the
 *      per-account limit, with a 429 + Retry-After response.
 *   2. That block does not affect a different account (per-account
 *      isolation) -- a credential-stuffing run against account A cannot
 *      lock out account B.
 *   3. A legitimate login with the correct password still succeeds while
 *      under the limit.
 *   4. A broad run across many distinct accounts from one source is
 *      eventually blocked by the per-IP limit, even though no single
 *      account ever approached its own per-account limit -- this is what
 *      stops a password-spray / credential-stuffing list.
 *   5. The 429 response is identical in shape/message whether the targeted
 *      account exists or not, so the rate limiter itself creates no
 *      account-enumeration side channel.
 *
 * Run:
 *   NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test \
 *     ../artifacts/api-server/src/lib/login-rate-limit.test.ts
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

async function createUser(emailPrefix: string, overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const email = `${emailPrefix}-${suffix}-${randomUUID().slice(0, 8)}@example.test`;
  createdEmails.push(email);
  await db.insert(usersTable).values({
    firstName: "Rate",
    lastName: "Limit",
    email,
    passwordHash: await hashPassword(KNOWN_PASSWORD),
    passwordSetAt: new Date(),
    role: "CUSTOMER",
    ...overrides,
  });
  return email;
}

type LoginResult = { status: number; body: string; headers: Headers };

async function login(baseUrl: string, ip: string, email: string, password: string): Promise<LoginResult> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

async function run(): Promise<void> {
  // Mirrors the same in-process testing technique already used by
  // social-oauth-domain-change.test.ts: enable trust proxy on this test
  // process's own app instance only, so each scenario below can use a
  // distinct synthetic source IP via X-Forwarded-For and stay fully
  // isolated from the others, without touching app.ts.
  app.set("trust proxy", true);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    await test("a targeted run against one account is blocked past the per-account limit", async () => {
      const ip = `10.1.${suffix.charCodeAt(0)}.1`;
      const email = await createUser("account-block");
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const result = await login(baseUrl, ip, email, "wrong-password");
        assert.equal(result.status, 401, `attempt ${attempt} should be a normal failed login, not rate-limited yet`);
      }
      const blocked = await login(baseUrl, ip, email, "wrong-password");
      assert.equal(blocked.status, 429, "the 11th attempt against one account must be rate-limited");
      assert.ok(blocked.headers.get("retry-after"), "a 429 login response must advertise Retry-After");
    });

    await test("blocking one account's login attempts does not block a different account", async () => {
      const ip = `10.1.${suffix.charCodeAt(0)}.2`;
      const exhaustedEmail = await createUser("account-isolation-a");
      const otherEmail = await createUser("account-isolation-b");
      for (let attempt = 1; attempt <= 11; attempt += 1) {
        await login(baseUrl, ip, exhaustedEmail, "wrong-password");
      }
      const stillExhausted = await login(baseUrl, ip, exhaustedEmail, "wrong-password");
      assert.equal(stillExhausted.status, 429, "the first account should remain rate-limited");

      const otherAccountAttempt = await login(baseUrl, ip, otherEmail, "wrong-password");
      assert.equal(
        otherAccountAttempt.status,
        401,
        "a different account must not be rate-limited by another account's exhausted attempts",
      );
    });

    await test("a legitimate login with the correct password still succeeds while under the limit", async () => {
      const ip = `10.1.${suffix.charCodeAt(0)}.3`;
      const email = await createUser("legit-login");
      const result = await login(baseUrl, ip, email, KNOWN_PASSWORD);
      assert.equal(result.status, 200, "a correct-password login under the limit must succeed");
      const setCookie = result.headers.get("set-cookie");
      assert.ok(setCookie?.includes("lumera_session="), "a successful login must issue a session cookie");
    });

    await test("a broad run across many distinct accounts from one source is eventually blocked by the per-IP limit", async () => {
      const ip = `10.1.${suffix.charCodeAt(0)}.4`;
      // 30 distinct accounts, one attempt each: every individual account
      // stays far under its own per-account limit (10), but all 30 share
      // the same source IP's budget (30).
      for (let account = 1; account <= 30; account += 1) {
        const email = await createUser(`ip-spray-${account}`);
        const result = await login(baseUrl, ip, email, "wrong-password");
        assert.equal(result.status, 401, `account ${account} (its own first attempt) must not be rate-limited yet`);
      }
      const oneMoreDistinctAccount = await createUser("ip-spray-31");
      const blockedByIp = await login(baseUrl, ip, oneMoreDistinctAccount, "wrong-password");
      assert.equal(
        blockedByIp.status,
        429,
        "a 31st distinct account's very first attempt must still be blocked once the shared source IP's budget is spent",
      );
    });

    await test("the rate-limit response does not reveal whether the account exists", async () => {
      const ip = `10.1.${suffix.charCodeAt(0)}.5`;
      const realEmail = await createUser("enum-real");
      const fakeEmail = `enum-fake-${suffix}-${randomUUID().slice(0, 8)}@example.test`;
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await login(baseUrl, ip, realEmail, "wrong-password");
      }
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await login(`${baseUrl}`, `10.1.${suffix.charCodeAt(0)}.6`, fakeEmail, "wrong-password");
      }
      const realBlocked = await login(baseUrl, ip, realEmail, "wrong-password");
      const fakeBlocked = await login(baseUrl, `10.1.${suffix.charCodeAt(0)}.6`, fakeEmail, "wrong-password");
      assert.equal(realBlocked.status, 429);
      assert.equal(fakeBlocked.status, 429);
      assert.equal(
        realBlocked.body,
        fakeBlocked.body,
        "the 429 body must be identical for an existing vs. a nonexistent account",
      );
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (createdEmails.length) {
      await db.delete(usersTable).where(inArray(usersTable.email, createdEmails));
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
