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
 *   6. Rotating the source IP against one fixed account does not evade the
 *      per-account limiter -- credential stuffing from a botnet is still
 *      bounded.
 *   7. Rate limiting applies identically to a privileged (ADMIN) account,
 *      not just ordinary customers.
 *   8. The fixed window actually recovers once it elapses, so a block is a
 *      bounded throttle, never a permanent lockout.
 *   9. With trust proxy at its real, non-Replit-deployment default (the
 *      same default app.ts applies whenever REPLIT_DEPLOYMENT is unset),
 *      an attacker cannot evade the per-IP limiter by sending a different
 *      spoofed X-Forwarded-For value on every request.
 *
 * Run:
 *   NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test \
 *     ../artifacts/api-server/src/lib/login-rate-limit.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { db, usersTable, customerPasswordSetupRateLimitsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import { hashPassword } from "./auth";

// Mirrors marketplace.ts's private customerSetupDigest()/admitRateLimitedAction()
// key derivation (sha256 of "<action>:<identity>") so this test can reach into
// the shared rate-limit table for the same row the route itself would touch,
// without widening that module's exports just for tests.
function loginRateLimitKeyHash(action: "login-account" | "login-ip", identity: string): string {
  return createHash("sha256").update(`${action}:${identity}`).digest("hex");
}

async function rewindRateLimitWindow(action: "login-account" | "login-ip", identity: string, msAgo: number) {
  const keyHash = loginRateLimitKeyHash(action, identity);
  await db.update(customerPasswordSetupRateLimitsTable)
    .set({ windowStartedAt: new Date(Date.now() - msAgo) })
    .where(and(
      eq(customerPasswordSetupRateLimitsTable.keyHash, keyHash),
      eq(customerPasswordSetupRateLimitsTable.action, action),
    ));
}

const suffix = randomUUID().slice(0, 8);
const createdEmails: string[] = [];
const usedIps = new Set<string>();
const KNOWN_PASSWORD = "correct horse battery staple";

// Two full bytes decoded from the random per-run suffix give a run-unique
// 10.x.y.* /24 (65536 possible prefixes), unlike suffix.charCodeAt(0) (only
// 16 possible values), so back-to-back runs of this file cannot collide on
// a shared IP-keyed rate-limit bucket. Each test below picks its own fixed,
// non-overlapping host-octet range so scenarios stay isolated within one run.
const runOctetA = Number.parseInt(suffix.slice(0, 2), 16);
const runOctetB = Number.parseInt(suffix.slice(2, 4), 16);
function testIp(hostOctet: number): string {
  return `10.${runOctetA}.${runOctetB}.${hostOctet}`;
}

// Every synthetic IP in this file is unique per run (it embeds `suffix`),
// except the real loopback address used in the trust-proxy-disabled phase
// below, which is the same on every run. Without this cleanup, that shared
// "login-ip:127.0.0.1" bucket would still be within its window on the next
// test run and fail attempt 1 immediately -- not a product bug, just
// cross-run test-state leakage, since the rate-limit table (deliberately,
// like admitCustomerSetupRequest's) has no per-test-run isolation of its own.
async function cleanupRateLimitRows(): Promise<void> {
  const keyHashes = [
    ...createdEmails.map((email) => loginRateLimitKeyHash("login-account", email.toLowerCase())),
    ...[...usedIps].map((ip) => loginRateLimitKeyHash("login-ip", ip)),
  ];
  if (keyHashes.length) {
    await db.delete(customerPasswordSetupRateLimitsTable)
      .where(inArray(customerPasswordSetupRateLimitsTable.keyHash, keyHashes));
  }
}

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
  usedIps.add(ip);
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
  try {
    await runPhases();
  } finally {
    await cleanupRateLimitRows();
    if (createdEmails.length) {
      await db.delete(usersTable).where(inArray(usersTable.email, createdEmails));
    }
  }
}

