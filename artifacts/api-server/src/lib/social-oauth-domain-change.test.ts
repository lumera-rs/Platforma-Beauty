/**
 * Social OAuth published-domain regression
 *
 * A deployment domain can change without changing either provider's client
 * credentials. The app must use the current APP_BASE_URL consistently in the
 * admin instructions, provider authorization URL, and callback token
 * exchange. Both providers are exercised without contacting Google or
 * Facebook.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/social-oauth-domain-change.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, integrationSettingsTable, oauthLoginStatesTable, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { saveIntegrationSettings } from "./integrations";

type OAuthProvider = "google" | "facebook";

const suffix = randomUUID().slice(0, 8);
const providers: OAuthProvider[] = ["google", "facebook"];
const callbackFor = (origin: string, provider: OAuthProvider) =>
  `${origin}/api/auth/oauth/${provider}/callback`;

function requestWithHost(
  port: number,
  path: string,
  options: { host: string; cookie?: string },
): Promise<{ status: number; location?: string; setCookie: string[]; body: string }> {
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

function oauthStateCookie(setCookie: string[]): string {
  const cookie = setCookie.find((value) => value.startsWith("lumera_oauth_state="));
  assert.ok(cookie, "OAuth start must set a browser-bound state cookie");
  return cookie.split(";", 1)[0]!;
}

async function run(): Promise<void> {
  const previousNodeEnv = process.env["NODE_ENV"];
  const previousAppBaseUrl = process.env["APP_BASE_URL"];
  const previousGoogleClientId = process.env["GOOGLE_CLIENT_ID"];
  const previousGoogleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const previousFacebookAppId = process.env["FACEBOOK_APP_ID"];
  const previousFacebookAppSecret = process.env["FACEBOOK_APP_SECRET"];
  const states: string[] = [];
  const testEmails = providers.map((provider) => `oauth-domain-${provider}-${suffix}@example.test`);
  const oauthIntegrationNames = ["google_oauth", "facebook_oauth"] as const;
  const previousIntegrationRows = await db.select().from(integrationSettingsTable)
    .where(inArray(integrationSettingsTable.integration, oauthIntegrationNames));

  process.env["NODE_ENV"] = "production";
  process.env["GOOGLE_CLIENT_ID"] = `google-test-client-${suffix}`;
  process.env["GOOGLE_CLIENT_SECRET"] = `google-test-secret-${suffix}`;
  process.env["FACEBOOK_APP_ID"] = `facebook-test-app-${suffix}`;
  process.env["FACEBOOK_APP_SECRET"] = `facebook-test-secret-${suffix}`;

  const oldOrigin = `https://old-published-${suffix}.example.com`;
  const publishedOrigin = `https://new-published-${suffix}.example.com`;
  process.env["APP_BASE_URL"] = oldOrigin;

  // Force the provider-config lookup onto temporary test credentials even if
  // another local run left an OAuth settings row behind. The exact original
  // rows are restored in finally; no production credential is touched.
  await db.delete(integrationSettingsTable)
    .where(inArray(integrationSettingsTable.integration, oauthIntegrationNames));

  const passwordHash = await hashPassword(`oauth-domain-admin-${suffix}`);
  const [admin] = await db.insert(usersTable).values({
    firstName: "OAuth",
    lastName: "Domain Admin",
    email: `oauth-domain-admin-${suffix}@example.test`,
    passwordHash,
    passwordSetAt: new Date(),
    role: "SUPER_ADMIN",
  }).returning();
  assert.ok(admin);
  const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
  await Promise.all([
    saveIntegrationSettings({
      integration: "google_oauth",
      enabled: true,
      values: { clientId: `google-test-client-${suffix}`, clientSecret: `google-test-secret-${suffix}` },
      updatedByUserId: admin.id,
    }),
    saveIntegrationSettings({
      integration: "facebook_oauth",
      enabled: true,
      values: { clientId: `facebook-test-app-${suffix}`, clientSecret: `facebook-test-secret-${suffix}` },
      updatedByUserId: admin.id,
    }),
  ]);

  const realFetch = globalThis.fetch;
  const tokenRedirectUris = new Map<OAuthProvider, string>();
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token" || url === "https://graph.facebook.com/v20.0/oauth/access_token") {
      const provider: OAuthProvider = url.includes("google") ? "google" : "facebook";
      const body = init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === "string" ? init.body : "";
      const redirectUri = new URLSearchParams(body).get("redirect_uri");
      tokenRedirectUris.set(provider, redirectUri ?? "");
      return new Response(JSON.stringify({ access_token: `${provider}-access-token-${suffix}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      return new Response(JSON.stringify({
        sub: `google-account-${suffix}`,
        email: testEmails[0],
        email_verified: true,
        given_name: "Google",
        family_name: "User",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://graph.facebook.com/me?")) {
      return new Response(JSON.stringify({
        id: `facebook-account-${suffix}`,
        email: testEmails[1],
        first_name: "Facebook",
        last_name: "User",
        name: "Facebook User",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    // Simulate the published-domain change before the next OAuth flow. The
    // provider credentials stay untouched; only the deployment-owned origin
    // changes.
    const staleIntegrations = await requestWithHost(port, "/api/admin/integrations", {
      host: new URL(publishedOrigin).host,
      cookie: adminCookie,
    });
    assert.equal(staleIntegrations.status, 200, "admin integration settings must remain available while APP_BASE_URL is stale");
    const staleIntegrationsData = JSON.parse(staleIntegrations.body) as {
      redirectUriWarning?: string;
    };
    assert.match(
      staleIntegrationsData.redirectUriWarning ?? "",
      /APP_BASE_URL.*Google\/Facebook callback registracije/i,
      "admin must warn before a new published origin is used with a stale APP_BASE_URL",
    );
    assert.match(staleIntegrationsData.redirectUriWarning ?? "", /novog domena/i,
      "the warning must tell the admin to update settings before using the new domain");
    assert.doesNotMatch(staleIntegrations.body, /google-test-secret|facebook-test-secret/,
      "the domain warning must not expose provider credentials");

    process.env["APP_BASE_URL"] = publishedOrigin;

    const integrations = await requestWithHost(port, "/api/admin/integrations", {
      host: new URL(publishedOrigin).host,
      cookie: adminCookie,
    });
    assert.equal(integrations.status, 200, "admin integration settings must remain available after the domain change");
    const integrationsData = JSON.parse(integrations.body) as {
      redirectUris: { google: string; facebook: string };
      redirectUriWarning?: string;
    };
    assert.deepEqual(integrationsData.redirectUris, {
      google: callbackFor(publishedOrigin, "google"),
      facebook: callbackFor(publishedOrigin, "facebook"),
    }, "admin must show callback URLs for the new published origin");
    assert.equal(integrationsData.redirectUriWarning, undefined,
      "admin must clear the warning after APP_BASE_URL is updated to the published origin");

    for (const provider of providers) {
      const expectedRedirectUri = callbackFor(publishedOrigin, provider);
      const start = await requestWithHost(port, `/api/auth/oauth/${provider}/start?flow=customer`, {
        host: new URL(publishedOrigin).host,
      });
      assert.equal(start.status, 302, `${provider} OAuth start must redirect to the provider`);
      assert.ok(start.location);
      const providerUrl = new URL(start.location);
      assert.equal(providerUrl.searchParams.get("redirect_uri"), expectedRedirectUri,
        `${provider} OAuth start must use the new published callback URL`);

      const state = providerUrl.searchParams.get("state");
      assert.ok(state);
      states.push(state);
      const callback = await requestWithHost(
        port,
        `/api/auth/oauth/${provider}/callback?code=test-code-${provider}&state=${encodeURIComponent(state)}`,
        { host: new URL(publishedOrigin).host, cookie: oauthStateCookie(start.setCookie) },
      );
      assert.equal(callback.status, 302, `${provider} callback must complete after the domain change`);
      assert.equal(callback.location, "/moj-nalog", `${provider} callback must return the customer to LUMERA`);
      assert.equal(tokenRedirectUris.get(provider), expectedRedirectUri,
        `${provider} token exchange must use the same published callback URL as start`);
    }
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.delete(oauthLoginStatesTable).where(inArray(oauthLoginStatesTable.state, states));
    await db.delete(usersTable).where(inArray(usersTable.email, testEmails));
    await db.delete(integrationSettingsTable)
      .where(inArray(integrationSettingsTable.integration, oauthIntegrationNames));
    if (previousIntegrationRows.length) await db.insert(integrationSettingsTable).values(previousIntegrationRows);
    await db.delete(usersTable).where(eq(usersTable.email, `oauth-domain-admin-${suffix}@example.test`));

    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = previousNodeEnv;
    if (previousAppBaseUrl === undefined) delete process.env["APP_BASE_URL"]; else process.env["APP_BASE_URL"] = previousAppBaseUrl;
    if (previousGoogleClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"]; else process.env["GOOGLE_CLIENT_ID"] = previousGoogleClientId;
    if (previousGoogleClientSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"]; else process.env["GOOGLE_CLIENT_SECRET"] = previousGoogleClientSecret;
    if (previousFacebookAppId === undefined) delete process.env["FACEBOOK_APP_ID"]; else process.env["FACEBOOK_APP_ID"] = previousFacebookAppId;
    if (previousFacebookAppSecret === undefined) delete process.env["FACEBOOK_APP_SECRET"]; else process.env["FACEBOOK_APP_SECRET"] = previousFacebookAppSecret;
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
