/**
 * Brevo stale webhook cleanup — regression suite
 *
 * After a successful one-click registration ("Registruj webhook"), leftover
 * LUMERA-format registrations at Brevo (old domains, old secrets) keep
 * receiving events that are rejected or lost. The repair response now lists
 * those stale duplicates (masked URLs only) and the cleanup route
 * (POST /admin/integrations/brevo/cleanup-webhooks) deletes them via Brevo's
 * DELETE /v3/webhooks/{id}.
 *
 * The safety properties this suite locks down:
 *   1. after a successful repair OR registration check, staleWebhooks lists
 *      exactly the stale LUMERA-format duplicates — never the freshly repaired
 *      registration and never non-LUMERA webhooks — with tokens masked
 *   2. the cleanup deletes ONLY ids that a FRESH provider listing still
 *      classifies as stale: requested ids pointing at the healthy
 *      registration, non-LUMERA webhooks, or unknown ids are skipped, and no
 *      DELETE is ever issued for them
 *   3. from a development/preview address the stale list is suppressed and
 *      the cleanup is refused outright (the dev secret may differ from
 *      production's, so a healthy production registration would be misread
 *      as stale)
 *   4. partial provider failures report what was removed and what was not
 *      (502), already-deleted webhooks (Brevo 404) count as removed, and a
 *      second cleanup run is a polite no-op
 *   5. the saved secret (or any provider-side token) never appears in any
 *      response body — masked URLs only; all outcomes are in Serbian
 *
 * Live Brevo cannot be exercised, so the suite intercepts every outbound
 * https://api.brevo.com/v3/webhooks* call with an in-memory webhook store
 * that supports GET (list), POST (create), PUT (update) and DELETE.
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/brevo-stale-webhook-cleanup.test.ts
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
import { integrationSettings } from "./integrations";
import { BREVO_WEBHOOK_EVENTS } from "./brevo";

const suffix = randomUUID().slice(0, 8);
const cleanup = { userIds: [] as string[] };

// ---------------------------------------------------------------------------
// Brevo API interception: an in-memory transactional-webhook store answering
// GET /v3/webhooks?type=transactional, POST /v3/webhooks, PUT and DELETE
// /v3/webhooks/{id}. All other fetches pass through untouched.
// ---------------------------------------------------------------------------

type StoredWebhook = { id: number; url: string; events: string[] };
let webhookStore: StoredWebhook[] = [];
let nextWebhookId = 1000;
const deleteCalls: number[] = [];
/** Per-id override for the DELETE response status (default 204 + removal). */
const deleteStatusOverride = new Map<number, number>();

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api.brevo.com/")) return realFetch(input, init);
  const method = (init?.method ?? "GET").toUpperCase();
  const parsed = new URL(url);
  assert.ok(parsed.pathname.startsWith("/v3/webhooks"), `unexpected Brevo API path: ${parsed.pathname}`);
  const idMatch = /^\/v3\/webhooks\/(\d+)$/.exec(parsed.pathname);

  if (method === "GET") {
    return Response.json({ webhooks: webhookStore.map((hook) => ({ ...hook })) });
  }
  if (method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { url?: string; events?: string[] };
    webhookStore.push({ id: nextWebhookId++, url: String(body.url), events: body.events ?? [] });
    return Response.json({ id: nextWebhookId - 1 }, { status: 201 });
  }
  if (method === "PUT" && idMatch) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { url?: string; events?: string[] };
    const target = webhookStore.find((hook) => hook.id === Number(idMatch[1]));
    assert.ok(target, `PUT for unknown webhook id ${idMatch[1]}`);
    target.url = String(body.url);
    target.events = body.events ?? [];
    return new Response(null, { status: 204 });
  }
  if (method === "DELETE" && idMatch) {
    const id = Number(idMatch[1]);
    deleteCalls.push(id);
    const override = deleteStatusOverride.get(id);
    if (override !== undefined) {
      return new Response(JSON.stringify({ code: "error" }), { status: override });
    }
    webhookStore = webhookStore.filter((hook) => hook.id !== id);
    return new Response(null, { status: 204 });
  }
  throw new Error(`unexpected Brevo API call: ${method} ${url}`);
}) as typeof fetch;

