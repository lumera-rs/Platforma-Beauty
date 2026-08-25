/**
 * Social OAuth return-target regression
 *
 * Exercises the same start -> provider token/profile -> callback flow used by
 * Google and Facebook, while replacing provider HTTP calls with deterministic
 * test responses. The test deliberately uses a Beauty Poslovi conversation
 * target so a provider/configuration change cannot silently send the user to
 * a generic dashboard.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/social-oauth-return-to.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, integrationSettingsTable, oauthLoginStatesTable, usersTable } from "@workspace/db";
import app from "../app";

type OAuthProvider = "google" | "facebook";
type HttpResponse = { status: number; location?: string; setCookie: string[]; body: string };

const suffix = randomUUID();
const providers: OAuthProvider[] = ["google", "facebook"];
const integrationNames = ["google_oauth", "facebook_oauth"] as const;
const testEmails: Record<OAuthProvider, string> = {
  google: `oauth-return-google-${suffix}@example.test`,
  facebook: `oauth-return-facebook-${suffix}@example.test`,
};

function requestWithHost(
  port: number,
  path: string,
  options: { host: string; cookie?: string },
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      headers: {
        host: options.host,
        "x-forwarded-proto": "https",
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        location: typeof response.headers.location === "string" ? response.headers.location : undefined,
        setCookie: response.headers["set-cookie"] ?? [],
        body,
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

function stateCookie(setCookie: string[]): string {
  const cookie = setCookie.find((value) => value.startsWith("lumera_oauth_state="));
  assert.ok(cookie, "OAuth start must bind the attempt to a browser state cookie");
  return cookie.split(";", 1)[0]!;
}

function expectedFailure(location: string | undefined, text: string) {
  assert.ok(location);
  assert.equal(decodeURIComponent(new URL(location, "https://lumera.test").searchParams.get("oauth_error") ?? ""), text);
}

async function run(): Promise<void> {
  const previousNodeEnv = process.env["NODE_ENV"];
  const previousAppBaseUrl = process.env["APP_BASE_URL"];
  const previousGoogleClientId = process.env["GOOGLE_CLIENT_ID"];
  const previousGoogleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const previousFacebookAppId = process.env["FACEBOOK_APP_ID"];
  const previousFacebookAppSecret = process.env["FACEBOOK_APP_SECRET"];
  const previousIntegrationRows = await db.select().from(integrationSettingsTable)
    .where(inArray(integrationSettingsTable.integration, integrationNames));
  const states: string[] = [];
  const origin = `https://oauth-return-${suffix}.example.test`;
  const host = new URL(origin).host;

  process.env["NODE_ENV"] = "test";
  process.env["APP_BASE_URL"] = origin;
  process.env["GOOGLE_CLIENT_ID"] = `oauth-return-google-client-${suffix}`;
  process.env["GOOGLE_CLIENT_SECRET"] = `oauth-return-google-secret-${suffix}`;
  process.env["FACEBOOK_APP_ID"] = `oauth-return-facebook-app-${suffix}`;
  process.env["FACEBOOK_APP_SECRET"] = `oauth-return-facebook-secret-${suffix}`;

  // A disabled/persisted integration row must not accidentally make this
  // fixture depend on shared development settings.
  await db.delete(integrationSettingsTable)
    .where(inArray(integrationSettingsTable.integration, integrationNames));

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token" || url === "https://graph.facebook.com/v20.0/oauth/access_token") {
      const provider: OAuthProvider = url.includes("google") ? "google" : "facebook";
      const body = init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === "string" ? init.body : "";
      assert.equal(new URLSearchParams(body).get("redirect_uri"), `${origin}/api/auth/oauth/${provider}/callback`);
      return new Response(JSON.stringify({ access_token: `${provider}-access-token-${suffix}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      return new Response(JSON.stringify({
        sub: `oauth-return-google-account-${suffix}`,
        email: testEmails.google,
        email_verified: true,
        given_name: "Google",
        family_name: "Test",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://graph.facebook.com/me?")) {
      return new Response(JSON.stringify({
        id: `oauth-return-facebook-account-${suffix}`,
        email: testEmails.facebook,
        first_name: "Facebook",
        last_name: "Test",
        name: "Facebook Test",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected outbound request in OAuth return-target test: ${url}`);
  }) as typeof fetch;

  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const start = async (provider: OAuthProvider, returnTo?: string) => {
      const query = new URLSearchParams({ flow: "customer" });
      if (returnTo !== undefined) query.set("returnTo", returnTo);
      const response = await requestWithHost(port, `/api/auth/oauth/${provider}/start?${query.toString()}`, { host });
      assert.equal(response.status, 302, `${provider} OAuth start must redirect to its provider`);
      assert.ok(response.location);
      const providerUrl = new URL(response.location);
      const state = providerUrl.searchParams.get("state");
      assert.ok(state);
      states.push(state);
      return { state, cookie: stateCookie(response.setCookie) };
    };

    const callback = (
      provider: OAuthProvider,
      state: string,
      cookie: string,
      query: Record<string, string>,
    ) => {
      const params = new URLSearchParams({ ...query, state });
      return requestWithHost(port, `/api/auth/oauth/${provider}/callback?${params.toString()}`, { host, cookie });
    };

    for (const provider of providers) {
      const target = `/moji-oglasi?listingId=${provider}-listing-${suffix}&contactId=${provider}-contact-${suffix}#conversation`;
      const successful = await start(provider, target);
      const response = await callback(provider, successful.state, successful.cookie, {
        code: `${provider}-deep-link-code`,
      });
      assert.equal(response.status, 302);
      assert.equal(response.location, target,
        `${provider} must return to the exact Beauty Poslovi listing/contact target`);

      for (const invalidReturnTo of [
        `https://evil.example/${provider}`,
        `//evil.example/${provider}`,
      ]) {
        const unsafe = await start(provider, invalidReturnTo);
        const unsafeResponse = await callback(provider, unsafe.state, unsafe.cookie, {
          code: `${provider}-unsafe-return-code`,
        });
        assert.equal(unsafeResponse.status, 302);
        assert.equal(unsafeResponse.location, "/moj-nalog",
          `${provider} must reject external and protocol-relative returnTo values`);
      }
    }

    for (const provider of providers) {
      const cancelled = await start(provider, `/moji-oglasi?listingId=cancel-${provider}-${suffix}&contactId=cancel-contact-${suffix}`);
      const cancelledResponse = await callback(provider, cancelled.state, cancelled.cookie, { error: "access_denied" });
      expectedFailure(cancelledResponse.location, "Prijava je otkazana ili nije odobrena.");

      const expired = await start(provider, `/moji-oglasi?listingId=expired-${provider}-${suffix}&contactId=expired-contact-${suffix}`);
      await db.update(oauthLoginStatesTable)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(and(eq(oauthLoginStatesTable.state, expired.state), eq(oauthLoginStatesTable.provider, provider)));
      const expiredResponse = await callback(provider, expired.state, expired.cookie, {
        code: `${provider}-expired-code`,
      });
      expectedFailure(expiredResponse.location, "Prijava je istekla. Pokušajte ponovo.");
    }

    const firstTarget = `/moji-oglasi?listingId=parallel-first-${suffix}&contactId=parallel-first-contact-${suffix}`;
    const secondTarget = `/moji-oglasi?listingId=parallel-second-${suffix}&contactId=parallel-second-contact-${suffix}`;
    const first = await start("google", firstTarget);
    const second = await start("facebook", secondTarget);
    const mismatched = await callback("google", first.state, second.cookie, { code: "google-mismatched-code" });
    expectedFailure(mismatched.location, "Prijava nije povezana sa ovim browserom. Pokušajte ponovo.");
    assert.equal(mismatched.location?.includes("parallel-"), false,
      "a stale parallel callback must never inherit the newer attempt's target");

    const secondResponse = await callback("facebook", second.state, second.cookie, { code: "facebook-parallel-code" });
    assert.equal(secondResponse.location, secondTarget,
      "the active parallel attempt must retain its own listing/contact target");
    const firstResponse = await callback("google", first.state, first.cookie, { code: "google-parallel-code" });
    assert.equal(firstResponse.location, firstTarget,
      "the original attempt remains bound to its own browser cookie and target");

    const createdUsers = await db.select({ email: usersTable.email }).from(usersTable)
      .where(inArray(usersTable.email, Object.values(testEmails)));
    assert.deepEqual(new Set(createdUsers.map((user) => user.email)), new Set(Object.values(testEmails)),
      "provider round-trips must create only the two deterministic test accounts");
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(oauthLoginStatesTable).where(inArray(oauthLoginStatesTable.state, states));
    await db.delete(usersTable).where(inArray(usersTable.email, Object.values(testEmails)));
    await db.delete(integrationSettingsTable)
      .where(inArray(integrationSettingsTable.integration, integrationNames));
    if (previousIntegrationRows.length) await db.insert(integrationSettingsTable).values(previousIntegrationRows);

    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = previousNodeEnv;
    if (previousAppBaseUrl === undefined) delete process.env["APP_BASE_URL"]; else process.env["APP_BASE_URL"] = previousAppBaseUrl;
    if (previousGoogleClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"]; else process.env["GOOGLE_CLIENT_ID"] = previousGoogleClientId;
    if (previousGoogleClientSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"]; else process.env["GOOGLE_CLIENT_SECRET"] = previousGoogleClientSecret;
    if (previousFacebookAppId === undefined) delete process.env["FACEBOOK_APP_ID"]; else process.env["FACEBOOK_APP_ID"] = previousFacebookAppId;
    if (previousFacebookAppSecret === undefined) delete process.env["FACEBOOK_APP_SECRET"]; else process.env["FACEBOOK_APP_SECRET"] = previousFacebookAppSecret;
  }
}

run().then(
  () => console.log("Social OAuth return-target integration test passed."),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);