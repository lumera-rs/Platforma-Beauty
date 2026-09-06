/**
 * Task #11B: Google OAuth account-linking safety regression.
 *
 * Task #7A already closed this exact class of bug for Facebook: an unlinked
 * provider identity whose profile email matches an existing local account
 * used to silently authenticate as -- and permanently attach itself to --
 * that account. Facebook was fixed because its Graph API /me response
 * carries no verified-email signal this application can check, so a fresh
 * attacker-controlled Facebook profile could simply *claim* the victim's
 * email. Google's OIDC userinfo response DOES carry a verified-email
 * signal (resolveOAuthProfile in marketplace.ts already requires
 * email_verified === true before returning a profile at all), so the
 * original #7A fix deliberately left Google's silent-link-by-email path
 * untouched, reasoning that Google itself vouches for the address.
 *
 * That reasoning protects against email *spoofing*, but not against a
 * mailbox that has genuinely changed real-world ownership: addresses get
 * abandoned, recycled by their provider, or reclaimed by someone else
 * through Google's own account-recovery flow -- no application
 * vulnerability required. Google's per-request "yes, this really is the
 * current controller of this address" guarantee says nothing about whether
 * that controller is still the same person who created the local LUMERA
 * account. For a platform whose accounts include salon-owner and
 * education-center business identities, that gap is exactly the kind of
 * "identity ownership changed, but the application assumes continuity"
 * problem #7A already closed for Facebook -- so Task #11B applies the same
 * rule to Google: an unlinked Google identity whose email matches an
 * existing local account must sign in through an already-trusted method
 * first and link Google from account settings, never authenticate directly
 * into that account.
 *
 * The fix (marketplace.ts) generalizes the #7A guard from
 * `existingByEmail && provider === "facebook"` to `existingByEmail`
 * (any provider), renaming the internal error code from
 * oauth_facebook_email_collision to oauth_email_collision and making the
 * user-facing message name whichever provider was actually attempted.
 *
 * This file mirrors social-oauth-facebook-account-linking-safety.test.ts
 * scenario-for-scenario where applicable, plus Task #11B-specific coverage
 * for: a genuinely Google-specific verified-email edge case, cross-provider
 * collisions, the authenticated "link" flow (backward compatibility for
 * existing explicitly-linked accounts), and same-state callback replay.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/social-oauth-google-account-linking-safety.test.ts
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import { db, integrationSettingsTable, oauthIdentitiesTable, oauthLoginStatesTable, sessionsTable, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";

type HttpResponse = { status: number; location?: string; setCookie: string[]; body: string };
type GoogleProfileResult =
  | { kind: "profile"; sub: string; email?: string; emailVerified?: boolean; givenName?: string; familyName?: string }
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
  const origin = `https://google-linking-safety-${suffix}.example.test`;
  const host = new URL(origin).host;
  const integrationNames = ["google_oauth", "facebook_oauth"] as const;
  const previousNodeEnv = process.env["NODE_ENV"];
  const previousAppBaseUrl = process.env["APP_BASE_URL"];
  const previousGoogleClientId = process.env["GOOGLE_CLIENT_ID"];
  const previousGoogleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const previousIntegrationRows = await db.select().from(integrationSettingsTable)
    .where(inArray(integrationSettingsTable.integration, integrationNames));

  process.env["NODE_ENV"] = "test";
  process.env["APP_BASE_URL"] = origin;
  process.env["GOOGLE_CLIENT_ID"] = `google-linking-app-${suffix}`;
  process.env["GOOGLE_CLIENT_SECRET"] = `google-linking-secret-${suffix}`;
  await db.delete(integrationSettingsTable).where(inArray(integrationSettingsTable.integration, integrationNames));

  const states: string[] = [];
  const userIds: string[] = [];
  const userInfoResponses = new Map<string, GoogleProfileResult>();

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token") {
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : "";
      const code = new URLSearchParams(body).get("code") ?? "";
      // The access token IS the authorization code in this fixture -- lets
      // each scenario control exactly which userinfo response its callback
      // sees by keying userInfoResponses off the code it supplies.
      return new Response(JSON.stringify({ access_token: code }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      const headerBag = (init?.headers ?? {}) as Record<string, string> | Headers;
      const bearer = headerBag instanceof Headers
        ? headerBag.get("authorization") ?? ""
        : (headerBag["authorization"] ?? "");
      const accessToken = bearer.replace(/^Bearer\s+/i, "");
      const result = userInfoResponses.get(accessToken);
      if (!result || result.kind === "error") {
        return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        sub: result.sub,
        ...(result.email !== undefined ? { email: result.email } : {}),
        email_verified: result.emailVerified ?? true,
        given_name: result.givenName ?? "Google",
        family_name: result.familyName ?? "Test",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected outbound request in Google account-linking safety test: ${url}`);
  }) as typeof fetch;

  app.set("trust proxy", 1);
  const server = app.listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const start = async (flow: "customer" | "business" | "link" = "customer", cookie?: string) => {
      const response = await requestWithHost(port, `/api/auth/oauth/google/start?flow=${flow}`, { host, cookie });
      assert.equal(response.status, 302);
      const state = new URL(response.location!).searchParams.get("state")!;
      states.push(state);
      return { state, cookie: stateCookie(response.setCookie) };
    };

    const callback = (state: string, cookie: string, code: string, extraCookie?: string) =>
      requestWithHost(port, `/api/auth/oauth/google/callback?${new URLSearchParams({ state, code }).toString()}`, {
        host,
        cookie: extraCookie ? `${cookie}; ${extraCookie}` : cookie,
      });

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

    // --- Scenario 1: account takeover attempt. Existing local account +
    // brand-new, never-before-linked Google identity + the SAME email
    // (Google reports it as verified, exactly as a genuine mailbox
    // takeover/reclaim would) => must NOT authenticate as the victim, must
    // NOT attach the identity, no session, victim's own row untouched.
    {
      const victimEmail = `google-safety-victim-${suffix}@example.test`;
      const victim = await createLocalUser(victimEmail);
      const attackerCode = `google-attacker-code-${suffix}`;
      userInfoResponses.set(attackerCode, { kind: "profile", sub: `google-attacker-account-${suffix}`, email: victimEmail, emailVerified: true, givenName: "Attacker", familyName: "Evil" });

      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, attackerCode);

      assert.equal(response.status, 302);
      expectedOauthError(response.location,
        "Nalog sa ovom e-mail adresom već postoji. Prijavite se lozinkom ili prethodno povezanim nalogom, pa dodajte Google prijavu iz podešavanja naloga.");
      assert.equal(sessionToken(response.setCookie), undefined, "the rejected collision must not set a session cookie");

      const victimIdentities = await db.select().from(oauthIdentitiesTable).where(eq(oauthIdentitiesTable.userId, victim.id));
      assert.equal(victimIdentities.length, 0, "the victim account must gain no Google identity from the rejected attempt");

      const attackerIdentity = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "google"), eq(oauthIdentitiesTable.providerAccountId, `google-attacker-account-${suffix}`)));
      assert.equal(attackerIdentity.length, 0, "no oauth_identities row must exist for the attacker's Google id at all");

      const victimRow = await db.select().from(usersTable).where(eq(usersTable.id, victim.id)).limit(1);
      assert.equal(victimRow[0]?.email, victimEmail, "the victim's own account row must be untouched");

      const sessions = await db.select().from(sessionsTable).where(eq(sessionsTable.userId, victim.id));
      assert.equal(sessions.length, 0, "no session may be created for the victim");

      const consumedState = await db.select().from(oauthLoginStatesTable).where(eq(oauthLoginStatesTable.state, attempt.state));
      assert.equal(consumedState.length, 0, "the rejected attempt's one-time state must still be consumed, like every other callback failure");
    }

    // --- Scenario 2: conflicting identities across providers. A victim
    // account already has Facebook linked; a brand-new, unlinked Google
    // identity presenting the same email must be rejected exactly the same
    // way -- the collision guard is per-account, not per-(account,provider).
    {
      const victimEmail = `google-safety-cross-provider-${suffix}@example.test`;
      const victim = await createLocalUser(victimEmail);
      await db.insert(oauthIdentitiesTable).values({
        userId: victim.id, provider: "facebook", providerAccountId: `fb-existing-${suffix}`, providerEmail: victimEmail,
      });
      const attackerCode = `google-cross-provider-code-${suffix}`;
      userInfoResponses.set(attackerCode, { kind: "profile", sub: `google-cross-provider-account-${suffix}`, email: victimEmail, emailVerified: true });

      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, attackerCode);
      assert.equal(response.status, 302);
      expectedOauthError(response.location,
        "Nalog sa ovom e-mail adresom već postoji. Prijavite se lozinkom ili prethodno povezanim nalogom, pa dodajte Google prijavu iz podešavanja naloga.");
      assert.equal(sessionToken(response.setCookie), undefined);

      const identities = await db.select().from(oauthIdentitiesTable).where(eq(oauthIdentitiesTable.userId, victim.id));
      assert.equal(identities.length, 1, "the victim must still have exactly the one Facebook identity it started with");
      assert.equal(identities[0]?.provider, "facebook");
    }

    // --- Scenario 3-4: already-linked Google identity resolves by provider
    // id alone -- login succeeds even when the Google email changes, and a
    // second sign-in with the SAME identity never creates a duplicate
    // account. This is the "existing explicitly-linked Google accounts /
    // backward compatibility" case: it must be completely unaffected by the
    // new collision guard, since resolution here never falls through to the
    // by-email lookup at all.
    let linkedUser: typeof usersTable.$inferSelect;
    const linkedProviderAccountId = `google-linked-account-${suffix}`;
    {
      const originalEmail = `google-safety-linked-${suffix}@example.test`;
      linkedUser = await createLocalUser(originalEmail);
      await db.insert(oauthIdentitiesTable).values({
        userId: linkedUser.id, provider: "google", providerAccountId: linkedProviderAccountId, providerEmail: originalEmail,
      });

      const legitimateCode = `google-legit-login-code-${suffix}`;
      userInfoResponses.set(legitimateCode, { kind: "profile", sub: linkedProviderAccountId, email: originalEmail, emailVerified: true });
      const legitAttempt = await start();
      const legitResponse = await callback(legitAttempt.state, legitAttempt.cookie, legitimateCode);
      assert.equal(legitResponse.status, 302);
      assert.match(legitResponse.location ?? "", /^\/prijava\?oauth_created=1/);
      const legitToken = sessionToken(legitResponse.setCookie);
      assert.ok(legitToken, "a legitimately linked Google identity must still authenticate");
      assert.equal(await sessionUserId(legitToken), linkedUser.id);

      const changedEmailCode = `google-changed-email-code-${suffix}`;
      const changedEmail = `google-safety-linked-new-email-${suffix}@example.test`;
      userInfoResponses.set(changedEmailCode, { kind: "profile", sub: linkedProviderAccountId, email: changedEmail, emailVerified: true });
      const changedAttempt = await start();
      const changedResponse = await callback(changedAttempt.state, changedAttempt.cookie, changedEmailCode);
      assert.equal(changedResponse.status, 302);
      assert.match(changedResponse.location ?? "", /^\/prijava\?oauth_created=1/);
      const changedToken = sessionToken(changedResponse.setCookie);
      assert.ok(changedToken, "a changed Google email must not block login for an already-linked identity");
      assert.equal(await sessionUserId(changedToken), linkedUser.id, "identity resolution must still be the SAME local account, never a new one");

      const noNewUserForChangedEmail = await db.select().from(usersTable).where(eq(usersTable.email, changedEmail));
      assert.equal(noNewUserForChangedEmail.length, 0, "a changed Google email must not create a second account");

      const identityRows = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "google"), eq(oauthIdentitiesTable.providerAccountId, linkedProviderAccountId)));
      assert.equal(identityRows.length, 1, "the provider identity row must not be duplicated");
      assert.equal(identityRows[0]?.userId, linkedUser.id, "the provider identity must still point at the original account");
    }

    // --- Scenario 5: Google-specific edge case. An already-linked identity
    // whose CURRENT userinfo response reports email_verified: false (Google
    // itself no longer vouches for the address, e.g. re-verification
    // pending) must be rejected by resolveOAuthProfile's existing check --
    // documented here as pre-existing, untouched behavior, not a regression
    // from this fix: the account stays safe either way.
    {
      const unverifiedCode = `google-unverified-linked-code-${suffix}`;
      userInfoResponses.set(unverifiedCode, { kind: "profile", sub: linkedProviderAccountId, email: `google-safety-linked-${suffix}@example.test`, emailVerified: false });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, unverifiedCode);
      assert.equal(response.status, 302);
      expectedOauthError(response.location, "Nismo mogli da potvrdimo nalog kod provajdera.");
      assert.equal(sessionToken(response.setCookie), undefined, "an unverified email must never fall back to an authenticated session");
    }

    // --- Scenario 6: brand-new provider id + genuinely unused, verified
    // email => legitimate first-time Google registration must keep
    // working. This is the "new users" case the fix must not break.
    {
      const newEmail = `google-safety-new-user-${suffix}@example.test`;
      const newProviderAccountId = `google-new-account-${suffix}`;
      const newUserCode = `google-new-user-code-${suffix}`;
      userInfoResponses.set(newUserCode, { kind: "profile", sub: newProviderAccountId, email: newEmail, emailVerified: true, givenName: "Brand", familyName: "New" });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, newUserCode);
      assert.equal(response.status, 302);
      assert.match(response.location ?? "", /^\/prijava\?oauth_created=1/);
      const token = sessionToken(response.setCookie);
      assert.ok(token, "a genuinely new Google identity with an unused, verified email must still be able to register");
      const newUserId = await sessionUserId(token);
      assert.ok(newUserId);
      userIds.push(newUserId!);
      const [createdUser] = await db.select().from(usersTable).where(eq(usersTable.id, newUserId!)).limit(1);
      assert.equal(createdUser?.email, newEmail);
      const identity = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "google"), eq(oauthIdentitiesTable.providerAccountId, newProviderAccountId)));
      assert.equal(identity.length, 1);
      assert.equal(identity[0]?.userId, newUserId);
    }

    // --- Scenario 7: unverified email for an UNLINKED identity => safe
    // failure, no account created, no session (pre-existing behavior).
    {
      const unlinkedUnverifiedCode = `google-unlinked-unverified-code-${suffix}`;
      userInfoResponses.set(unlinkedUnverifiedCode, { kind: "profile", sub: `google-unlinked-unverified-account-${suffix}`, email: `google-unlinked-unverified-${suffix}@example.test`, emailVerified: false });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, unlinkedUnverifiedCode);
      assert.equal(response.status, 302);
      expectedOauthError(response.location, "Nismo mogli da potvrdimo nalog kod provajdera.");
      assert.equal(sessionToken(response.setCookie), undefined);
      const identity = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "google"), eq(oauthIdentitiesTable.providerAccountId, `google-unlinked-unverified-account-${suffix}`)));
      assert.equal(identity.length, 0);
    }

    // --- Scenario 8: case-normalized existing-email collision cannot
    // bypass the protection.
    {
      const victimEmail = `google-safety-case-victim-${suffix}@example.test`;
      const victim = await createLocalUser(victimEmail);
      const mixedCaseEmail = `Google-Safety-Case-Victim-${suffix}@Example.Test`;
      assert.notEqual(mixedCaseEmail, victimEmail);
      const attackerCode = `google-case-attacker-code-${suffix}`;
      userInfoResponses.set(attackerCode, { kind: "profile", sub: `google-case-attacker-account-${suffix}`, email: mixedCaseEmail, emailVerified: true });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, attackerCode);
      assert.equal(response.status, 302);
      expectedOauthError(response.location,
        "Nalog sa ovom e-mail adresom već postoji. Prijavite se lozinkom ili prethodno povezanim nalogom, pa dodajte Google prijavu iz podešavanja naloga.");
      assert.equal(sessionToken(response.setCookie), undefined);
      const duplicateAccounts = await db.select().from(usersTable).where(eq(usersTable.email, mixedCaseEmail.toLowerCase()));
      assert.equal(duplicateAccounts.length, 1, "no duplicate/second account may be created for the case-varied email");
      assert.equal(duplicateAccounts[0]?.id, victim.id);
    }

    // --- Scenario 9: an inactive/deactivated local account cannot be
    // revived merely through Google OAuth. Identity-based resolution still
    // finds the row (it does not check `active`, matching how the rest of
    // this branch always worked), but the resulting session can never
    // actually authenticate anything because getCurrentUser() already
    // requires active = true for every session lookup app-wide.
    {
      const inactiveEmail = `google-safety-inactive-${suffix}@example.test`;
      const inactiveUser = await createLocalUser(inactiveEmail, { active: false });
      const inactiveProviderAccountId = `google-inactive-account-${suffix}`;
      await db.insert(oauthIdentitiesTable).values({
        userId: inactiveUser.id, provider: "google", providerAccountId: inactiveProviderAccountId, providerEmail: inactiveEmail,
      });
      const inactiveCode = `google-inactive-login-code-${suffix}`;
      userInfoResponses.set(inactiveCode, { kind: "profile", sub: inactiveProviderAccountId, email: inactiveEmail, emailVerified: true });
      const attempt = await start();
      const response = await callback(attempt.state, attempt.cookie, inactiveCode);
      const token = sessionToken(response.setCookie);

      if (token) {
        const meResponse = await requestWithHost(port, "/api/auth/me", { host, cookie: `lumera_session=${token}` });
        const body = JSON.parse(meResponse.body) as { user: unknown };
        assert.equal(body.user, null, "a session bound to a deactivated account must never resolve to an authenticated user");
      }
    }

    // --- Scenario 10 / concurrency: one Google provider identity can never
    // end up linked to two different local accounts, even when two
    // callbacks for the SAME brand-new identity race each other.
    {
      const raceEmail = `google-safety-race-${suffix}@example.test`;
      const raceProviderAccountId = `google-race-account-${suffix}`;
      const raceCodeA = `google-race-code-a-${suffix}`;
      const raceCodeB = `google-race-code-b-${suffix}`;
      userInfoResponses.set(raceCodeA, { kind: "profile", sub: raceProviderAccountId, email: raceEmail, emailVerified: true, givenName: "Race", familyName: "A" });
      userInfoResponses.set(raceCodeB, { kind: "profile", sub: raceProviderAccountId, email: raceEmail, emailVerified: true, givenName: "Race", familyName: "B" });

      const attemptA = await start();
      const attemptB = await start();
      const [responseA, responseB] = await Promise.all([
        callback(attemptA.state, attemptA.cookie, raceCodeA),
        callback(attemptB.state, attemptB.cookie, raceCodeB),
      ]);

      const raceUsers = await db.select().from(usersTable).where(eq(usersTable.email, raceEmail));
      assert.equal(raceUsers.length, 1, "a concurrent race for the same new Google identity must never create two accounts");
      userIds.push(raceUsers[0]!.id);

      const raceIdentities = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "google"), eq(oauthIdentitiesTable.providerAccountId, raceProviderAccountId)));
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

    // --- Scenario 11 / repeated callbacks (replay): resubmitting the exact
    // same state+code a second time must never authenticate twice, create a
    // duplicate account, or duplicate the provider identity row -- the
    // one-time login state is already deleted by the first successful
    // callback, so the replay must fail safely.
    {
      const replayEmail = `google-safety-replay-${suffix}@example.test`;
      const replayProviderAccountId = `google-replay-account-${suffix}`;
      const replayCode = `google-replay-code-${suffix}`;
      userInfoResponses.set(replayCode, { kind: "profile", sub: replayProviderAccountId, email: replayEmail, emailVerified: true });

      const attempt = await start();
      const firstResponse = await callback(attempt.state, attempt.cookie, replayCode);
      assert.equal(firstResponse.status, 302);
      assert.match(firstResponse.location ?? "", /^\/prijava\?oauth_created=1/);
      const firstToken = sessionToken(firstResponse.setCookie);
      assert.ok(firstToken, "the first, legitimate callback must succeed");
      const firstUserId = await sessionUserId(firstToken);
      assert.ok(firstUserId);
      userIds.push(firstUserId!);

      const replayResponse = await callback(attempt.state, attempt.cookie, replayCode);
      assert.equal(replayResponse.status, 302);
      expectedOauthError(replayResponse.location, "Prijava je istekla. Pokušajte ponovo.");
      assert.equal(sessionToken(replayResponse.setCookie), undefined, "a replayed callback must never mint a second session");

      const replayUsers = await db.select().from(usersTable).where(eq(usersTable.email, replayEmail));
      assert.equal(replayUsers.length, 1, "a replayed callback must never create a duplicate account");
      const replayIdentities = await db.select().from(oauthIdentitiesTable)
        .where(and(eq(oauthIdentitiesTable.provider, "google"), eq(oauthIdentitiesTable.providerAccountId, replayProviderAccountId)));
      assert.equal(replayIdentities.length, 1, "a replayed callback must never duplicate the provider identity row");
    }

    // --- Scenario 12 / backward compatibility: the authenticated "link"
    // flow (an already-logged-in user adding Google from account settings)
    // is untouched by this fix -- it never goes through the by-email
    // lookup at all, only through (provider, providerAccountId).
    {
      const settingsEmail = `google-safety-settings-link-${suffix}@example.test`;
      const settingsUser = await createLocalUser(settingsEmail);
      const settingsCookie = `${sessionCookieName}=${await createSession(settingsUser.id)}`;
      const settingsProviderAccountId = `google-settings-link-account-${suffix}`;
      const settingsCode = `google-settings-link-code-${suffix}`;
      // Deliberately a DIFFERENT email than the local account's -- proves
      // the "link" flow trusts the authenticated session, not the OAuth
      // profile's email, to decide which account is being linked.
      userInfoResponses.set(settingsCode, { kind: "profile", sub: settingsProviderAccountId, email: `google-settings-link-provider-email-${suffix}@example.test`, emailVerified: true });

      const attempt = await start("link", settingsCookie);
      const response = await callback(attempt.state, attempt.cookie, settingsCode, settingsCookie);
      assert.equal(response.status, 302);
      assert.equal(response.location, "/moj-nalog?tab=settings&oauth=linked&provider=google");

      const identities = await db.select().from(oauthIdentitiesTable).where(eq(oauthIdentitiesTable.userId, settingsUser.id));
      assert.equal(identities.length, 1);
      assert.equal(identities[0]?.provider, "google");
      assert.equal(identities[0]?.providerAccountId, settingsProviderAccountId);
    }

    // --- Scenario 13 / conflicting identities in the "link" flow: linking a
    // Google identity that is ALREADY linked to a DIFFERENT local account
    // must be rejected, not silently reassigned.
    {
      const ownerEmail = `google-safety-link-owner-${suffix}@example.test`;
      const owner = await createLocalUser(ownerEmail);
      const contestedProviderAccountId = `google-contested-account-${suffix}`;
      await db.insert(oauthIdentitiesTable).values({
        userId: owner.id, provider: "google", providerAccountId: contestedProviderAccountId, providerEmail: ownerEmail,
      });

      const otherEmail = `google-safety-link-other-${suffix}@example.test`;
      const other = await createLocalUser(otherEmail);
      const otherCookie = `${sessionCookieName}=${await createSession(other.id)}`;
      const contestedCode = `google-contested-code-${suffix}`;
      userInfoResponses.set(contestedCode, { kind: "profile", sub: contestedProviderAccountId, email: ownerEmail, emailVerified: true });

      const attempt = await start("link", otherCookie);
      const response = await callback(attempt.state, attempt.cookie, contestedCode, otherCookie);
      assert.equal(response.status, 302);
      expectedOauthError(response.location, "Ovaj identitet je već povezan sa drugim LUMERA nalogom ili nije moguće povezivanje.");

      const otherIdentities = await db.select().from(oauthIdentitiesTable).where(eq(oauthIdentitiesTable.userId, other.id));
      assert.equal(otherIdentities.length, 0, "the contested identity must not be reassigned to the second account");
      const ownerIdentities = await db.select().from(oauthIdentitiesTable).where(eq(oauthIdentitiesTable.userId, owner.id));
      assert.equal(ownerIdentities.length, 1, "the original owner must keep the identity");
    }

    // --- DB constraint documentation: one provider identity can never be
    // linked to two local accounts, enforced by oauth_identities'
    // (provider, providerAccountId) unique index -- not something this fix
    // needs to reimplement in application code.
    {
      const constraintEmail = `google-safety-constraint-${suffix}@example.test`;
      const constraintUserA = await createLocalUser(constraintEmail);
      const constraintUserB = await createLocalUser(`google-safety-constraint-b-${suffix}@example.test`);
      const sharedProviderAccountId = `google-constraint-account-${suffix}`;
      await db.insert(oauthIdentitiesTable).values({
        userId: constraintUserA.id, provider: "google", providerAccountId: sharedProviderAccountId, providerEmail: constraintEmail,
      });
      await assert.rejects(
        () => db.insert(oauthIdentitiesTable).values({
          userId: constraintUserB.id, provider: "google", providerAccountId: sharedProviderAccountId, providerEmail: constraintEmail,
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

    console.log("Google OAuth account-linking safety regression passed.");
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
    if (previousGoogleClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"]; else process.env["GOOGLE_CLIENT_ID"] = previousGoogleClientId;
    if (previousGoogleClientSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"]; else process.env["GOOGLE_CLIENT_SECRET"] = previousGoogleClientSecret;
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
