/**
 * OAuth referral-context endpoint regression.
 *
 * Runs the browser-bound OAuth start/callback flow with provider HTTP mocked,
 * so referral validation is exercised at the callback transaction boundary.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  integrationSettingsTable,
  oauthIdentitiesTable,
  oauthLoginStatesTable,
  referralAttributionsTable,
  referralCodesTable,
  referralQualificationsTable,
  salonsTable,
  educationCentersTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { ensureReferralCode } from "./referral-service";
import { ensureReferralSchema } from "./referral-schema";

const suffix = randomUUID();
const origin = `https://oauth-referral-${suffix}.example.test`;
const host = new URL(origin).host;
const integration = "google_oauth" as const;
const cases = [
  { channel: "A", valid: false },
  { channel: "B1", valid: false },
  { channel: "C", valid: false },
  { channel: "B2", valid: true },
  { channel: "D", valid: true },
] as const;
const emails = new Map(cases.map(({ channel }) => [
  channel,
  `oauth-referral-${channel.toLowerCase()}-${suffix}@example.test`,
]));

type Response = { status: number; location?: string; setCookie: string[]; body: string };

function request(port: number, path: string, cookie?: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      hostname: "127.0.0.1", port, path,
      headers: { host, "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}) },
    }, (incoming) => {
      let body = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => { body += chunk; });
      incoming.on("end", () => resolve({
        status: incoming.statusCode ?? 0,
        location: typeof incoming.headers.location === "string" ? incoming.headers.location : undefined,
        setCookie: incoming.headers["set-cookie"] ?? [],
        body,
      }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function oauthCookie(setCookie: string[]) {
  const value = setCookie.find((item) => item.startsWith("lumera_oauth_state="));
  assert.ok(value, "OAuth start must set its browser state cookie");
  return value.split(";", 1)[0]!;
}

async function run(): Promise<void> {
  await ensureReferralSchema();
  const previousNodeEnv = process.env["NODE_ENV"];
  const previousBaseUrl = process.env["APP_BASE_URL"];
  const previousClientId = process.env["GOOGLE_CLIENT_ID"];
  const previousClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const previousIntegrations = await db.select().from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.integration, integration));
  const createdUserIds: string[] = [];
  const states: string[] = [];
  const previousFetch = globalThis.fetch;

  process.env["NODE_ENV"] = "test";
  process.env["APP_BASE_URL"] = origin;
  process.env["GOOGLE_CLIENT_ID"] = `oauth-referral-client-${suffix}`;
  process.env["GOOGLE_CLIENT_SECRET"] = `oauth-referral-secret-${suffix}`;
  await db.delete(integrationSettingsTable).where(eq(integrationSettingsTable.integration, integration));

  const [owner] = await db.insert(usersTable).values({
    firstName: "OAuth", lastName: "Referral source", email: `oauth-referrer-${suffix}@example.test`,
    passwordHash: "test-only", role: "SALON_OWNER",
  }).returning();
  createdUserIds.push(owner!.id);
  const [salon] = await db.insert(salonsTable).values({
    ownerId: owner!.id, name: `OAuth referral salon ${suffix}`, slug: `oauth-referral-${suffix}`,
    city: "Beograd", municipality: "Vračar", address: "Test 1", phone: "+381641234567",
    email: `oauth-referral-salon-${suffix}@example.test`, shortDescription: "Test salon.",
    description: "OAuth referral context test salon.", imageUrl: "/test.jpg",
  }).returning();
  const [center] = await db.insert(educationCentersTable).values({
    ownerId: owner!.id, name: `OAuth referral center ${suffix}`, city: "Beograd",
    description: "OAuth referral context test center.", imageUrl: "/test.jpg",
  }).returning();
  const codes = {
    A: await db.transaction((tx) => ensureReferralCode(tx, {
      channel: "A", referrerUserId: owner!.id, sourceBusiness: "salon", sourceBusinessId: salon!.id,
    })),
    B1: await db.transaction((tx) => ensureReferralCode(tx, { channel: "B1", referrerUserId: owner!.id })),
    B2: await db.transaction((tx) => ensureReferralCode(tx, { channel: "B2", referrerUserId: owner!.id })),
    C: await db.transaction((tx) => ensureReferralCode(tx, {
      channel: "C", referrerUserId: owner!.id, sourceBusiness: "education_center", sourceBusinessId: center!.id,
    })),
    D: await db.transaction((tx) => ensureReferralCode(tx, {
      channel: "D", referrerUserId: owner!.id, sourceBusiness: "salon", sourceBusinessId: salon!.id,
    })),
  };

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token") {
      const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ""));
      return new Response(JSON.stringify({ access_token: `oauth-referral-token:${body.get("code")}` }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      const authorization = new Headers(init?.headers).get("authorization") ?? "";
      const channel = [...emails].find(([, email]) => authorization.endsWith(email))?.[0];
      // The callback code is carried in this test's token to keep each mocked
      // provider identity distinct without provider traffic.
      assert.ok(channel, "profile request must identify an OAuth referral case");
      return new Response(JSON.stringify({
        sub: `oauth-referral-${channel}-${suffix}`, email: emails.get(channel)!,
        email_verified: true, given_name: "OAuth", family_name: "Referral",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected OAuth request: ${url}`);
  }) as typeof fetch;

  app.set("trust proxy", 1);
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    for (const testCase of cases) {
      const start = await request(port, `/api/auth/oauth/google/start?flow=customer&referralCode=${codes[testCase.channel].code}`);
      assert.equal(start.status, 302);
      const state = new URL(start.location!).searchParams.get("state");
      assert.ok(state);
      states.push(state);
      const email = emails.get(testCase.channel)!;
      const callback = await request(port,
        `/api/auth/oauth/google/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(email)}`,
        oauthCookie(start.setCookie));
      if (testCase.valid) {
        assert.equal(callback.status, 302, `${testCase.channel} customer referral completes OAuth`);
        assert.equal(callback.location, "/prijava?oauth_created=1",
          `${testCase.channel} customer referral reaches the OAuth success redirect`);
        assert.equal((await db.select().from(referralAttributionsTable)
          .where(eq(referralAttributionsTable.referredUserId, (await db.select({ id: usersTable.id }).from(usersTable)
            .where(eq(usersTable.email, email)).limit(1))[0]!.id))).length, 1);
      } else {
        assert.equal(callback.status, 400, `${testCase.channel} customer referral is an endpoint validation error`);
        assert.deepEqual(JSON.parse(callback.body), {
          error: "Kod preporuke nije važeći za ovaj tip registracije.",
          code: "REFERRAL_CHANNEL_CONTEXT_INVALID",
        });
        assert.equal((await db.select().from(usersTable).where(eq(usersTable.email, email))).length, 0,
          "failed OAuth attribution rolls back its account");
        assert.equal((await db.select().from(oauthIdentitiesTable)
          .where(eq(oauthIdentitiesTable.providerAccountId, `oauth-referral-${testCase.channel}-${suffix}`))).length, 0,
          "failed OAuth attribution rolls back its identity");
      }
      assert.equal((await db.select().from(oauthLoginStatesTable)
        .where(and(eq(oauthLoginStatesTable.state, state), eq(oauthLoginStatesTable.provider, "google")))).length, 0,
      "a completed or rejected OAuth state cannot be replayed");
    }
  } finally {
    globalThis.fetch = previousFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const referredIds = db.select({ id: usersTable.id }).from(usersTable)
      .where(inArray(usersTable.email, [...emails.values()]));
    await db.transaction(async (tx) => {
      await tx.execute(sql`alter table referral_attributions disable trigger referral_attributions_append_only`);
      try {
        await tx.delete(referralQualificationsTable).where(inArray(
          referralQualificationsTable.attributionId,
          tx.select({ id: referralAttributionsTable.id }).from(referralAttributionsTable)
            .where(inArray(referralAttributionsTable.referredUserId, referredIds)),
        ));
        await tx.delete(referralAttributionsTable)
          .where(inArray(referralAttributionsTable.referredUserId, referredIds));
      } finally {
        await tx.execute(sql`alter table referral_attributions enable trigger referral_attributions_append_only`);
      }
    });
    await db.delete(oauthLoginStatesTable).where(inArray(oauthLoginStatesTable.state, states));
    await db.delete(referralCodesTable).where(eq(referralCodesTable.referrerUserId, owner!.id));
    await db.delete(usersTable).where(inArray(usersTable.email, [...emails.values()]));
    await db.delete(salonsTable).where(eq(salonsTable.id, salon!.id));
    await db.delete(educationCentersTable).where(eq(educationCentersTable.id, center!.id));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    await db.delete(integrationSettingsTable).where(eq(integrationSettingsTable.integration, integration));
    if (previousIntegrations.length) await db.insert(integrationSettingsTable).values(previousIntegrations);
    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = previousNodeEnv;
    if (previousBaseUrl === undefined) delete process.env["APP_BASE_URL"]; else process.env["APP_BASE_URL"] = previousBaseUrl;
    if (previousClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"]; else process.env["GOOGLE_CLIENT_ID"] = previousClientId;
    if (previousClientSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"]; else process.env["GOOGLE_CLIENT_SECRET"] = previousClientSecret;
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});