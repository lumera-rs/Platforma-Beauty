/**
 * Brevo webhook registration check — regression suite
 *
 * The admin "Proveri registraciju na Brevo" check classifies the provider's
 * registered transactional webhooks into five verdicts: exact match, right
 * secret / wrong domain, right domain / stale secret, unrelated LUMERA-format
 * webhook, and not registered. A regression in URL parsing, origin
 * normalization, the timing-safe token comparison, Brevo's 404-means-empty
 * behavior, or the {webhooks: []} vs bare-array response shapes would tell
 * admins their webhook is fine when it is not — or tell them to re-register a
 * working one.
 *
 * Live Brevo cannot be exercised in tests, so this suite intercepts the
 * outbound provider call (https://api.brevo.com/v3/webhooks) and simulates
 * provider listings, verifying:
 *   1. listBrevoTransactionalWebhooks handles both response shapes, the
 *      404-empty case, malformed bodies, and provider errors
 *   2. every classification branch of the verify-registration route,
 *      including precedence between branches, URL-decoding of the token,
 *      trailing slashes, and filtering of non-LUMERA / unparseable URLs
 *   3. the saved secret (and any provider-side token) never appears in any
 *      response body — only masked URLs and the <tajna> placeholder
 *   4. local configuration errors (integration disabled, missing secret)
 *      surface their own message instead of a wrapped provider error
 *   5. cross-origin verdicts: browsing from a development/preview address
 *      (.replit.dev, localhost) must never instruct re-registering a healthy
 *      production webhook for the dev URL — the current-secret-elsewhere case
 *      reads as the production registration, failure instructions name the
 *      published-domain placeholder, and the webhook-url copy helper carries
 *      a warning; REPLIT_DOMAINS entries count as this deployment's origins
 *
 * The suite talks to the local test server but spoofs the Host header (and
 * X-Forwarded-Proto, honored via trust proxy) per request, so verdicts can be
 * exercised for both a production-looking origin and a dev-preview origin.
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/webhook-registration-verification.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, integrationSettingsTable, pool, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { resolveWebhookSecret } from "./provider-events";
import { integrationSettings, saveIntegrationSettings } from "./integrations";
import { BREVO_WEBHOOK_EVENTS, listBrevoTransactionalWebhooks } from "./brevo";

const suffix = randomUUID().slice(0, 8);
const cleanup = { userIds: [] as string[] };

// ---------------------------------------------------------------------------
// Brevo API interception: every listing request the app makes is answered by
// the currently configured stub; all other fetches pass through untouched.
// ---------------------------------------------------------------------------

const BREVO_LISTING_URL = "https://api.brevo.com/v3/webhooks?type=transactional";
type BrevoStub = { status: number; body?: unknown; text?: string };
let brevoStub: BrevoStub | null = null;
let brevoCalls = 0;

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.brevo.com/")) {
    brevoCalls += 1;
    assert.equal(url, BREVO_LISTING_URL, "registration check must query transactional webhooks only");
    assert.ok(brevoStub, `unexpected Brevo API call (no stub configured): ${url}`);
    const stub = brevoStub;
    return new Response(stub.text ?? JSON.stringify(stub.body ?? null), {
      status: stub.status,
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function run() {
  app.set("trust proxy", 1);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  // The route derives the deployment origin from the admin request itself
  // (protocol + host). The suite spoofs the Host header (fetch forbids that,
  // so requests go through node:http) and X-Forwarded-Proto (trust proxy is
  // enabled) to simulate browsing origins: a production-looking domain for
  // the strict verdicts and a .replit.dev preview domain for the softened
  // development verdicts.
  const prodHost = `lumera-prod-${suffix}.example.com`;
  const devHost = `wrv-${suffix}.riker.replit.dev`;
  const origin = `https://${prodHost}`;
  const devOrigin = `https://${devHost}`;
  const expectedHint = `${origin}/api/webhooks/brevo/<tajna>`;
  const publishedHint = "https://<domen-objavljene-aplikacije>/api/webhooks/brevo/<tajna>";
  const fullEvents = [...BREVO_WEBHOOK_EVENTS];

  const requestWithHost = (path: string, options: { method?: string; host?: string; cookie?: string }) =>
    new Promise<{ status: number; raw: string }>((resolve, reject) => {
      const req = httpRequest({
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          host: options.host ?? prodHost,
          "x-forwarded-proto": "https",
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      }, (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { raw += chunk; });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, raw }));
      });
      req.on("error", reject);
      req.end();
    });

  // Snapshot the brevo integration_settings rows so the enabled-flag
  // manipulation below can restore the exact prior state.
  const priorRows = await db.select().from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.integration, "brevo"));
  const hadRows = priorRows.length > 0;
  const priorEnabled = hadRows ? priorRows[0]!.enabled : true;

  // Force the direct-fetch provider path (intercepted above) even when no
  // admin-configured apiKey exists, and make sure a webhook secret resolves.
  process.env["BREVO_API_KEY"] ??= `wrv-fake-api-key-${suffix}`;

  try {
    // ── Fixtures: admin (route requires it) + non-admin for access control ──
    const [admin] = await db.insert(usersTable).values({
      firstName: "Admin", lastName: "WRV",
      email: `wrv-admin-${suffix}@bg.test`, passwordHash: await hashPassword(`wrv-admin-${suffix}`),
      passwordSetAt: new Date(), role: "ADMIN",
    }).returning();
    const [customer] = await db.insert(usersTable).values({
      firstName: "Kupac", lastName: "WRV",
      email: `wrv-customer-${suffix}@bg.test`, passwordHash: await hashPassword(`wrv-customer-${suffix}`),
      passwordSetAt: new Date(), role: "CUSTOMER",
    }).returning();
    assert.ok(admin && customer);
    cleanup.userIds.push(admin.id, customer.id);
    const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
    const customerCookie = `${sessionCookieName}=${await createSession(customer.id)}`;

    const responseBodies: string[] = [];
    const verify = async (cookie?: string, host?: string) => {
      const { status, raw } = await requestWithHost("/api/admin/integrations/brevo/verify-registration", {
        method: "POST", cookie, host,
      });
      responseBodies.push(raw);
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* non-JSON body */ }
      return { status, raw, body };
    };
    const errorOf = (result: { body: Record<string, unknown> | null }) => String(result.body?.["error"] ?? "");
    const messageOf = (result: { body: Record<string, unknown> | null }) => String(result.body?.["message"] ?? "");

    // ── 1. Missing secret → its own 400 message, no provider contact ───────
    // (Runs before the suite pins an env fallback secret; only assertable
    // when no admin-configured database webhookSecret exists.)
    {
      const savedSecret = process.env["BREVO_WEBHOOK_SECRET"];
      delete process.env["BREVO_WEBHOOK_SECRET"];
      try {
        if (!(await resolveWebhookSecret("brevo"))) {
          brevoStub = null; // any provider call would fail the interceptor assert
          const callsBefore = brevoCalls;
          const missing = await verify(adminCookie);
          assert.equal(missing.status, 400, "missing secret must be a local 400");
          assert.ok(errorOf(missing).includes("Webhook tajna nije sačuvana"),
            `missing secret surfaces its own instruction (got: ${missing.raw})`);
          assert.ok(!errorOf(missing).includes("Spisak webhook-ova"),
            "missing secret must not be wrapped in a provider-error message");
          assert.equal(brevoCalls, callsBefore, "missing secret must never contact Brevo");
          console.log("✓ missing webhook secret surfaces its own message without contacting Brevo");
        } else {
          console.log("• missing-secret branch skipped (database webhookSecret configured)");
        }
      } finally {
        if (savedSecret !== undefined) process.env["BREVO_WEBHOOK_SECRET"] = savedSecret;
      }
    }

    // Deterministic secret for the rest of the suite (env fallback, unless an
    // admin-configured database webhookSecret takes precedence — the suite
    // then uses that resolved value everywhere).
    process.env["BREVO_WEBHOOK_SECRET"] ??= `wrv-secret-${suffix}`;
    const secret = await resolveWebhookSecret("brevo");
    assert.ok(secret, "webhook secret must resolve for the classification suite");
    const exactUrl = `${origin}/api/webhooks/brevo/${encodeURIComponent(secret)}`;

    // Classification tests need the integration enabled; restore afterwards.
    if (hadRows && !priorEnabled) {
      await db.update(integrationSettingsTable).set({ enabled: true })
        .where(eq(integrationSettingsTable.integration, "brevo"));
    }
    assert.ok((await integrationSettings("brevo")).enabled, "brevo integration must be enabled for listing tests");

    // ── 2. Provider listing parsing: both shapes, 404-empty, malformed ─────
    {
      const listWith = async (stub: BrevoStub) => {
        brevoStub = stub;
        try { return await listBrevoTransactionalWebhooks(); } finally { brevoStub = null; }
      };

      const bare = await listWith({ status: 200, body: [
        { id: 11, url: "https://a.example/api/webhooks/brevo/tok", events: ["delivered", 42, "opened"] },
        { id: 12, url: 42 }, { url: "https://no-id.example/hook" }, { id: "13", url: "https://bad-id.example/hook" },
        { notUrl: true }, null, "junk", {},
      ] });
      assert.deepEqual(bare, [{ id: 11, url: "https://a.example/api/webhooks/brevo/tok", events: ["delivered", "opened"] }],
        "bare-array shape yields only entries with a numeric id and string url; non-string events filtered");

      const wrapped = await listWith({ status: 200, body: { webhooks: [
        { id: 21, url: "https://b.example/hook", events: ["delivered"] }, { id: 22, url: "https://c.example/hook" }, { id: 23, url: false },
      ] } });
      assert.deepEqual(wrapped, [{ id: 21, url: "https://b.example/hook", events: ["delivered"] }, { id: 22, url: "https://c.example/hook", events: [] }],
        "{webhooks: []} shape yields its entries (missing events degrade to an empty list)");

      assert.deepEqual(await listWith({ status: 404, body: { code: "document_not_found" } }), [],
        "Brevo 404 means no webhooks registered — an empty list, not an error");
      assert.deepEqual(await listWith({ status: 200, body: { unexpected: 1 } }), [],
        "unrecognized body shape degrades to an empty list");
      assert.deepEqual(await listWith({ status: 200, text: "this is not json" }), [],
        "non-JSON body degrades to an empty list");

      await assert.rejects(
        () => listWith({ status: 500, text: "boom" }),
        (error: unknown) => error instanceof Error && /Brevo 500/.test(error.message),
        "provider errors other than 404 must throw",
      );
      console.log("✓ listing parses both Brevo response shapes; 404 is empty; provider errors throw");
    }

    // ── 3. Access control ───────────────────────────────────────────────────
    {
      brevoStub = { status: 200, body: [] };
      const anonymous = await verify();
      assert.equal(anonymous.status, 401, "anonymous registration check rejected");
      const nonAdmin = await verify(customerCookie);
      assert.equal(nonAdmin.status, 403, "non-admin registration check rejected");
      console.log("✓ registration check is admin-only");
    }

    // ── 4. Exact match (both response shapes, trailing slash, %-encoding) ──
    {
      brevoStub = { status: 200, body: [{ id: 101, url: exactUrl, events: fullEvents }] };
      const bareShape = await verify(adminCookie);
      assert.equal(bareShape.status, 200, `exact match must succeed (got: ${bareShape.raw})`);
      assert.ok(String(bareShape.body?.["message"]).includes("Webhook je registrovan na Brevo"),
        "exact match reports the healthy verdict");
      assert.ok(!messageOf(bareShape).includes("razvojn"),
        "production-origin success carries no development caveat");

      brevoStub = { status: 200, body: { webhooks: [{ id: 102, url: exactUrl, events: fullEvents }] } };
      const wrappedShape = await verify(adminCookie);
      assert.equal(wrappedShape.status, 200, "exact match must also be found in the {webhooks: []} shape");

      brevoStub = { status: 200, body: [{ id: 103, url: `${exactUrl}/`, events: fullEvents }] };
      const trailingSlash = await verify(adminCookie);
      assert.equal(trailingSlash.status, 200, "trailing slash on the registered URL still matches");

      // Providers may echo the token percent-encoded; the check must decode
      // before the timing-safe comparison. (Only constructible for printable
      // ASCII secrets — true for the env fallback and typical saved secrets.)
      if (/^[\x21-\x7e]+$/.test(secret)) {
        const encodedToken = [...secret]
          .map((ch) => `%${ch.codePointAt(0)!.toString(16).padStart(2, "0")}`).join("");
        brevoStub = { status: 200, body: [{ id: 104, url: `${origin}/api/webhooks/brevo/${encodedToken}`, events: fullEvents }] };
        const encoded = await verify(adminCookie);
        assert.equal(encoded.status, 200, "percent-encoded token must be decoded before comparison");
      }
      console.log("✓ exact match recognized in both shapes, with trailing slash and %-encoded token");
    }

    // ── 5. Right secret / wrong domain ──────────────────────────────────────
    {
      brevoStub = { status: 200, body: [{ id: 105, url: `https://stara-domena.example.com/api/webhooks/brevo/${encodeURIComponent(secret)}` }] };
      const wrongDomain = await verify(adminCookie);
      assert.equal(wrongDomain.status, 409);
      assert.ok(errorOf(wrongDomain).includes("registrovan za drugi domen"),
        `wrong-domain verdict expected (got: ${wrongDomain.raw})`);
      assert.ok(errorOf(wrongDomain).includes("https://stara-domena.example.com/api/webhooks/brevo/…"),
        "foreign registration is reported with the token masked");
      assert.ok(errorOf(wrongDomain).includes(expectedHint),
        "re-registration instruction names this deployment's URL with the <tajna> placeholder");
      console.log("✓ right secret at a wrong domain → re-register verdict with masked URL");
    }

    // ── 6. Right domain / stale secret (incl. undecodable token) ───────────
    {
      brevoStub = { status: 200, body: [{ id: 106, url: `${origin}/api/webhooks/brevo/${encodeURIComponent(`${secret}x`)}` }] };
      const stale = await verify(adminCookie);
      assert.equal(stale.status, 409);
      assert.ok(errorOf(stale).includes("zastarelom tajnom"),
        `stale-secret verdict expected (got: ${stale.raw})`);
      assert.ok(!stale.raw.includes(`${secret}x`), "the stale provider token is never echoed back");
      assert.ok(errorOf(stale).includes(expectedHint), "update instruction carries the placeholder URL");

      // A token with invalid percent-encoding cannot be decoded; the check
      // must fall back to the raw comparison instead of crashing.
      brevoStub = { status: 200, body: [{ id: 107, url: `${origin}/api/webhooks/brevo/%GG` }] };
      const undecodable = await verify(adminCookie);
      assert.equal(undecodable.status, 409, "undecodable token must not crash the check");
      assert.ok(errorOf(undecodable).includes("zastarelom tajnom"),
        "undecodable token at this domain reads as a stale secret");
      console.log("✓ stale secret at this domain → update verdict; undecodable tokens handled");
    }

    // ── 7. Unrelated LUMERA-format webhook ──────────────────────────────────
    {
      const foreignToken = `tudja-tajna-${suffix}`;
      brevoStub = { status: 200, body: [{ id: 108, url: `https://druga-app.example.net/api/webhooks/brevo/${foreignToken}` }] };
      const unrelated = await verify(adminCookie);
      assert.equal(unrelated.status, 409);
      assert.ok(errorOf(unrelated).includes("ni domen ni tajna"),
        `unrelated-webhook verdict expected (got: ${unrelated.raw})`);
      assert.ok(errorOf(unrelated).includes("https://druga-app.example.net/api/webhooks/brevo/…"),
        "unrelated registration is reported with the token masked");
      assert.ok(!unrelated.raw.includes(foreignToken), "the foreign token is never echoed back");
      console.log("✓ unrelated LUMERA-format webhook → mismatch verdict with masked URL");
    }

    // ── 8. Not registered: empty, 404, and non-candidate listings ──────────
    {
      const notRegisteredWith = async (stub: BrevoStub, label: string) => {
        brevoStub = stub;
        const result = await verify(adminCookie);
        assert.equal(result.status, 409, `${label}: expected 409 (got: ${result.raw})`);
        assert.ok(errorOf(result).includes("Webhook nije registrovan na Brevo"),
          `${label}: not-registered verdict expected (got: ${result.raw})`);
        assert.ok(errorOf(result).includes(expectedHint), `${label}: registration instruction present`);
      };
      await notRegisteredWith({ status: 200, body: [] }, "empty bare array");
      await notRegisteredWith({ status: 200, body: { webhooks: [] } }, "empty {webhooks: []}");
      await notRegisteredWith({ status: 404, body: { code: "document_not_found" } }, "Brevo 404");
      // Non-LUMERA, unparseable, wrong-provider and nested paths are all
      // filtered out — they must not distort the verdict in either direction.
      await notRegisteredWith({ status: 200, body: [
        { id: 109, url: "https://marketing.example.com/some/other/hook" },
        { id: 110, url: "not a url at all" },
        { id: 111, url: `${origin}/api/webhooks/infobip/${encodeURIComponent(secret)}` },
        { id: 112, url: `${origin}/api/webhooks/brevo/${encodeURIComponent(secret)}/extra` },
        { id: 113, url: `${origin}/api/webhooks/brevo/` },
      ] }, "only non-candidate URLs");
      console.log("✓ empty listings, Brevo 404 and non-candidate URLs → not-registered verdict");
    }

    // ── 9. Branch precedence within a mixed listing ─────────────────────────
    {
      // Exact match wins over every complaint.
      brevoStub = { status: 200, body: [
        { id: 114, url: `${origin}/api/webhooks/brevo/stale-token` },
        { id: 115, url: `https://stara-domena.example.com/api/webhooks/brevo/${encodeURIComponent(secret)}` },
        { id: 116, url: exactUrl, events: fullEvents },
      ] };
      const healthy = await verify(adminCookie);
      assert.equal(healthy.status, 200, "an exact match anywhere in the listing wins");

      // Without an exact match, the current secret elsewhere outranks a stale
      // secret here (the admin's action differs: move the URL vs fix the token).
      brevoStub = { status: 200, body: [
        { id: 117, url: `${origin}/api/webhooks/brevo/stale-token` },
        { id: 118, url: `https://stara-domena.example.com/api/webhooks/brevo/${encodeURIComponent(secret)}` },
      ] };
      const moved = await verify(adminCookie);
      assert.equal(moved.status, 409);
      assert.ok(errorOf(moved).includes("registrovan za drugi domen"),
        "current secret at another domain outranks the stale-secret verdict");
      console.log("✓ verdict precedence: exact match > wrong domain > stale secret");
    }

    // ── 10. Provider errors stay wrapped as provider errors ────────────────
    {
      brevoStub = { status: 500, text: "internal error" };
      const providerError = await verify(adminCookie);
      assert.equal(providerError.status, 502);
      assert.ok(errorOf(providerError).includes("Spisak webhook-ova nije učitan"),
        `provider failure must use the wrapped message (got: ${providerError.raw})`);
      assert.ok(errorOf(providerError).includes("Brevo 500"), "wrapped message carries the provider status");
      console.log("✓ provider API failures are reported as wrapped provider errors (502)");
    }

    // ── 11. Integration disabled → its own message, no provider contact ────
    {
      brevoStub = null; // any provider call would fail the interceptor assert
      const callsBefore = brevoCalls;
      if (hadRows) {
        await db.update(integrationSettingsTable).set({ enabled: false })
          .where(eq(integrationSettingsTable.integration, "brevo"));
      } else {
        // Creates only the __enabled marker row; removed again in cleanup.
        await saveIntegrationSettings({ integration: "brevo", enabled: false, values: {}, updatedByUserId: admin.id });
      }
      try {
        const disabled = await verify(adminCookie);
        assert.equal(disabled.status, 400, `disabled integration must be a local 400 (got: ${disabled.raw})`);
        assert.ok(errorOf(disabled).includes("Brevo integracija je isključena"),
          "disabled integration surfaces its own instruction");
        assert.ok(!errorOf(disabled).includes("Spisak webhook-ova"),
          "disabled integration must not be wrapped in a provider-error message");
        assert.equal(brevoCalls, callsBefore, "disabled integration must never contact Brevo");
      } finally {
        // Immediately restore the enabled flag (full row restore in cleanup).
        await db.update(integrationSettingsTable).set({ enabled: true })
          .where(eq(integrationSettingsTable.integration, "brevo"));
      }
      console.log("✓ disabled integration surfaces its own message without contacting Brevo");
    }

    // ── 12. Development preview origin: healthy production webhook is never
    //        called wrong, and no instruction pushes the dev URL ─────────────
    {
      const prodRegisteredUrl = `${origin}/api/webhooks/brevo/${encodeURIComponent(secret)}`;

      // A registration carrying the CURRENT secret at another (production)
      // domain, checked from the dev preview → recognized, not an error.
      brevoStub = { status: 200, body: [{ id: 130, url: prodRegisteredUrl, events: fullEvents }] };
      const recognized = await verify(adminCookie, devHost);
      assert.equal(recognized.status, 200,
        `healthy production webhook must not be called wrong from the dev preview (got: ${recognized.raw})`);
      assert.ok(messageOf(recognized).includes(`${origin}/api/webhooks/brevo/…`),
        "recognized production registration is reported with the token masked");
      assert.ok(messageOf(recognized).includes("razvojne adrese"),
        "verdict says it was run from the development address");
      assert.ok(messageOf(recognized).includes("nemojte je ponovo registrovati za razvojnu adresu"),
        "verdict explicitly warns against re-registering for the dev address");
      assert.ok(!recognized.raw.includes(`${devOrigin}/api/webhooks`),
        "no dev-origin webhook URL is suggested anywhere");

      // Same case but the production registration misses events → the
      // origin-independent events warning still fires.
      brevoStub = { status: 200, body: [{ id: 131, url: prodRegisteredUrl, events: ["delivered"] }] };
      const partialEvents = await verify(adminCookie, devHost);
      assert.equal(partialEvents.status, 409);
      assert.ok(errorOf(partialEvents).includes("ne prati sve potrebne događaje"),
        `missing-events warning expected from dev preview too (got: ${partialEvents.raw})`);
      assert.ok(!errorOf(partialEvents).includes("registrovan za drugi domen"),
        "dev preview never reports a wrong-domain verdict for the current secret");

      // Exact match at the DEV origin itself → success, but flagged as a
      // development-address registration.
      brevoStub = { status: 200, body: [{ id: 132, url: `${devOrigin}/api/webhooks/brevo/${encodeURIComponent(secret)}`, events: fullEvents }] };
      const devRegistered = await verify(adminCookie, devHost);
      assert.equal(devRegistered.status, 200);
      assert.ok(messageOf(devRegistered).includes("pokazuje na razvojnu adresu"),
        `dev-origin registration success must carry the development caveat (got: ${devRegistered.raw})`);

      // Unrelated registration (e.g. production webhook whose secret differs
      // from the DEV environment's saved secret) → still a complaint, but the
      // instruction names the published-domain placeholder, never the dev URL,
      // and the verdict is qualified as relative to the browsing address.
      brevoStub = { status: 200, body: [{ id: 133, url: `${origin}/api/webhooks/brevo/produkciona-tajna-${suffix}` }] };
      const unrelatedFromDev = await verify(adminCookie, devHost);
      assert.equal(unrelatedFromDev.status, 409);
      assert.ok(errorOf(unrelatedFromDev).includes(publishedHint),
        `instruction must name the published-domain placeholder (got: ${unrelatedFromDev.raw})`);
      assert.ok(!unrelatedFromDev.raw.includes(`${devOrigin}/api/webhooks`),
        "instruction must never name the dev-origin webhook URL");
      assert.ok(errorOf(unrelatedFromDev).includes("razvojne adrese"),
        "verdict is qualified as relative to the development address");

      // Not registered at all, checked from dev → same qualification.
      brevoStub = { status: 200, body: [] };
      const notRegisteredFromDev = await verify(adminCookie, devHost);
      assert.equal(notRegisteredFromDev.status, 409);
      assert.ok(errorOf(notRegisteredFromDev).includes(publishedHint) && !notRegisteredFromDev.raw.includes(`${devOrigin}/api/webhooks`),
        "not-registered instruction from dev names the published-domain placeholder only");
      assert.ok(errorOf(notRegisteredFromDev).includes("razvojne adrese"),
        "not-registered verdict from dev is qualified as relative to the browsing address");

      // localhost counts as a development address too.
      brevoStub = { status: 200, body: [{ id: 134, url: prodRegisteredUrl, events: fullEvents }] };
      const fromLocalhost = await verify(adminCookie, "localhost:5000");
      assert.equal(fromLocalhost.status, 200,
        `localhost browsing must also recognize the production registration (got: ${fromLocalhost.raw})`);
      console.log("✓ dev-preview browsing: production webhook recognized, dev URL never suggested");
    }

    // ── 13. REPLIT_DOMAINS entries count as this deployment's origins ──────
    {
      const altDomain = `alt-lumera-${suffix}.example.org`;
      const priorDomains = process.env["REPLIT_DOMAINS"];
      process.env["REPLIT_DOMAINS"] = ` ${altDomain} , not a domain `;
      try {
        // Admin browses one production domain; the webhook is registered for
        // another public domain of the SAME deployment (REPLIT_DOMAINS).
        brevoStub = { status: 200, body: [{ id: 140, url: `https://${altDomain}/api/webhooks/brevo/${encodeURIComponent(secret)}`, events: fullEvents }] };
        const crossDomain = await verify(adminCookie);
        assert.equal(crossDomain.status, 200,
          `registration on a sibling deployment domain must be healthy (got: ${crossDomain.raw})`);
        assert.ok(!messageOf(crossDomain).includes("razvojn"),
          "sibling-domain success is a plain healthy verdict");
      } finally {
        if (priorDomains === undefined) delete process.env["REPLIT_DOMAINS"];
        else process.env["REPLIT_DOMAINS"] = priorDomains;
      }
      console.log("✓ webhook registered for a REPLIT_DOMAINS sibling domain reads as healthy");
    }

    // ── 14. Webhook-url copy helper warns from a development address ───────
    // (These responses intentionally contain the secret-bearing URL for the
    // admin to copy, so they are NOT added to the leak-scan corpus below.)
    {
      const fromProd = await requestWithHost("/api/admin/integrations/brevo/webhook-url", { cookie: adminCookie });
      assert.equal(fromProd.status, 200, `webhook-url from production origin (got: ${fromProd.raw})`);
      const prodBody = JSON.parse(fromProd.raw) as Record<string, unknown>;
      assert.ok(String(prodBody["url"]).startsWith(`${origin}/api/webhooks/brevo/`),
        "copy helper builds the URL from the browsing origin");
      assert.equal(prodBody["warning"], undefined, "no warning when browsing from a production origin");

      const fromDev = await requestWithHost("/api/admin/integrations/brevo/webhook-url", { cookie: adminCookie, host: devHost });
      assert.equal(fromDev.status, 200);
      const devBody = JSON.parse(fromDev.raw) as Record<string, unknown>;
      assert.ok(String(devBody["url"]).startsWith(`${devOrigin}/api/webhooks/brevo/`),
        "dev copy helper still returns the URL for the browsing origin");
      assert.ok(String(devBody["warning"] ?? "").includes("razvojnu adresu"),
        `dev copy helper must warn that the URL carries the development address (got: ${fromDev.raw})`);
      assert.ok(String(devBody["warning"] ?? "").includes("objavljene aplikacije"),
        "warning points the admin at the published application for the production URL");
      console.log("✓ webhook-url copy helper warns when the URL carries the development address");
    }

    // ── 15. The saved secret never appeared in ANY response body ───────────
    {
      assert.ok(responseBodies.length >= 15, "the suite must have exercised the route");
      for (const raw of responseBodies) {
        assert.ok(!raw.includes(secret), `saved secret leaked into a response body: ${raw}`);
        assert.ok(!raw.includes(encodeURIComponent(secret)), "URL-encoded secret leaked into a response body");
      }
      console.log(`✓ saved secret absent from all ${responseBodies.length} response bodies (masked URLs only)`);
    }

    console.log("\n✅ All webhook registration verification tests passed");
  } finally {
    server.close();
    globalThis.fetch = realFetch;
    // Restore the exact prior integration_settings state for 'brevo'.
    if (hadRows) {
      await db.update(integrationSettingsTable).set({ enabled: priorEnabled })
        .where(eq(integrationSettingsTable.integration, "brevo"));
      if (!priorRows.some((row) => row.settingKey === "__enabled")) {
        await db.delete(integrationSettingsTable).where(and(
          eq(integrationSettingsTable.integration, "brevo"),
          eq(integrationSettingsTable.settingKey, "__enabled"),
        ));
      }
    } else {
      await db.delete(integrationSettingsTable).where(and(
        eq(integrationSettingsTable.integration, "brevo"),
        eq(integrationSettingsTable.settingKey, "__enabled"),
      ));
    }
    if (cleanup.userIds.length) {
      await db.delete(usersTable).where(inArray(usersTable.id, cleanup.userIds));
    }
    await pool.end();
  }
}

run().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
