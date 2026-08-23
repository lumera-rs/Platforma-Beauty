/**
 * Webhook secret re-confirmation reminder — regression suite
 *
 * After an admin saves a NEW webhook secret (sms or brevo), the URL registered
 * at the provider stops working until it is re-registered and re-confirmed.
 * The "secret changed, registration not yet re-confirmed" state is persisted
 * server-side (marker rows alongside the integration settings) so the inline
 * reminder survives page reloads, and is cleared only by a successful
 * re-confirmation: the loopback self-check ("Proveri webhook") for both
 * providers, or the one-click Brevo registration ("Registruj webhook") whose
 * provider-side re-check passed.
 *
 * Verified here:
 *   1. Baseline: no reminder when the secret was never changed; OAuth cards
 *      never carry the flag
 *   2. Saving a genuinely different webhookSecret raises the persisted flag —
 *      visible in the PUT response AND on a fresh GET (the "reload")
 *   3. Re-saving the identical secret while pending keeps the reminder;
 *      re-saving it after confirmation never re-raises a false reminder
 *   4. A successful self-check clears the flag persistently
 *   5. A softened development-origin Brevo registration verdict does not
 *      clear the flag
 *   6. A strict production-origin Brevo registration verdict clears it
 *   7. A successful one-click Brevo registration (create + verified re-check,
 *      Brevo API intercepted) clears the flag persistently
 *   8. Marker rows are metadata only: they never surface as integration
 *      values
 *
 * The integration_settings table is global, so the suite snapshots every
 * sms/brevo row up front and restores the exact prior state afterwards.
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/webhook-secret-reconfirmation.test.ts
 */
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, integrationSettingsTable, pool, usersTable } from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { integrationSettings, markWebhookReconfirmed, webhookVerificationIsStale, WEBHOOK_CONFIRMATION_MAX_AGE_DAYS } from "./integrations";
import { BREVO_WEBHOOK_EVENTS } from "./brevo";

const suffix = randomUUID().slice(0, 8);
const MARKER_KEYS = ["webhookSecretChangedAt", "webhookVerifiedAt"];
const cleanup = { userIds: [] as string[] };