async function runPhases(): Promise<void> {
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
      const ip = testIp(1);
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
      const ip = testIp(2);
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
      const ip = testIp(3);
      const email = await createUser("legit-login");
      const result = await login(baseUrl, ip, email, KNOWN_PASSWORD);
      assert.equal(result.status, 200, "a correct-password login under the limit must succeed");
      const setCookie = result.headers.get("set-cookie");
      assert.ok(setCookie?.includes("lumera_session="), "a successful login must issue a session cookie");
    });

    await test("a broad run across many distinct accounts from one source is eventually blocked by the per-IP limit", async () => {
      const ip = testIp(4);
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
      const ip = testIp(5);
      const realEmail = await createUser("enum-real");
      const fakeEmail = `enum-fake-${suffix}-${randomUUID().slice(0, 8)}@example.test`;
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await login(baseUrl, ip, realEmail, "wrong-password");
      }
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await login(`${baseUrl}`, testIp(6), fakeEmail, "wrong-password");
      }
      const realBlocked = await login(baseUrl, ip, realEmail, "wrong-password");
      const fakeBlocked = await login(baseUrl, testIp(6), fakeEmail, "wrong-password");
      assert.equal(realBlocked.status, 429);
      assert.equal(fakeBlocked.status, 429);
      assert.equal(
        realBlocked.body,
        fakeBlocked.body,
        "the 429 body must be identical for an existing vs. a nonexistent account",
      );
    });

    await test("requests against the same account from different source IPs are still bounded by the per-account limit", async () => {
      const email = await createUser("account-cross-ip");
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const ip = testIp(10 + attempt);
        const result = await login(baseUrl, ip, email, "wrong-password");
        assert.equal(
          result.status,
          401,
          `attempt ${attempt} from a fresh source IP should be a normal failed login, not rate-limited yet`,
        );
      }
      const oneMoreIp = testIp(30);
      const blocked = await login(baseUrl, oneMoreIp, email, "wrong-password");
      assert.equal(
        blocked.status,
        429,
        "rotating the source IP on every attempt must not let an attacker exceed one account's login budget",
      );
    });

    await test("rate limiting applies to a privileged (ADMIN) account the same as an ordinary account", async () => {
      const ip = testIp(40);
      const email = await createUser("admin-account", { role: "ADMIN" });
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const result = await login(baseUrl, ip, email, "wrong-password");
        assert.equal(
          result.status,
          401,
          `attempt ${attempt} against an ADMIN account should be a normal failed login, not rate-limited yet`,
        );
      }
      const blocked = await login(baseUrl, ip, email, "wrong-password");
      assert.equal(blocked.status, 429, "an ADMIN account must be rate-limited exactly like any other account");

      const evenWithCorrectPassword = await login(baseUrl, testIp(41), email, KNOWN_PASSWORD);
      assert.equal(
        evenWithCorrectPassword.status,
        429,
        "an exhausted per-account block is not bypassed by supplying the correct password from a different source",
      );
    });

    await test("the per-account window resets and recovers once it elapses, rather than locking the account permanently", async () => {
      const ip = testIp(50);
      const email = await createUser("window-reset");
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        await login(baseUrl, ip, email, "wrong-password");
      }
      const blocked = await login(baseUrl, ip, email, "wrong-password");
      assert.equal(blocked.status, 429, "the account should be blocked once its per-account budget is spent");
      const retryAfter = Number(blocked.headers.get("retry-after"));
      assert.ok(retryAfter > 0 && retryAfter <= 900, "Retry-After must reflect the remaining portion of the 15-minute window");

      // Simulate the 15-minute window having fully elapsed, without a real
      // wait, by rewinding the stored window start past the window length.
      await rewindRateLimitWindow("login-account", email.toLowerCase(), 16 * 60 * 1000);

      const recovered = await login(baseUrl, ip, email, "wrong-password");
      assert.equal(
        recovered.status,
        401,
        "once the window has elapsed the account must be admitted again (a normal failed login), not still 429 -- " +
          "the block is a bounded throttle, never a permanent lockout",
      );
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  // Phase 2: restore trust proxy to its real, non-Replit-deployment default.
  // app.ts only trusts one forwarded-for hop when REPLIT_DEPLOYMENT is set;
  // every other environment (including this test process) leaves it at
  // `false`, so req.ip must always be the raw socket peer address there,
  // completely ignoring any client-supplied X-Forwarded-For. This proves the
  // per-IP limiter cannot be evaded by an attacker who sends a different
  // spoofed X-Forwarded-For value on every request when there is no trusted
  // edge proxy in front of the app to have produced that header honestly.
  app.set("trust proxy", false);
  const spoofServer = app.listen(0, "127.0.0.1");
  await once(spoofServer, "listening");
  const spoofBaseUrl = `http://127.0.0.1:${(spoofServer.address() as AddressInfo).port}`;
  // With trust proxy disabled, every request's real identity is the raw
  // loopback peer address regardless of the X-Forwarded-For values passed to
  // login() below, so track it explicitly for cleanup.
  usedIps.add("127.0.0.1");

  try {
    await test(
      "without a trusted proxy in front of it, a spoofed X-Forwarded-For cannot be used to evade the per-IP limit",
      async () => {
        for (let account = 1; account <= 30; account += 1) {
          const email = await createUser(`spoof-${account}`);
          const claimedIp = `203.0.113.${account}`;
          const result = await login(spoofBaseUrl, claimedIp, email, "wrong-password");
          assert.equal(result.status, 401, `account ${account}'s first attempt must not be rate-limited yet`);
        }
        const oneMoreAccount = await createUser("spoof-31");
        const blocked = await login(spoofBaseUrl, "203.0.113.31", oneMoreAccount, "wrong-password");
        assert.equal(
          blocked.status,
          429,
          "with trust proxy disabled, every request actually arrives from the same real loopback address " +
            "regardless of the claimed X-Forwarded-For, so the shared per-IP budget must still be enforced",
        );
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      spoofServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
