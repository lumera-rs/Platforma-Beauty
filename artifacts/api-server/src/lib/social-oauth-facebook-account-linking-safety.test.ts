/**
 * Task #7A: Facebook OAuth account-linking safety regression.
 *
 * Root cause traced in the /auth/oauth/:provider/callback "customer"/"business"
 * (non-"link") flow: when no oauth_identities row already matches
 * (provider, providerAccountId), the callback fell back to looking the
 * profile's email up against usersTable.email and, on a match, silently
 * authenticated as -- and permanently attached the new provider identity to
 * -- that EXISTING account. Google's profile fetch already requires
 * email_verified === true from Google's own real-time OIDC userinfo
 * response before returning a profile at all, so an email match there rides
 * on a genuine per-request provider guarantee. Facebook's Graph API /me
 * response (fields=id,email,first_name,last_name,name) carries no such
 * signal this application can check -- so treating a Facebook-supplied
 * email as sufficient by itself to authenticate into an existing account is
 * a direct account-takeover path: an attacker only needs a Facebook profile
 * (their own, brand-new, never linked to anyone) whose email field happens
 * to read as the victim's address.
 *
 * This was CONFIRMED exploitable end-to-end against the unmodified code
 * before this fix: a fresh Facebook identity supplying only an existing
 * local user's email received a valid `lumera_session` cookie resolving to
 * that user's account, and a new oauth_identities row was silently inserted
 * linking the attacker's Facebook id to the victim's account for future
 * logins too.
 *
 * The fix is scoped to Facebook only (see marketplace.ts,
 * "oauth_facebook_email_collision"): an unlinked Facebook identity whose
 * email matches an existing local account is now rejected with the same
 * "account already exists" message ordinary email/password registration
 * already gives, instructing the user to sign in normally and link
 * Facebook from account settings (the existing authenticated "link" flow,
 * unchanged). Google's flow is intentionally left untouched -- its
 * email_verified check is exactly the kind of provider-authoritative
 * guarantee item 5 of the task allows to keep the existing linking rule.
 *
 * Already-linked Facebook identities are unaffected: resolution there was
 * already, and remains, by (provider, providerAccountId) alone, never by
 * email -- verified below across an email change and a missing email.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/social-oauth-facebook-account-linking-safety.test.ts
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { db, integrationSettingsTable, oauthIdentitiesTable, oauthLoginStatesTable, sessionsTable, usersTable } from "@workspace/db";
import app from "../app";
import { hashPassword } from "./auth";

type HttpResponse = { status: number; location?: string; setCookie: string[]; body: string };
type FacebookMeResult =
  | { kind: "profile"; id: string; email?: string; firstName?: string; lastName?: string }
  | { kind: "error" };

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

function sessionToken(setCookie: string[]): string | undefined {
  const cookie = setCookie.find((value) => value.startsWith("lumera_session="));
  return cookie?.split(";", 1)[0]!.split("=")[1];
}

async function sessionUserId(token: string): Promise<string | undefined> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.tokenHash, tokenHash)).limit(1);
  return session?.userId;
}

function expectedOauthError(location: string | undefined, text: string) {
  assert.ok(location, "expected a redirect");
  assert.equal(decodeURIComponent(new URL(location, "https://lumera.test").searchParams.get("oauth_error") ?? ""), text);
}

async function run(): Promise<void> {
  const suffix = randomUUID();
  const origin = `https://fb-linking-safety-${suffix}.example.test`;
  const host = new URL(origin).host;
  const integrationNames = ["google_oauth", "facebook_oauth"] as const;
  const previousNodeEnv = process.env["NODE_ENV"];
  const previousAppBaseUrl = process.env["APP_BASE_URL"];
  const previousFacebookAppId = process.env["FACEBOOK_APP_ID"];
  const previousFacebookAppSecret = process.env["FACEBOOK_APP_SECRET"];
  const previousIntegrationRows = await db.select().from(integrationSettingsTable)
    .where(inArray(integrationSettingsTable.integration, integrationNames));

  process.env["NODE_ENV"] = "test";
  process.env["APP_BASE_URL"] = origin;
  process.env["FACEBOOK_APP_ID"] = `fb-linking-app-${suffix}`;
  process.env["FACEBOOK_APP_SECRET"] = `fb-linking-secret-${suffix}`;
  await db.delete(integrationSettingsTable).where(inArray(integrationSettingsTable.integration, integrationNames));

  const states: string[] = [];
  const userIds: string[] = [];
  const meResponses = new Map<string, FacebookMeResult>();

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://graph.facebook.com/v20.0/oauth/access_token") {
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : "";
      const code = new URLSearchParams(body).get("code") ?? "";
      // The access token IS the authorization code in this fixture -- lets
      // each scenario control exactly which Graph /me response its callback
      // sees by keying meResponses off the code it supplies.
      return new Response(JSON.stringify({ access_token: code }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://graph.facebook.com/me?")) {
      const accessToken = new URL(url).searchParams.get("access_token") ?? "";
      const result = meResponses.get(accessToken);
      if (!result || result.kind === "error") {
        return new Response(JSON.stringify({ error: { message: "No such test fixture" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        id: result.id,
        ...(result.email !== undefined ? { email: result.email } : {}),
        first_name: result.firstName ?? "Facebook",
        last_name: result.lastName ?? "Test",
        name: `${result.firstName ?? "Facebook"} ${result.lastName ?? "Test"}`,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected outbound request in Facebook account-linking safety test: ${url}`);
  }) as typeof fetch;

  app.set("trust proxy", 1);
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const start = async (flow: "customer" | "business" = "customer") => {
      const response = await requestWithHost(port, `/api/auth/oauth/facebook/start?flow=${flow}`, { host });
      assert.equal(response.status, 302);
      const state = new URL(response.location!).searchParams.get("state")!;
      states.push(state);
      return { state, cookie: stateCookie(response.setCookie) };
    };

    const callback = (state: string, cookie: string, code: string) =>
      requestWithHost(port, `/api/auth/oauth/facebook/callback?${new URLSearchParams({ state, code }).toString()}`, { host, cookie });

    const createLocalUser = async (email: string, overrides: Partial<typeof usersTable.$inferInsert> = {}) => {
      const [user] = await db.insert(usersTable).values({
        firstName: "Local", lastName: "User", email,
        passwordHash: await hashPassword(`local-password-${suffix}`), passwordSetAt: new Date(), role: "CUSTOMER",
        ...overrides,
      }).returning();
      assert.ok(user);
      userIds.push(user.id);
      return user;
    };

    // --- Scenario 1-4: existing local account + brand-new Facebook identity
    // + same untrusted email => must NOT authenticate as the victim, must
    // NOT attach the identity, no session, DB state for the victim unchanged.
    {
      const victimEmail = `fb-safety-victim-${suffix}@example.test`;
      const victim = await createLocalUser(victimEmail);
      const attackerCode = `fb-attacker-code-${suffix}`;
      meResponses.set(attackerCode, { kind: "profile", id: `fb-attacker-account-${suffix}`, email: victimEmail, firstName: "Attacker", lastName: "Evil" });

      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, attackerCode);

      assert.equal(response.status, 302);
      expectedOauthError(response.location,
        "Nalog sa ovom e-mail adresom već postoji. Prijavite se lozinkom ili prethodno povezanim nalogom, pa dodajte Facebook prijavu iz podešavanja naloga.");
      assert.equal(sessionToken(response.setCookie), undefined, "the rejected collision must not set a session cookie");

      const victimIdentities = await db.select().from(oauthIdentitiesTable).where(eq(oauthIdentitiesTable.userId, victim.id));
      assert.equal(victimIdentities.length, 0, "the victim account must gain no Facebook identity from the rejected attempt");

      const attackerIdentity = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "facebook"), eq(oauthIdentitiesTable.providerAccountId, `fb-attacker-account-${suffix}`)));
      assert.equal(attackerIdentity.length, 0, "no oauth_identities row must exist for the attacker's Facebook id at all");

      const victimRow = await db.select().from(usersTable).where(eq(usersTable.id, victim.id)).limit(1);
      assert.equal(victimRow[0]?.email, victimEmail, "the victim's own account row must be untouched");

      const sessions = await db.select().from(sessionsTable).where(eq(sessionsTable.userId, victim.id));
      assert.equal(sessions.length, 0, "no session may be created for the victim");

      const consumedState = await db.select().from(oauthLoginStatesTable).where(eq(oauthLoginStatesTable.state, attempt.state));
      assert.equal(consumedState.length, 0, "the rejected attempt's one-time state must still be consumed, like every other callback failure");
    }

    // --- Scenario 5-6: already-linked Facebook identity resolves by
    // provider id alone -- login succeeds even when the Facebook email
    // changes.
    let linkedUser: typeof usersTable.$inferSelect;
    const linkedProviderAccountId = `fb-linked-account-${suffix}`;
    {
      const originalEmail = `fb-safety-linked-${suffix}@example.test`;
      linkedUser = await createLocalUser(originalEmail);
      await db.insert(oauthIdentitiesTable).values({
        userId: linkedUser.id, provider: "facebook", providerAccountId: linkedProviderAccountId, providerEmail: originalEmail,
      });

      const legitimateCode = `fb-legit-login-code-${suffix}`;
      meResponses.set(legitimateCode, { kind: "profile", id: linkedProviderAccountId, email: originalEmail });
      const legitAttempt = await start();
      const legitResponse = await callback(legitAttempt.state, legitAttempt.cookie, legitimateCode);
      assert.equal(legitResponse.status, 302);
      assert.match(legitResponse.location ?? "", /^\/prijava\?oauth_created=1/);
      const legitToken = sessionToken(legitResponse.setCookie);
      assert.ok(legitToken, "a legitimately linked Facebook identity must still authenticate");
      assert.equal(await sessionUserId(legitToken), linkedUser.id);

      const changedEmailCode = `fb-changed-email-code-${suffix}`;
      const changedEmail = `fb-safety-linked-new-email-${suffix}@example.test`;
      meResponses.set(changedEmailCode, { kind: "profile", id: linkedProviderAccountId, email: changedEmail });
      const changedAttempt = await start();
      const changedResponse = await callback(changedAttempt.state, changedAttempt.cookie, changedEmailCode);
      assert.equal(changedResponse.status, 302);
      assert.match(changedResponse.location ?? "", /^\/prijava\?oauth_created=1/);
      const changedToken = sessionToken(changedResponse.setCookie);
      assert.ok(changedToken, "a changed Facebook email must not block login for an already-linked identity");
      assert.equal(await sessionUserId(changedToken), linkedUser.id, "identity resolution must still be the SAME local account, never a new one");

      const noNewUserForChangedEmail = await db.select().from(usersTable).where(eq(usersTable.email, changedEmail));
      assert.equal(noNewUserForChangedEmail.length, 0, "a changed Facebook email must not create a second account");

      const identityRows = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "facebook"), eq(oauthIdentitiesTable.providerAccountId, linkedProviderAccountId)));
      assert.equal(identityRows.length, 1, "the provider identity row must not be duplicated");
      assert.equal(identityRows[0]?.userId, linkedUser.id, "the provider identity must still point at the original account");
    }

    // --- Scenario 7: linked provider id + missing email. resolveOAuthProfile
    // already rejects a Facebook profile with no email entirely (same as an
    // unlinked identity) -- documented here as an existing, unchanged
    // limitation, not a regression from this fix: the account stays safe,
    // just not reachable via Facebook until Facebook returns an email again.
    {
      const missingEmailCode = `fb-missing-email-linked-code-${suffix}`;
      meResponses.set(missingEmailCode, { kind: "profile", id: linkedProviderAccountId });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, missingEmailCode);
      assert.equal(response.status, 302);
      expectedOauthError(response.location, "Nismo mogli da potvrdimo nalog kod provajdera.");
      assert.equal(sessionToken(response.setCookie), undefined, "a missing email must never fall back to an authenticated session");
    }

    // --- Scenario 8: brand-new provider id + genuinely unused email =>
    // legitimate first-time Facebook registration must keep working.
    {
      const newEmail = `fb-safety-new-user-${suffix}@example.test`;
      const newProviderAccountId = `fb-new-account-${suffix}`;
      const newUserCode = `fb-new-user-code-${suffix}`;
      meResponses.set(newUserCode, { kind: "profile", id: newProviderAccountId, email: newEmail, firstName: "Brand", lastName: "New" });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, newUserCode);
      assert.equal(response.status, 302);
      assert.match(response.location ?? "", /^\/prijava\?oauth_created=1/);
      const token = sessionToken(response.setCookie);
      assert.ok(token, "a genuinely new Facebook identity with an unused email must still be able to register");
      const newUserId = await sessionUserId(token);
      assert.ok(newUserId);
      userIds.push(newUserId!);
      const [createdUser] = await db.select().from(usersTable).where(eq(usersTable.id, newUserId!)).limit(1);
      assert.equal(createdUser?.email, newEmail);
      const identity = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "facebook"), eq(oauthIdentitiesTable.providerAccountId, newProviderAccountId)));
      assert.equal(identity.length, 1);
      assert.equal(identity[0]?.userId, newUserId);
    }

    // --- Scenario 9: missing email for an UNLINKED identity => safe failure,
    // no account created, no session.
    {
      const unlinkedNoEmailCode = `fb-unlinked-no-email-code-${suffix}`;
      meResponses.set(unlinkedNoEmailCode, { kind: "profile", id: `fb-unlinked-no-email-account-${suffix}` });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, unlinkedNoEmailCode);
      assert.equal(response.status, 302);
      expectedOauthError(response.location, "Nismo mogli da potvrdimo nalog kod provajdera.");
      assert.equal(sessionToken(response.setCookie), undefined);
      const identity = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "facebook"), eq(oauthIdentitiesTable.providerAccountId, `fb-unlinked-no-email-account-${suffix}`)));
      assert.equal(identity.length, 0);
    }

    // --- Scenario 10: case-normalized existing-email collision cannot
    // bypass the protection (both sides of the comparison already lowercase
    // before it happens -- this proves that normalization survives the fix).
    {
      const victimEmail = `fb-safety-case-victim-${suffix}@example.test`;
      const victim = await createLocalUser(victimEmail);
      const mixedCaseEmail = `Fb-Safety-Case-Victim-${suffix}@Example.Test`;
      assert.notEqual(mixedCaseEmail, victimEmail);
      const attackerCode = `fb-case-attacker-code-${suffix}`;
      meResponses.set(attackerCode, { kind: "profile", id: `fb-case-attacker-account-${suffix}`, email: mixedCaseEmail });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, attackerCode);
      assert.equal(response.status, 302);
      expectedOauthError(response.location,
        "Nalog sa ovom e-mail adresom već postoji. Prijavite se lozinkom ili prethodno povezanim nalogom, pa dodajte Facebook prijavu iz podešavanja naloga.");
      assert.equal(sessionToken(response.setCookie), undefined);
      const duplicateAccounts = await db.select().from(usersTable).where(eq(usersTable.email, mixedCaseEmail.toLowerCase()));
      assert.equal(duplicateAccounts.length, 1, "no duplicate/second account may be created for the case-varied email");
      assert.equal(duplicateAccounts[0]?.id, victim.id);
    }

    // --- Scenario 11: an inactive/deactivated local account cannot be
    // revived merely through Facebook OAuth. Identity-based resolution
    // still finds the row (it does not check `active`, matching how the
    // rest of this branch always worked), but the resulting session can
    // never actually authenticate anything because getCurrentUser() already
    // requires active = true for every session lookup app-wide.
    {
      const inactiveEmail = `fb-safety-inactive-${suffix}@example.test`;
      const inactiveUser = await createLocalUser(inactiveEmail, { active: false });
      const inactiveProviderAccountId = `fb-inactive-account-${suffix}`;
      await db.insert(oauthIdentitiesTable).values({
        userId: inactiveUser.id, provider: "facebook", providerAccountId: inactiveProviderAccountId, providerEmail: inactiveEmail,
      });
      const inactiveCode = `fb-inactive-login-code-${suffix}`;
      meResponses.set(inactiveCode, { kind: "profile", id: inactiveProviderAccountId, email: inactiveEmail });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, inactiveCode);
      const token = sessionToken(response.setCookie);

      if (token) {
        const meResponse = await requestWithHost(port, "/api/auth/me", { host, cookie: `lumera_session=${token}` });
        const body = JSON.parse(meResponse.body) as { user: unknown };
        assert.equal(body.user, null, "a session bound to a deactivated account must never resolve to an authenticated user");
      }
    }

    // --- Scenario 12 / concurrency: one Facebook provider identity can
    // never end up linked to two different local accounts, even when two
    // callbacks for the SAME brand-new identity race each other.
    {
      const raceEmail = `fb-safety-race-${suffix}@example.test`;
      const raceProviderAccountId = `fb-race-account-${suffix}`;
      const raceCodeA = `fb-race-code-a-${suffix}`;
      const raceCodeB = `fb-race-code-b-${suffix}`;
      meResponses.set(raceCodeA, { kind: "profile", id: raceProviderAccountId, email: raceEmail, firstName: "Race", lastName: "A" });
      meResponses.set(raceCodeB, { kind: "profile", id: raceProviderAccountId, email: raceEmail, firstName: "Race", lastName: "B" });

      const attemptA = await start();
      const attemptB = await start();
      const [responseA, responseB] = await Promise.all([
        callback(attemptA.state, attemptA.cookie, raceCodeA),
        callback(attemptB.state, attemptB.cookie, raceCodeB),
      ]);

      const raceUsers = await db.select().from(usersTable).where(eq(usersTable.email, raceEmail));
      assert.equal(raceUsers.length, 1, "a concurrent race for the same new Facebook identity must never create two accounts");
      userIds.push(raceUsers[0]!.id);

      const raceIdentities = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "facebook"), eq(oauthIdentitiesTable.providerAccountId, raceProviderAccountId)));
      assert.equal(raceIdentities.length, 1, "a concurrent race must never duplicate the provider identity row");
      assert.equal(raceIdentities[0]?.userId, raceUsers[0]!.id, "the single identity row must point at the single created account");

      const succeededTokens = [responseA, responseB]
        .map((response) => sessionToken(response.setCookie))
        .filter((token): token is string => token !== undefined);
      assert.ok(succeededTokens.length >= 1, "at least one of the two racing legitimate attempts must succeed");
      for (const token of succeededTokens) {
        assert.equal(await sessionUserId(token), raceUsers[0]!.id, "every successful racer must resolve to the single correct account");
      }
    }

    // --- DB constraint documentation: one provider identity can never be
    // linked to two local accounts, enforced by oauth_identities'
    // (provider, providerAccountId) unique index -- not something this fix
    // needs to reimplement in application code.
    {
      const constraintEmail = `fb-safety-constraint-${suffix}@example.test`;
      const constraintUserA = await createLocalUser(constraintEmail);
      const constraintUserB = await createLocalUser(`fb-safety-constraint-b-${suffix}@example.test`);
      const sharedProviderAccountId = `fb-constraint-account-${suffix}`;
      await db.insert(oauthIdentitiesTable).values({
        userId: constraintUserA.id, provider: "facebook", providerAccountId: sharedProviderAccountId, providerEmail: constraintEmail,
      });
      await assert.rejects(
        () => db.insert(oauthIdentitiesTable).values({
          userId: constraintUserB.id, provider: "facebook", providerAccountId: sharedProviderAccountId, providerEmail: constraintEmail,
        }),
        (error: unknown) => {
          const code = typeof error === "object" && error !== null && "cause" in error
            && typeof error.cause === "object" && error.cause !== null && "code" in error.cause
            ? String(error.cause.code)
            : undefined;
          assert.equal(code, "23505", "expected a Postgres unique-violation (23505) from oauth_identities_provider_account_unique");
          return true;
        },
        "the database must refuse a second user claiming the same (provider, providerAccountId)",
      );
    }

    console.log("Facebook OAuth account-linking safety regression passed.");
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (userIds.length) {
      await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
      await db.delete(oauthIdentitiesTable).where(inArray(oauthIdentitiesTable.userId, userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
    await db.delete(oauthLoginStatesTable).where(inArray(oauthLoginStatesTable.state, states));
    await db.delete(integrationSettingsTable).where(inArray(integrationSettingsTable.integration, integrationNames));
    if (previousIntegrationRows.length) await db.insert(integrationSettingsTable).values(previousIntegrationRows);

    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = previousNodeEnv;
    if (previousAppBaseUrl === undefined) delete process.env["APP_BASE_URL"]; else process.env["APP_BASE_URL"] = previousAppBaseUrl;
    if (previousFacebookAppId === undefined) delete process.env["FACEBOOK_APP_ID"]; else process.env["FACEBOOK_APP_ID"] = previousFacebookAppId;
    if (previousFacebookAppSecret === undefined) delete process.env["FACEBOOK_APP_SECRET"]; else process.env["FACEBOOK_APP_SECRET"] = previousFacebookAppSecret;
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