// ---------------------------------------------------------------------------
// Brevo API interception: the one-click registration flow answers from a FIFO
// stub queue (listing → create → re-listing); everything else passes through.
// ---------------------------------------------------------------------------
type BrevoStubCall = { method: string; pathIncludes: string; status: number; body?: unknown };
const brevoQueue: BrevoStubCall[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.brevo.com/")) {
    const next = brevoQueue.shift();
    assert.ok(next, `unexpected Brevo API call (no stub queued): ${init?.method ?? "GET"} ${url}`);
    assert.equal(init?.method ?? "GET", next.method, `Brevo call order: expected ${next.method} ${next.pathIncludes}, got ${init?.method ?? "GET"} ${url}`);
    assert.ok(url.includes(next.pathIncludes), `Brevo call order: expected path containing ${next.pathIncludes}, got ${url}`);
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

type CardFlags = { webhookSecretPendingReconfirmation?: boolean; webhookVerifiedAt?: string | null; webhookVerificationStale?: boolean; webhookConfirmationMaxAgeDays?: number };

async function run() {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const prodHost = `wsr-prod-${suffix}.example.com`;
  const prodOrigin = `https://${prodHost}`;

  // Snapshot the global sms/brevo integration rows for exact restoration.
  const priorRows = await db.select().from(integrationSettingsTable)
    .where(inArray(integrationSettingsTable.integration, ["sms", "brevo"]));
  // Deterministic baseline: no leftover markers from earlier runs.
  await db.delete(integrationSettingsTable).where(and(
    inArray(integrationSettingsTable.integration, ["sms", "brevo"]),
    inArray(integrationSettingsTable.settingKey, MARKER_KEYS),
  ));
  // One-click registration talks to the (intercepted) Brevo API.
  process.env["BREVO_API_KEY"] ??= `wsr-fake-api-key-${suffix}`;

  try {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const exactlyAtLimit = new Date(now.getTime() - WEBHOOK_CONFIRMATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    assert.equal(webhookVerificationIsStale(null, now), false, "never-confirmed webhook is not classified as an old confirmation");
    assert.equal(webhookVerificationIsStale(new Date(now.getTime() - 60_000), now), false, "confirmation inside the safe age is fresh");
    assert.equal(webhookVerificationIsStale(exactlyAtLimit, now), true, "confirmation exactly at the safe-age boundary is stale");

    const [admin] = await db.insert(usersTable).values({
      firstName: "Admin", lastName: "WSR",
      email: `wsr-admin-${suffix}@bg.test`, passwordHash: await hashPassword(`wsr-admin-${suffix}`),
      passwordSetAt: new Date(), role: "ADMIN",
    }).returning();
    assert.ok(admin);
    cleanup.userIds.push(admin.id);
    const cookie = `${sessionCookieName}=${await createSession(admin.id)}`;

    // Registration checks must be exercised from a production-looking origin:
    // fetch() forbids setting Host, so use node:http for the strict-versus-dev
    // origin assertions.
    const requestWithHost = (path: string, options: { host: string; method?: string }) =>
      new Promise<{ status: number; raw: string }>((resolve, reject) => {
        const request = httpRequest({
          hostname: "127.0.0.1",
          port,
          path,
          method: options.method ?? "GET",
          headers: { host: options.host, "x-forwarded-proto": "https", cookie },
        }, (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => { raw += chunk; });
          response.on("end", () => resolve({ status: response.statusCode ?? 0, raw }));
        });
        request.on("error", reject);
        request.end();
      });

    const getCards = async () => {
      const response = await fetch(`${baseUrl}/api/admin/integrations`, { headers: { cookie } });
      assert.equal(response.status, 200, "admin integrations read must succeed");
      const body = await response.json() as { integrations: Record<string, CardFlags> };
      return body.integrations;
    };
    const getWebhookFreshness = async () => {
      const response = await fetch(`${baseUrl}/api/admin/integrations/webhook-freshness`, { headers: { cookie } });
      assert.equal(response.status, 200, "webhook freshness read must succeed");
      const body = await response.json() as { integrations: Record<"sms" | "brevo", CardFlags> };
      return body.integrations;
    };
    const putIntegration = async (integration: string, values: Record<string, string>) => {
      const response = await fetch(`${baseUrl}/api/admin/integrations/${integration}`, {
        method: "PUT", headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, values }),
      });
      const body = await response.json() as CardFlags & { error?: string };
      assert.equal(response.status, 200, `saving ${integration} settings must succeed: ${JSON.stringify(body)}`);
      return body;
    };
    const verifyWebhook = async (integration: string) => {
      const response = await fetch(`${baseUrl}/api/admin/integrations/${integration}/verify-webhook`, {
        method: "POST", headers: { cookie },
      });
      const body = await response.json() as CardFlags & { message?: string; error?: string };
      assert.equal(response.status, 200, `${integration} self-check must succeed: ${JSON.stringify(body)}`);
      assert.ok(body.webhookVerifiedAt, `${integration} self-check response exposes its confirmation timestamp`);
      return body;
    };
    const verifyBrevoRegistration = async (host: string) => {
      const response = await requestWithHost("/api/admin/integrations/brevo/verify-registration", {
        method: "POST", host,
      });
      const body = JSON.parse(response.raw) as { message?: string; error?: string; reconfirmed?: boolean };
      return { response, body };
    };

    // ── 1. Baseline: never-changed secrets carry no reminder ───────────────
    {
      const cards = await getCards();
      assert.equal(cards["sms"]?.webhookSecretPendingReconfirmation, false, "sms baseline: no reminder");
      assert.equal(cards["brevo"]?.webhookSecretPendingReconfirmation, false, "brevo baseline: no reminder");
      assert.equal(cards["sms"]?.webhookVerifiedAt, null, "sms baseline: no successful confirmation");
      assert.equal(cards["brevo"]?.webhookVerifiedAt, null, "brevo baseline: no successful confirmation");
      assert.equal(cards["sms"]?.webhookVerificationStale, false, "never-confirmed SMS is distinct from stale");
      assert.equal(cards["brevo"]?.webhookVerificationStale, false, "never-confirmed Brevo is distinct from stale");
      assert.equal(cards["sms"]?.webhookConfirmationMaxAgeDays, WEBHOOK_CONFIRMATION_MAX_AGE_DAYS, "SMS exposes the shared confirmation age");
      assert.equal(cards["brevo"]?.webhookConfirmationMaxAgeDays, WEBHOOK_CONFIRMATION_MAX_AGE_DAYS, "Brevo exposes the shared confirmation age");
      const freshness = await getWebhookFreshness();
      assert.equal(freshness.sms?.webhookVerifiedAt, null, "freshness read exposes never-confirmed SMS");
      assert.equal(freshness.sms?.webhookVerificationStale, false, "freshness read keeps never-confirmed SMS distinct from stale");
      assert.equal(freshness.brevo?.webhookVerificationStale, false, "freshness read keeps never-confirmed Brevo distinct from stale");
      assert.ok(!("webhookSecretPendingReconfirmation" in (cards["google_oauth"] ?? {})),
        "OAuth cards never carry the webhook reminder flag");
      assert.ok(!("webhookVerifiedAt" in (cards["google_oauth"] ?? {})),
        "OAuth cards never carry webhook confirmation metadata");
      console.log("✓ baseline: no reminder for never-changed secrets; OAuth cards unaffected");
    }

    // ── 2. Saving a NEW secret raises the flag and it survives a reload ────
    const smsSecret1 = `wsr-sms-secret-${suffix}-1`;
    {
      const saved = await putIntegration("sms", { webhookSecret: smsSecret1 });
      assert.equal(saved.webhookSecretPendingReconfirmation, true,
        "PUT response must flag the changed secret as pending re-confirmation");
      const cards = await getCards();
      assert.equal(cards["sms"]?.webhookSecretPendingReconfirmation, true,
        "the reminder must survive a page reload (fresh GET)");
      assert.equal(cards["brevo"]?.webhookSecretPendingReconfirmation, false,
        "the other provider's card stays untouched");
      console.log("✓ changed sms secret raises a persisted reminder that survives reloads");
    }

    // ── 3. Re-saving the identical secret keeps the pending reminder ───────
    {
      const saved = await putIntegration("sms", { webhookSecret: smsSecret1 });
      assert.equal(saved.webhookSecretPendingReconfirmation, true,
        "re-saving the same secret while unconfirmed keeps the reminder");
      console.log("✓ identical re-save while pending keeps the reminder");
    }

    // ── 4. Successful self-check clears the flag persistently ──────────────
    {
      await verifyWebhook("sms");
      const cards = await getCards();
      assert.equal(cards["sms"]?.webhookSecretPendingReconfirmation, false,
        "a successful self-check must clear the persisted reminder");
      assert.ok(cards["sms"]?.webhookVerifiedAt, "successful self-check exposes its confirmation timestamp");
      assert.equal(cards["sms"]?.webhookVerificationStale, false, "a successful self-check is fresh");
      assert.ok(!Number.isNaN(new Date(cards["sms"]!.webhookVerifiedAt!).getTime()), "confirmation timestamp is ISO date-like");
      console.log("✓ successful self-check clears the reminder persistently");
    }

    // ── 5. An old confirmation warns, but never-confirmed stays separate ───
    {
      await markWebhookReconfirmed("sms", admin.id, new Date(Date.now() - (WEBHOOK_CONFIRMATION_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000));
      const cards = await getCards();
      assert.equal(cards["sms"]?.webhookVerificationStale, true, "an old SMS confirmation is surfaced as stale");
      assert.ok(cards["sms"]?.webhookVerifiedAt, "stale confirmations retain their timestamp");
      const freshness = await getWebhookFreshness();
      assert.equal(freshness.sms?.webhookVerificationStale, true, "background freshness read surfaces the old SMS confirmation as stale");
      assert.equal(freshness.brevo?.webhookVerificationStale, false, "background freshness read keeps never-confirmed Brevo distinct from stale");
      assert.equal(cards["brevo"]?.webhookVerifiedAt, null, "Brevo remains visibly never confirmed");
      assert.equal(cards["brevo"]?.webhookVerificationStale, false, "never-confirmed Brevo is not called stale");
      const refreshed = await verifyWebhook("sms");
      assert.equal(refreshed.webhookVerificationStale, false, "a successful re-check clears stale state");
      console.log("✓ stale confirmation is flagged while never-confirmed remains distinct");
    }

    // ── 6. Re-saving the SAME confirmed secret never re-raises the flag ────
    {
      const saved = await putIntegration("sms", { webhookSecret: smsSecret1 });
      assert.equal(saved.webhookSecretPendingReconfirmation, false,
        "re-saving an unchanged, already-confirmed secret must not re-raise the reminder");
      assert.ok(saved.webhookVerifiedAt, "saving a confirmed webhook keeps its confirmation timestamp in the PUT response");
      const unrelatedSave = await putIntegration("sms", { senderName: `LUMERA ${suffix}` });
      assert.equal(unrelatedSave.webhookVerifiedAt, saved.webhookVerifiedAt,
        "saving another SMS field must preserve the confirmation timestamp in the PUT response");
      const cards = await getCards();
      assert.equal(cards["sms"]?.webhookSecretPendingReconfirmation, false, "still cleared after reload");
      assert.equal(cards["sms"]?.webhookVerifiedAt, saved.webhookVerifiedAt,
        "saving another SMS field must not erase the confirmation timestamp from the admin card");
      // A genuinely different secret flags again (repeatable lifecycle) …
      const changedAgain = await putIntegration("sms", { webhookSecret: `wsr-sms-secret-${suffix}-2` });
      assert.equal(changedAgain.webhookSecretPendingReconfirmation, true, "a second change flags again");
      // … and the self-check clears it again.
      const verification = await verifyWebhook("sms");
      assert.ok(!Number.isNaN(new Date(verification.webhookVerifiedAt!).getTime()), "self-check response timestamp is ISO date-like");
      assert.equal((await getCards())["sms"]?.webhookSecretPendingReconfirmation, false, "second cycle clears too");
      console.log("✓ unchanged confirmed secret never re-flags; the change→confirm cycle repeats cleanly");
    }

    // ── 6. Brevo: registration check only clears on strict production proof ─
    {
      const brevoSecret = `wsr-brevo-secret-${suffix}-check`;
      const saved = await putIntegration("brevo", { webhookSecret: brevoSecret });
      assert.equal(saved.webhookSecretPendingReconfirmation, true, "changed brevo secret raises the reminder");

      const registeredUrl = `${prodOrigin}/api/webhooks/brevo/${encodeURIComponent(brevoSecret)}`;

      // A production registration with the current URL and secret is still
      // incomplete when it subscribes to only one event. It must not clear
      // the persisted reminder until every consumed event is covered.
      brevoQueue.push({
        method: "GET", pathIncludes: "/webhooks?type=transactional", status: 200,
        body: [{ id: 489, url: registeredUrl, events: ["delivered"] }],
      });
      const incomplete = await verifyBrevoRegistration(prodHost);
      assert.equal(incomplete.response.status, 409,
        `incomplete production registration must remain unsuccessful: ${incomplete.response.raw}`);
      assert.ok(incomplete.body.error?.includes("ne prati sve potrebne događaje"),
        `incomplete registration must explain the missing event coverage: ${incomplete.response.raw}`);
      assert.equal((await getCards())["brevo"]?.webhookSecretPendingReconfirmation, true,
        "incomplete production registration must keep the reminder visible after a fresh integrations read");

      brevoQueue.push({
        method: "GET", pathIncludes: "/webhooks?type=transactional", status: 200,
        body: [{ id: 490, url: registeredUrl, events: [...BREVO_WEBHOOK_EVENTS] }],
      });
      const softened = await verifyBrevoRegistration(`wsr-${suffix}.riker.replit.dev`);
      assert.equal(softened.response.status, 200,
        `development-origin current-secret verdict should still succeed softly: ${softened.response.raw}`);
      assert.equal(softened.body.reconfirmed, false,
        "a softened development-origin verdict must not re-confirm the secret");
      assert.equal((await getCards())["brevo"]?.webhookSecretPendingReconfirmation, true,
        "development-origin registration check must leave the reminder pending");

      brevoQueue.push({
        method: "GET", pathIncludes: "/webhooks?type=transactional", status: 200,
        body: [{ id: 491, url: registeredUrl, events: [...BREVO_WEBHOOK_EVENTS] }],
      });
      const strict = await verifyBrevoRegistration(prodHost);
      assert.equal(strict.response.status, 200,
        `strict production-origin registration check must succeed: ${strict.response.raw}`);
      assert.equal(strict.body.reconfirmed, true,
        "strict production-origin success must report re-confirmation");
      assert.equal((await getCards())["brevo"]?.webhookSecretPendingReconfirmation, false,
        "strict production-origin registration check must clear the reminder after reload");
      console.log("✓ Brevo registration check keeps dev verdicts pending and clears on strict production proof");
    }

    // ── 7. Brevo: one-click registration clears the reminder ───────────────
    {
      const brevoSecret = `wsr-brevo-secret-${suffix}-repair`;
      const saved = await putIntegration("brevo", { webhookSecret: brevoSecret });
      assert.equal(saved.webhookSecretPendingReconfirmation, true, "changed brevo secret raises the reminder");

      // One-click flow: empty listing → create → fresh listing showing the
      // registration this deployment just wrote (URL + current secret + all
      // subscribed events), so the route's re-check passes.
      const targetUrl = `${prodOrigin}/api/webhooks/brevo/${encodeURIComponent(brevoSecret)}`;
      brevoQueue.push(
        { method: "GET", pathIncludes: "/webhooks?type=transactional", status: 200, body: [] },
        { method: "POST", pathIncludes: "/webhooks", status: 201, body: { id: 501 } },
        { method: "GET", pathIncludes: "/webhooks?type=transactional", status: 200, body: [
          { id: 501, url: targetUrl, events: [...BREVO_WEBHOOK_EVENTS] },
        ] },
      );
      const registrationRequest = await requestWithHost("/api/admin/integrations/brevo/register-webhook", {
        method: "POST", host: prodHost,
      });
      const body = JSON.parse(registrationRequest.raw) as CardFlags & { message?: string; error?: string };
      assert.equal(registrationRequest.status, 200, `one-click registration must succeed: ${JSON.stringify(body)}`);
      assert.equal(brevoQueue.length, 0, "registration flow must consume the full stub sequence");
      assert.ok(body.webhookVerifiedAt, "one-click registration response exposes its confirmation timestamp");

      const cards = await getCards();
      assert.equal(cards["brevo"]?.webhookSecretPendingReconfirmation, false,
        "a successful one-click registration (with verified re-check) must clear the reminder");
      assert.ok(cards["brevo"]?.webhookVerifiedAt, "successful Brevo registration exposes its confirmation timestamp");
      assert.ok(!Number.isNaN(new Date(cards["brevo"]!.webhookVerifiedAt!).getTime()), "Brevo confirmation timestamp is ISO date-like");
      assert.equal(cards["sms"]?.webhookSecretPendingReconfirmation, false, "sms card stays cleared");
      console.log("✓ one-click Brevo registration clears the reminder persistently");
    }

    // ── 8. Markers are metadata: never surfaced as integration values ──────
    {
      for (const integration of ["sms", "brevo"] as const) {
        const settings = await integrationSettings(integration);
        for (const key of MARKER_KEYS) {
          assert.ok(!(key in settings.values), `${integration} marker ${key} must not surface as a value`);
        }
      }
      const cards = await getCards();
      assert.ok(!("webhookSecretChangedAt" in (cards["sms"] ?? {})), "secret-change marker never leaks through admin cards");
      assert.ok(!("webhookSecretChangedAt" in (cards["brevo"] ?? {})), "secret-change marker never leaks through admin cards");
      console.log("✓ marker rows never leak into integration values");
    }

    console.log("\n✅ All webhook secret re-confirmation tests passed");
  } finally {
    server.close();
    globalThis.fetch = realFetch;
    // Restore the exact prior global integration_settings state for sms/brevo.
    await db.delete(integrationSettingsTable)
      .where(inArray(integrationSettingsTable.integration, ["sms", "brevo"]));
    if (priorRows.length) await db.insert(integrationSettingsTable).values(priorRows);
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