async function run() {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const prodHost = `lumera-cleanup-${suffix}.example.com`;
  const devHost = `swc-${suffix}.riker.replit.dev`;
  const origin = `https://${prodHost}`;
  const fullEvents = [...BREVO_WEBHOOK_EVENTS];

  const requestWithHost = (path: string, options: { method?: string; host?: string; cookie?: string; body?: unknown }) =>
    new Promise<{ status: number; raw: string; body: Record<string, unknown> | null }>((resolve, reject) => {
      const payload = options.body === undefined ? null : JSON.stringify(options.body);
      const req = httpRequest({
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          host: options.host ?? prodHost,
          "x-forwarded-proto": "https",
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
      }, (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { raw += chunk; });
        response.on("end", () => {
          let body: Record<string, unknown> | null = null;
          try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* non-JSON body */ }
          resolve({ status: response.statusCode ?? 0, raw, body });
        });
      });
      req.on("error", reject);
      req.end(payload ?? undefined);
    });

  // Snapshot brevo integration settings so the suite can force-enable and
  // restore the exact prior state afterwards.
  const priorRows = await db.select().from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.integration, "brevo"));
  const hadRows = priorRows.length > 0;
  const priorEnabled = hadRows ? priorRows[0]!.enabled : true;

  // Force the direct-fetch provider path (intercepted above) and a
  // deterministic webhook secret fallback.
  process.env["BREVO_API_KEY"] ??= `swc-fake-api-key-${suffix}`;
  process.env["BREVO_WEBHOOK_SECRET"] ??= `swc-secret-${suffix}`;

  try {
    const [admin] = await db.insert(usersTable).values({
      firstName: "Admin", lastName: "SWC",
      email: `swc-admin-${suffix}@bg.test`, passwordHash: await hashPassword(`swc-admin-${suffix}`),
      passwordSetAt: new Date(), role: "ADMIN",
    }).returning();
    const [customer] = await db.insert(usersTable).values({
      firstName: "Kupac", lastName: "SWC",
      email: `swc-customer-${suffix}@bg.test`, passwordHash: await hashPassword(`swc-customer-${suffix}`),
      passwordSetAt: new Date(), role: "CUSTOMER",
    }).returning();
    assert.ok(admin && customer);
    cleanup.userIds.push(admin.id, customer.id);
    const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
    const customerCookie = `${sessionCookieName}=${await createSession(customer.id)}`;

    if (hadRows && !priorEnabled) {
      await db.update(integrationSettingsTable).set({ enabled: true })
        .where(eq(integrationSettingsTable.integration, "brevo"));
    }
    assert.ok((await integrationSettings("brevo")).enabled, "brevo integration must be enabled for this suite");
    const secret = await resolveWebhookSecret("brevo");
    assert.ok(secret, "webhook secret must resolve");
    const encodedSecret = encodeURIComponent(secret);

    const responseBodies: string[] = [];
    const post = async (path: string, options: { cookie?: string; host?: string; body?: unknown } = {}) => {
      const result = await requestWithHost(path, { method: "POST", ...options });
      responseBodies.push(result.raw);
      return result;
    };
    const get = async (path: string, options: { cookie?: string; host?: string } = {}) => {
      const result = await requestWithHost(path, { method: "GET", ...options });
      responseBodies.push(result.raw);
      return result;
    };
    const staleOf = (result: { body: Record<string, unknown> | null }) =>
      (result.body?.["staleWebhooks"] ?? null) as Array<{ id: number; maskedUrl: string }> | null;

    const nonLumeraId = 1;
    const sameOriginStaleSecretId = 2;
    const oldDomainCurrentSecretId = 3;
    const oldDomainOldSecretId = 4;
    const resetStore = () => {
      webhookStore = [
        { id: nonLumeraId, url: "https://marketing.example.com/some/other/hook", events: ["delivered"] },
        { id: sameOriginStaleSecretId, url: `${origin}/api/webhooks/brevo/stara-tajna-${suffix}`, events: ["delivered"] },
        { id: oldDomainCurrentSecretId, url: `https://stara-domena.example.com/api/webhooks/brevo/${encodedSecret}`, events: fullEvents },
        { id: oldDomainOldSecretId, url: `https://jos-starija.example.net/api/webhooks/brevo/prastara-tajna-${suffix}`, events: [] },
      ];
      deleteCalls.length = 0;
      deleteStatusOverride.clear();
    };

    // ── 1. Access control ────────────────────────────────────────────────────
    {
      resetStore();
      const anonymous = await post("/api/admin/integrations/brevo/cleanup-webhooks", { body: { ids: [2] } });
      assert.equal(anonymous.status, 401, "anonymous cleanup rejected");
      const nonAdmin = await post("/api/admin/integrations/brevo/cleanup-webhooks", { cookie: customerCookie, body: { ids: [2] } });
      assert.equal(nonAdmin.status, 403, "non-admin cleanup rejected");
      assert.deepEqual(deleteCalls, [], "unauthorized requests never reach the provider");
      console.log("✓ cleanup is admin-only");
    }

    // ── 2. Successful repair lists exactly the stale LUMERA duplicates ──────
    {
      resetStore();
      const repaired = await post("/api/admin/integrations/brevo/register-webhook", { cookie: adminCookie });
      assert.equal(repaired.status, 200, `one-click repair must succeed (got: ${repaired.raw})`);
      // Same-origin candidate is chosen for the in-place update, so after the
      // repair it IS the healthy registration and must not be listed.
      const stale = staleOf(repaired);
      assert.ok(stale, "successful repair must carry a staleWebhooks list");
      assert.deepEqual(stale!.map((hook) => hook.id).sort(), [oldDomainCurrentSecretId, oldDomainOldSecretId],
        `stale list contains exactly the old-domain leftovers (got: ${repaired.raw})`);
      assert.ok(stale!.every((hook) => hook.maskedUrl.endsWith("/api/webhooks/brevo/…")),
        "stale entries carry masked URLs only");
      assert.ok(String(repaired.body?.["message"]).includes("zaostale LUMERA registracije (2)"),
        `Serbian message announces the stale duplicates (got: ${repaired.raw})`);
      assert.ok(!stale!.some((hook) => hook.id === nonLumeraId), "non-LUMERA webhooks are never listed");
      console.log("✓ repair response lists exactly the stale LUMERA duplicates, masked, in Serbian");
    }

    // ── 3. Registration check also lists the same stale duplicates ──────────
    {
      resetStore();
      const failedCheck = await post("/api/admin/integrations/brevo/verify-registration", { cookie: adminCookie });
      assert.equal(failedCheck.status, 409, `stale-only registration check must report a conflict (got: ${failedCheck.raw})`);
      const staleOnly = staleOf(failedCheck);
      assert.ok(staleOnly, "conflicting registration check must carry a staleWebhooks list");
      assert.deepEqual(staleOnly!.map((hook) => hook.id).sort(), [sameOriginStaleSecretId, oldDomainCurrentSecretId, oldDomainOldSecretId],
        `conflicting registration check contains every stale LUMERA registration (got: ${failedCheck.raw})`);
      assert.equal(failedCheck.body?.["code"], "CONFLICT",
        "conflicting registration check keeps a structured error contract so the stale list survives normalization");
      assert.ok(staleOnly!.every((hook) => hook.maskedUrl.endsWith("/api/webhooks/brevo/…")),
        "conflicting registration-check entries carry masked URLs only");

      const repaired = await post("/api/admin/integrations/brevo/register-webhook", { cookie: adminCookie });
      assert.equal(repaired.status, 200, `setup repair must succeed (got: ${repaired.raw})`);

      const checked = await post("/api/admin/integrations/brevo/verify-registration", { cookie: adminCookie });
      assert.equal(checked.status, 200, `registration check must succeed (got: ${checked.raw})`);
      const stale = staleOf(checked);
      assert.ok(stale, "registration check must carry a staleWebhooks list");
      assert.deepEqual(stale!.map((hook) => hook.id).sort(), [oldDomainCurrentSecretId, oldDomainOldSecretId],
        `registration check contains exactly the stale duplicates (got: ${checked.raw})`);
      assert.ok(stale!.every((hook) => hook.maskedUrl.endsWith("/api/webhooks/brevo/…")),
        "registration-check stale entries carry masked URLs only");
      assert.ok(String(checked.body?.["message"]).includes("Webhook je registrovan na Brevo"),
        `registration check reports the healthy verdict (got: ${checked.raw})`);

      const refreshed = await get("/api/admin/integrations/brevo/stale-webhooks", { cookie: adminCookie });
      assert.equal(refreshed.status, 200, `stale-list refresh must succeed (got: ${refreshed.raw})`);
      assert.deepEqual(staleOf(refreshed)?.map((hook) => hook.id).sort(), [oldDomainCurrentSecretId, oldDomainOldSecretId],
        `stale-list refresh uses the same classification as registration check (got: ${refreshed.raw})`);
      assert.ok(staleOf(refreshed)?.every((hook) => hook.maskedUrl.endsWith("/api/webhooks/brevo/…")),
        "stale-list refresh carries masked URLs only");

      const refreshedFromDev = await get("/api/admin/integrations/brevo/stale-webhooks", {
        cookie: adminCookie, host: `swc-${suffix}.riker.replit.dev`,
      });
      assert.equal(refreshedFromDev.status, 200, `stale-list refresh from dev must succeed (got: ${refreshedFromDev.raw})`);
      assert.deepEqual(staleOf(refreshedFromDev), [], "stale-list refresh suppresses stale entries from development origins");
      console.log("✓ registration check also lists exactly the stale LUMERA duplicates");
    }

    // ── 4. Cleanup deletes only stale ids; healthy/non-LUMERA/unknown skipped ─
    {
      // Ask for everything, including the healthy registration (2), the
      // non-LUMERA webhook (1) and an unknown id — only 3 and 4 may go.
      const result = await post("/api/admin/integrations/brevo/cleanup-webhooks", {
        cookie: adminCookie,
        body: { ids: [nonLumeraId, sameOriginStaleSecretId, oldDomainCurrentSecretId, oldDomainOldSecretId, 99999] },
      });
      assert.equal(result.status, 200, `cleanup must succeed (got: ${result.raw})`);
      assert.deepEqual([...deleteCalls].sort(), [oldDomainCurrentSecretId, oldDomainOldSecretId],
        "DELETE issued for exactly the stale duplicates — never the fresh registration or non-LUMERA webhooks");
      assert.deepEqual((result.body?.["removedIds"] as number[]).sort(), [oldDomainCurrentSecretId, oldDomainOldSecretId]);
      assert.deepEqual(staleOf(result), [], "no stale registrations remain after the cleanup");
      assert.ok(String(result.body?.["message"]).includes("Uklonjene su zaostale registracije sa Brevo (2)"),
        `Serbian success message (got: ${result.raw})`);
      assert.ok(String(result.body?.["message"]).includes("Preskočeno: 3"),
        "message reports the skipped non-stale ids");
      assert.ok(webhookStore.some((hook) => hook.id === nonLumeraId), "non-LUMERA webhook untouched at the provider");
      assert.ok(webhookStore.some((hook) => hook.id === sameOriginStaleSecretId), "fresh registration untouched at the provider");
      console.log("✓ cleanup removes only stale duplicates; healthy, non-LUMERA and unknown ids are skipped");
    }

    // ── 5. Second run is a polite no-op ──────────────────────────────────────
    {
      deleteCalls.length = 0;
      const again = await post("/api/admin/integrations/brevo/cleanup-webhooks", {
        cookie: adminCookie,
        body: { ids: [oldDomainCurrentSecretId, oldDomainOldSecretId] },
      });
      assert.equal(again.status, 200);
      assert.ok(String(again.body?.["message"]).includes("više nije zaostala"),
        `repeat cleanup reads as a no-op (got: ${again.raw})`);
      assert.deepEqual(deleteCalls, [], "no DELETE issued when nothing is stale");
      console.log("✓ repeat cleanup is a no-op without provider deletes");
    }

    // ── 6. Invalid bodies rejected locally ──────────────────────────────────
    {
      deleteCalls.length = 0;
      for (const body of [undefined, {}, { ids: [] }, { ids: ["3"] }, { ids: [3.5] }]) {
        const invalid = await post("/api/admin/integrations/brevo/cleanup-webhooks", { cookie: adminCookie, body });
        assert.equal(invalid.status, 400, `invalid ids must be a local 400 (body: ${JSON.stringify(body)}, got: ${invalid.raw})`);
        assert.ok(String(invalid.body?.["error"]).includes("Izaberite bar jednu"), "Serbian validation message");
      }
      assert.deepEqual(deleteCalls, [], "invalid requests never reach the provider");
      console.log("✓ invalid id payloads are rejected locally in Serbian");
    }

    // ── 7. Development address: stale list suppressed, cleanup refused ──────
    {
      resetStore();
      const checkedFromDev = await post("/api/admin/integrations/brevo/verify-registration", { cookie: adminCookie, host: devHost });
      assert.equal(checkedFromDev.status, 200, `registration check from dev must use the softened verdict (got: ${checkedFromDev.raw})`);
      assert.deepEqual(staleOf(checkedFromDev) ?? [], [],
        "registration-check stale list is suppressed from a development address");

      const repairedFromDev = await post("/api/admin/integrations/brevo/register-webhook", { cookie: adminCookie, host: devHost });
      if (repairedFromDev.status === 200) {
        assert.deepEqual(staleOf(repairedFromDev) ?? [], [],
          "stale list is suppressed from a development address (production registrations could be misread as stale)");
      } else {
        // The one-click repair itself may refuse development origins; the
        // suppression property is then enforced by the refusal.
        console.log("• repair from dev refused by the route — stale-list suppression via refusal");
      }

      deleteCalls.length = 0;
      const refused = await post("/api/admin/integrations/brevo/cleanup-webhooks", {
        cookie: adminCookie, host: devHost, body: { ids: [oldDomainCurrentSecretId] },
      });
      assert.equal(refused.status, 400, `cleanup from dev must be refused (got: ${refused.raw})`);
      assert.ok(String(refused.body?.["error"]).includes("razvojne adrese"),
        "refusal names the development address");
      assert.ok(String(refused.body?.["error"]).includes("objavljene aplikacije"),
        "refusal points at the published application");
      assert.deepEqual(deleteCalls, [], "refused dev cleanup never reaches the provider");
      console.log("✓ development address: stale list suppressed and cleanup refused before any provider call");
    }

    // ── 8. Partial failures reported; provider 404 counts as removed ────────
    {
      resetStore();
      // Repair from production so 3 and 4 are stale again (store was reset,
      // id 2 holds a stale token again and gets updated in place).
      const repaired = await post("/api/admin/integrations/brevo/register-webhook", { cookie: adminCookie });
      assert.equal(repaired.status, 200);

      deleteCalls.length = 0;
      deleteStatusOverride.set(oldDomainCurrentSecretId, 500); // provider failure
      deleteStatusOverride.set(oldDomainOldSecretId, 404);     // already gone at Brevo
      const partial = await post("/api/admin/integrations/brevo/cleanup-webhooks", {
        cookie: adminCookie, body: { ids: [oldDomainCurrentSecretId, oldDomainOldSecretId] },
      });
      assert.equal(partial.status, 502, `partial failure must be a 502 (got: ${partial.raw})`);
      assert.deepEqual(partial.body?.["removedIds"], [oldDomainOldSecretId],
        "Brevo 404 (already deleted) counts as removed");
      assert.ok(String(partial.body?.["error"]).includes("Uklonjeno je 1 od 2"),
        `partial outcome reported in Serbian (got: ${partial.raw})`);
      assert.ok(String(partial.body?.["error"]).includes("https://stara-domena.example.com/api/webhooks/brevo/…"),
        "failed deletion is reported with the token masked");
      const remaining = (partial.body?.["staleWebhooks"] as Array<{ id: number }>).map((hook) => hook.id);
      assert.deepEqual(remaining, [oldDomainCurrentSecretId], "the failed id stays in the stale list for a retry");

      // Retry succeeds once the provider recovers.
      deleteStatusOverride.clear();
      // The 404-deleted webhook is still in the interceptor store (the 404
      // override skipped removal) — drop it manually to mimic "already gone".
      webhookStore = webhookStore.filter((hook) => hook.id !== oldDomainOldSecretId);
      const retry = await post("/api/admin/integrations/brevo/cleanup-webhooks", {
        cookie: adminCookie, body: { ids: remaining },
      });
      assert.equal(retry.status, 200, `retry after provider recovery succeeds (got: ${retry.raw})`);
      assert.deepEqual(staleOf(retry), [], "stale list empties after the retry");
      console.log("✓ partial provider failures are reported and retryable; 404 counts as removed");
    }

    // ── 9. The saved secret never appeared in ANY response body ─────────────
    {
      assert.ok(responseBodies.length >= 12, "the suite must have exercised the routes");
      for (const raw of responseBodies) {
        assert.ok(!raw.includes(secret), `saved secret leaked into a response body: ${raw}`);
        assert.ok(!raw.includes(encodedSecret), "URL-encoded secret leaked into a response body");
      }
      console.log(`✓ saved secret absent from all ${responseBodies.length} response bodies (masked URLs only)`);
    }

    console.log("\n✅ All Brevo stale webhook cleanup tests passed");
  } finally {
    server.close();
    globalThis.fetch = realFetch;
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
