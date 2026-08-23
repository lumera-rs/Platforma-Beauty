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
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/webhook-registration-verification.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, integrationSettingsTable, pool, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { resolveWebhookSecret } from "./provider-events";
import { integrationSettings, saveIntegrationSettings } from "./integrations";
import { listBrevoTransactionalWebhooks } from "./brevo";

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
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The route derives the deployment origin from the admin request itself
  // (protocol + host), so for this suite the expected origin IS the test
  // server's own base URL.
  const origin = baseUrl;
  const expectedHint = `${origin}/api/webhooks/brevo/<tajna>`;

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
    const verify = async (cookie?: string) => {
      const response = await realFetch(`${baseUrl}/api/admin/integrations/brevo/verify-registration`, {
        method: "POST",
        ...(cookie ? { headers: { cookie } } : {}),
      });
      const raw = await response.text();
      responseBodies.push(raw);
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* non-JSON body */ }
      return { status: response.status, raw, body };
    };
    const errorOf = (result: { body: Record<string, unknown> | null }) => String(result.body?.["error"] ?? "");

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
        { id: 11, url: "https://a.example/api/webhooks/brevo/tok" },
        { id: 12, url: 42 }, { url: "https://no-id.example/hook" }, { id: "13", url: "https://bad-id.example/hook" },
        { notUrl: true }, null, "junk", {},
      ] });
      assert.deepEqual(bare, [{ id: 11, url: "https://a.example/api/webhooks/brevo/tok" }],
        "bare-array shape yields only entries with a numeric id and string url");

      const wrapped = await listWith({ status: 200, body: { webhooks: [
        { id: 21, url: "https://b.example/hook" }, { id: 22, url: "https://c.example/hook" }, { id: 23, url: false },
      ] } });
      assert.deepEqual(wrapped, [{ id: 21, url: "https://b.example/hook" }, { id: 22, url: "https://c.example/hook" }],
        "{webhooks: []} shape yields its entries");

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
      brevoStub = { status: 200, body: [{ id: 101, url: exactUrl }] };
      const bareShape = await verify(adminCookie);
      assert.equal(bareShape.status, 200, `exact match must succeed (got: ${bareShape.raw})`);
      assert.ok(String(bareShape.body?.["message"]).includes("Webhook je registrovan na Brevo"),
        "exact match reports the healthy verdict");

      brevoStub = { status: 200, body: { webhooks: [{ id: 102, url: exactUrl }] } };
      const wrappedShape = await verify(adminCookie);
      assert.equal(wrappedShape.status, 200, "exact match must also be found in the {webhooks: []} shape");

      brevoStub = { status: 200, body: [{ id: 103, url: `${exactUrl}/` }] };
      const trailingSlash = await verify(adminCookie);
      assert.equal(trailingSlash.status, 200, "trailing slash on the registered URL still matches");

      // Providers may echo the token percent-encoded; the check must decode
      // before the timing-safe comparison. (Only constructible for printable
      // ASCII secrets — true for the env fallback and typical saved secrets.)
      if (/^[\x21-\x7e]+$/.test(secret)) {
        const encodedToken = [...secret]
          .map((ch) => `%${ch.codePointAt(0)!.toString(16).padStart(2, "0")}`).join("");
        brevoStub = { status: 200, body: [{ id: 104, url: `${origin}/api/webhooks/brevo/${encodedToken}` }] };
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
        { id: 116, url: exactUrl },
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

    // ── 12. The saved secret never appeared in ANY response body ───────────
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
