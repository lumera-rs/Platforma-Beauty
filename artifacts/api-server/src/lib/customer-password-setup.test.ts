import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import {
  customerPasswordSetupAuditsTable,
  customerPasswordSetupTokensTable,
  db,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";

type CreatedSetup = {
  user: { id: string; role: string; email: string };
  setupUrl: string;
  expiresAt: string;
};

async function run(): Promise<void> {
  await ensureBusinessGrowthSchema();
  const suffix = randomUUID();
  const administratorPassword = randomBytes(24).toString("base64url");
  const customerPassword = randomBytes(24).toString("base64url");
  const createdUserIds: string[] = [];
  const actors = await db.insert(usersTable).values([
    {
      firstName: "Setup",
      lastName: "Superadmin",
      email: `setup-superadmin-${suffix}@example.test`,
      passwordHash: await hashPassword(administratorPassword),
      passwordSetAt: new Date(),
      role: "SUPER_ADMIN",
    },
    {
      firstName: "Setup",
      lastName: "Admin",
      email: `setup-admin-${suffix}@example.test`,
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      passwordSetAt: new Date(),
      role: "ADMIN",
    },
    {
      firstName: "Setup",
      lastName: "Customer",
      email: `setup-existing-customer-${suffix}@example.test`,
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      passwordSetAt: new Date(),
      role: "CUSTOMER",
    },
    {
      firstName: "Setup",
      lastName: "Owner",
      email: `setup-owner-${suffix}@example.test`,
      passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
      passwordSetAt: new Date(),
      role: "SALON_OWNER",
    },
  ]).returning();
  createdUserIds.push(...actors.map((actor) => actor.id));
  const [superAdmin, admin, existingCustomer, owner] = actors;
  assert.ok(superAdmin && admin && existingCustomer && owner);
  const cookies = {
    superAdmin: `${sessionCookieName}=${await createSession(superAdmin.id)}`,
    admin: `${sessionCookieName}=${await createSession(admin.id)}`,
    customer: `${sessionCookieName}=${await createSession(existingCustomer.id)}`,
    owner: `${sessionCookieName}=${await createSession(owner.id)}`,
  };
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const createBody = {
      firstName: "Production",
      lastName: "Customer",
      email: `setup-target-${suffix}@example.test`,
    };
    const create = (cookie?: string, body = createBody) => fetch(`${baseUrl}/admin/customers/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });

    assert.equal((await create()).status, 401);
    assert.equal((await create(cookies.customer)).status, 403);
    assert.equal((await create(cookies.admin)).status, 403);
    assert.equal((await create(cookies.owner)).status, 403);

    const createdResponse = await create(cookies.superAdmin);
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as CreatedSetup;
    createdUserIds.push(created.user.id);
    assert.equal(created.user.role, "CUSTOMER");
    assert.equal(created.user.email, createBody.email);
    const rawToken = new URL(created.setupUrl).hash.replace(/^#token=/, "");
    assert.ok(rawToken.length >= 32);

    const [storedToken] = await db.select()
      .from(customerPasswordSetupTokensTable)
      .where(eq(customerPasswordSetupTokensTable.userId, created.user.id));
    assert.ok(storedToken);
    assert.notEqual(storedToken.tokenHash, rawToken);
    assert.equal(storedToken.tokenHash.length, 64);
    const audits = await db.select()
      .from(customerPasswordSetupAuditsTable)
      .where(eq(customerPasswordSetupAuditsTable.targetUserId, created.user.id));
    assert.deepEqual(audits.map((audit) => audit.action), ["CUSTOMER_CREATED"]);
    assert.equal(JSON.stringify(audits).includes(rawToken), false);

    const duplicateResponse = await create(cookies.superAdmin);
    assert.equal(duplicateResponse.status, 409);
    const duplicateRows = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, createBody.email));
    assert.equal(duplicateRows.length, 1);

    const validateResponse = await fetch(`${baseUrl}/auth/customer-password-setup/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: rawToken }),
    });
    assert.equal(validateResponse.status, 200);
    const reissue = () => fetch(`${baseUrl}/admin/customers/${created.user.id}/setup`, {
      method: "POST", headers: { cookie: cookies.superAdmin },
    });
    const [reissueA, reissueB] = await Promise.all([reissue(), reissue()]);
    assert.equal(reissueA.status, 201);
    assert.equal(reissueB.status, 201);
    const replacements = await Promise.all([reissueA.json(), reissueB.json()]) as CreatedSetup[];
    const activeTokens = await db.select().from(customerPasswordSetupTokensTable)
      .where(eq(customerPasswordSetupTokensTable.userId, created.user.id));
    assert.equal(activeTokens.filter((row) => !row.consumedAt && !row.invalidatedAt).length, 1,
      "concurrent reissues leave exactly one active token");
    const activeTokenHash = activeTokens.find((row) => !row.consumedAt && !row.invalidatedAt)?.tokenHash;
    const replacementToken = replacements
      .map((replacement) => new URL(replacement.setupUrl).hash.replace(/^#token=/, ""))
      .find((token) => createHash("sha256").update(token).digest("hex") === activeTokenHash);
    assert.ok(replacementToken);
    const failedPolicyResponse = await fetch(`${baseUrl}/auth/customer-password-setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: replacementToken, password: customerPassword, passwordConfirmation: `${customerPassword}x` }),
    });
    assert.equal(failedPolicyResponse.status, 400);
    const [attemptedToken] = await db.select().from(customerPasswordSetupTokensTable)
      .where(eq(customerPasswordSetupTokensTable.tokenHash, createHash("sha256").update(replacementToken).digest("hex")));
    assert.equal(attemptedToken?.failedAttempts, 1, "policy failure consumes one active-token attempt");

    await createSession(created.user.id);
    const completeResponse = await fetch(`${baseUrl}/auth/customer-password-setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: replacementToken, password: customerPassword, passwordConfirmation: customerPassword }),
    });
    assert.equal(completeResponse.status, 200);
    const replayResponse = await fetch(`${baseUrl}/auth/customer-password-setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: replacementToken, password: customerPassword, passwordConfirmation: customerPassword }),
    });
    assert.equal(replayResponse.status, 400);
    const [completedToken] = await db.select()
      .from(customerPasswordSetupTokensTable)
      .where(eq(customerPasswordSetupTokensTable.userId, created.user.id));
    assert.ok(completedToken?.consumedAt);
    const [completedUser] = await db.select()
      .from(usersTable)
      .where(eq(usersTable.id, created.user.id));
    assert.equal(completedUser?.role, "CUSTOMER");
    assert.ok(completedUser?.passwordSetAt);
    assert.equal(
      (await db.select().from(sessionsTable).where(eq(sessionsTable.userId, created.user.id))).length,
      0,
    );

    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: createBody.email, password: customerPassword }),
    });
    assert.equal(loginResponse.status, 200);
    const login = await loginResponse.json() as { user: { role: string } };
    assert.equal(login.user.role, "CUSTOMER");

    const expiredBody = { ...createBody, email: `setup-expired-${suffix}@example.test` };
    const expiredCreateResponse = await create(cookies.superAdmin, expiredBody);
    assert.equal(expiredCreateResponse.status, 201);
    const expired = await expiredCreateResponse.json() as CreatedSetup;
    createdUserIds.push(expired.user.id);
    const expiredRawToken = new URL(expired.setupUrl).hash.replace(/^#token=/, "");
    await db.update(customerPasswordSetupTokensTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(customerPasswordSetupTokensTable.userId, expired.user.id));
    const expiredResponse = await fetch(`${baseUrl}/auth/customer-password-setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: expiredRawToken, password: customerPassword, passwordConfirmation: customerPassword }),
    });
    assert.equal(expiredResponse.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (createdUserIds.length) {
      await db.delete(customerPasswordSetupAuditsTable)
        .where(inArray(customerPasswordSetupAuditsTable.targetUserId, createdUserIds));
      await db.delete(customerPasswordSetupTokensTable)
        .where(inArray(customerPasswordSetupTokensTable.userId, createdUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});