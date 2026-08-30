/**
 * Brevo one-click webhook repair — write-path selection regression suite
 *
 * The admin "Registruj webhook na Brevo" route decides between CREATE
 * (POST /v3/webhooks) and UPDATE (PUT /v3/webhooks/{id}) and picks WHICH
 * existing provider registration to update: the same-origin candidate first
 * (the stale-secret case), then a matching-secret candidate at another domain
 * (the stale-domain case), then any LUMERA-format leftover. A wrong pick
 * would silently rewrite a different registration — in the worst case a
 * healthy PRODUCTION webhook rewritten from a development domain. The
 * read-only verification verdicts are covered separately in
 * webhook-registration-verification.test.ts; THIS suite pins the write path:
 *
 *   1. CREATE when the provider listing has no LUMERA-format candidates
 *      (empty listing, and a listing with only non-LUMERA / unparseable /
 *      other-provider URLs) — and no PUT is ever issued in that case
 *   2. UPDATE-in-place is preferred over CREATE whenever any candidate
 *      exists (no duplicate registrations)
 *   3. Priority: same-origin beats matching-secret-elsewhere, regardless of
 *      listing order; matching-secret-elsewhere beats an arbitrary
 *      LUMERA-format leftover; a lone leftover is still updated in place
 *   4. Non-LUMERA-format webhooks are NEVER selected for update — across the
 *      whole suite no PUT ever targets one, and their provider-side state is
 *      byte-identical afterwards
 *   5. Every write (POST or PUT) points at THIS deployment's URL with the
 *      saved secret and subscribes the full BREVO_WEBHOOK_EVENTS set
 *   6. Non-admins can never trigger a provider write; the saved secret never
 *      appears in any response body
 *   7. From a development/preview browsing origin the repair is refused
 *      BEFORE any provider contact — otherwise the matching-secret fallback
 *      would select the healthy PRODUCTION registration and rewrite it to
 *      the development URL, silently redirecting production delivery reports
 *
 * Live Brevo cannot be exercised in tests, so the suite intercepts the
 * outbound provider calls (https://api.brevo.com/v3/webhooks...) with a
 * STATEFUL fake: GET returns the configured listing, POST appends, PUT
 * mutates by id. The route re-checks against a fresh listing after writing,
 * so the fake's statefulness also proves the reported success reflects what
 * the provider stored.
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/webhook-repair-selection.test.ts
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
// Stateful Brevo API fake: GET lists, POST creates, PUT updates by id. Every
// write is recorded so the suite can assert exactly which registration the
// route decided to touch. All non-Brevo fetches pass through untouched.
// ---------------------------------------------------------------------------

type ProviderWebhook = { id: number; url: string; events: string[]; description?: string };
type RecordedWrite = { method: "POST" | "PUT"; id: number | null; body: Record<string, unknown> };

let providerWebhooks: ProviderWebhook[] = [];
let providerNextId = 9000;
let listingCalls = 0;
const allWrites: RecordedWrite[] = [];
let interceptorError: unknown = null;

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api.brevo.com/")) return realFetch(input, init);
  try {
    const parsed = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const pathMatch = /^\/v3\/webhooks(?:\/(\d+))?$/.exec(parsed.pathname);
    assert.ok(pathMatch, `unexpected Brevo API path: ${parsed.pathname}`);
    const pathId = pathMatch[1] ? Number(pathMatch[1]) : null;

    if (method === "GET") {
      assert.equal(pathId, null, "listing must not carry an id");
      assert.equal(parsed.searchParams.get("type"), "transactional",
        "repair must list transactional webhooks only");
      listingCalls += 1;
      return new Response(JSON.stringify(providerWebhooks), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    const body = JSON.parse(String(init?.body ?? "null")) as Record<string, unknown> | null;
    assert.ok(body && typeof body === "object", `${method} to Brevo must carry a JSON body`);

    if (method === "POST") {
      assert.equal(pathId, null, "create must POST to the collection, not an id");
      allWrites.push({ method: "POST", id: null, body });
      const created: ProviderWebhook = {
        id: providerNextId++,
        url: String(body["url"]),
        events: Array.isArray(body["events"]) ? body["events"].map(String) : [],
        ...(typeof body["description"] === "string" ? { description: body["description"] } : {}),
      };
      providerWebhooks.push(created);
      return new Response(JSON.stringify({ id: created.id }), {
        status: 201, headers: { "content-type": "application/json" },
      });
    }

    if (method === "PUT") {
      assert.ok(pathId !== null, "update must PUT to a specific webhook id");
      allWrites.push({ method: "PUT", id: pathId, body });
      const target = providerWebhooks.find((hook) => hook.id === pathId);
      assert.ok(target, `PUT targeted webhook id ${pathId} which does not exist at the provider`);
      target.url = String(body["url"]);
      target.events = Array.isArray(body["events"]) ? body["events"].map(String) : [];
      if (typeof body["description"] === "string") target.description = body["description"];
      return new Response(null, { status: 204 });
    }

    assert.fail(`unexpected Brevo API method: ${method} ${url}`);
  } catch (error) {
    // Assertion failures inside the interceptor surface as opaque 502s in the
    // route response; stash the first one so the suite fails loudly with it.
    interceptorError ??= error;
    throw error;
  }
}) as typeof fetch;

async function run() {
  app.set("trust proxy", 1);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  // The route derives the deployment origin from the admin request (protocol
  // + host, trust proxy enabled). fetch forbids spoofing Host, so requests go
  // through node:http with an explicit production-looking Host header.
  const prodHost = `lumera-wrs-${suffix}.example.com`;
  const devHost = `wrs-${suffix}.riker.replit.dev`;
  const origin = `https://${prodHost}`;
  const fullEvents = [...BREVO_WEBHOOK_EVENTS];
  const sortedFullEvents = [...fullEvents].sort();

  const repairRequest = (cookie?: string, host?: string) =>
    new Promise<{ status: number; raw: string }>((resolve, reject) => {
      const req = httpRequest({
        hostname: "127.0.0.1",
        port,
        path: "/api/admin/integrations/brevo/register-webhook",
        method: "POST",
        headers: {
          host: host ?? prodHost,
          "x-forwarded-proto": "https",
          ...(cookie ? { cookie } : {}),
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

  // Force the direct-fetch provider path (intercepted above) and make sure a
  // webhook secret resolves deterministically.
  process.env["BREVO_API_KEY"] ??= `wrs-fake-api-key-${suffix}`;
  process.env["BREVO_WEBHOOK_SECRET"] ??= `wrs-secret-${suffix}`;

  try {
    const secret = await resolveWebhookSecret("brevo");
    assert.ok(secret, "webhook secret must resolve for the selection suite");
    const targetUrl = `${origin}/api/webhooks/brevo/${encodeURIComponent(secret)}`;

    if (hadRows && !priorEnabled) {
      await db.update(integrationSettingsTable).set({ enabled: true })
        .where(eq(integrationSettingsTable.integration, "brevo"));
    }
    assert.ok((await integrationSettings("brevo")).enabled, "brevo integration must be enabled for the suite");

    // ── Fixtures: admin (route requires it) + non-admin for access control ──
    const [admin] = await db.insert(usersTable).values({
      firstName: "Admin", lastName: "WRS",
      email: `wrs-admin-${suffix}@bg.test`, passwordHash: await hashPassword(`wrs-admin-${suffix}`),
      passwordSetAt: new Date(), role: "ADMIN",
    }).returning();
    const [customer] = await db.insert(usersTable).values({
      firstName: "Kupac", lastName: "WRS",
      email: `wrs-customer-${suffix}@bg.test`, passwordHash: await hashPassword(`wrs-customer-${suffix}`),
      passwordSetAt: new Date(), role: "CUSTOMER",
    }).returning();
    assert.ok(admin && customer);
    cleanup.userIds.push(admin.id, customer.id);
    const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
    const customerCookie = `${sessionCookieName}=${await createSession(customer.id)}`;

    const responseBodies: string[] = [];
    // Ids of every non-LUMERA-format registration the suite ever plants; the
    // final regression assert proves no PUT ever touched any of them.
    const nonLumeraIds = new Set<number>();

    /** Run one repair scenario and return its writes + response. */
    const repairWith = async (listing: ProviderWebhook[]) => {
      providerWebhooks = listing.map((hook) => ({ ...hook, events: [...hook.events] }));
      const writesBefore = allWrites.length;
      const listingsBefore = listingCalls;
      const { status, raw } = await repairRequest(adminCookie);
      if (interceptorError) throw interceptorError;
      responseBodies.push(raw);
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* non-JSON body */ }
      return {
        status, raw, body,
        writes: allWrites.slice(writesBefore),
        listings: listingCalls - listingsBefore,
        after: providerWebhooks,
      };
    };
    const messageOf = (result: { body: Record<string, unknown> | null }) => String(result.body?.["message"] ?? "");

    /** Every write must repair toward THIS deployment with the full event set. */
    const assertWritePayload = (write: RecordedWrite) => {
      assert.equal(write.body["url"], targetUrl,
        `${write.method} must point the registration at this deployment's URL with the saved secret`);
      assert.deepEqual([...(write.body["events"] as string[])].sort(), sortedFullEvents,
        `${write.method} must subscribe the full event set`);
    };

    // ── 1. Non-admins can never trigger a provider write ───────────────────
    {
      providerWebhooks = [];
      const writesBefore = allWrites.length;
      const listingsBefore = listingCalls;
      const anonymous = await repairRequest();
      const nonAdmin = await repairRequest(customerCookie);
      assert.ok([401, 403].includes(anonymous.status), `anonymous repair must be rejected (got: ${anonymous.status})`);
      assert.ok([401, 403].includes(nonAdmin.status), `non-admin repair must be rejected (got: ${nonAdmin.status})`);
      assert.equal(allWrites.length, writesBefore, "rejected requests must never write to the provider");
      assert.equal(listingCalls, listingsBefore, "rejected requests must never contact the provider at all");
      console.log("✓ anonymous and non-admin requests are rejected without any provider call");
    }

    // ── 2. CREATE when the provider has no webhooks at all ─────────────────
    {
      const result = await repairWith([]);
      assert.equal(result.status, 200, `empty listing must create (got: ${result.raw})`);
      assert.equal(result.writes.length, 1, "exactly one provider write");
      const write = result.writes[0]!;
      assert.equal(write.method, "POST", "no candidates → CREATE, not UPDATE");
      assert.equal(write.body["type"], "transactional", "created webhook must be transactional");
      assertWritePayload(write);
      assert.ok(messageOf(result).includes("registrovan"), `create outcome reported (got: ${result.raw})`);
      assert.equal(result.listings, 2, "outcome must be re-checked against a fresh provider listing");
      console.log("✓ no candidates → CREATE with this deployment's URL and the full event set");
    }

    // ── 3. Non-LUMERA webhooks are not candidates: still CREATE ────────────
    {
      const foreign: ProviderWebhook[] = [
        { id: 301, url: "https://marketing.example.com/some/other/hook", events: ["delivered"] },
        { id: 302, url: "not a url at all", events: [] },
        { id: 303, url: `${origin}/api/webhooks/infobip/${encodeURIComponent(secret)}`, events: ["delivered"] },
        { id: 304, url: `${origin}/api/webhooks/brevo/${encodeURIComponent(secret)}/extra`, events: ["delivered"] },
        { id: 305, url: `${origin}/api/webhooks/brevo/`, events: ["delivered"] },
      ];
      for (const hook of foreign) nonLumeraIds.add(hook.id);
      const result = await repairWith(foreign);
      assert.equal(result.status, 200, `non-candidate listing must create (got: ${result.raw})`);
      assert.equal(result.writes.length, 1, "exactly one provider write");
      assert.equal(result.writes[0]!.method, "POST",
        "non-LUMERA registrations must not be selected — CREATE instead");
      assertWritePayload(result.writes[0]!);
      // The foreign registrations must be byte-identical afterwards.
      for (const hook of foreign) {
        const after = result.after.find((entry) => entry.id === hook.id);
        assert.deepEqual(after, hook, `non-LUMERA webhook ${hook.id} must be untouched`);
      }
      console.log("✓ listing with only non-LUMERA webhooks → CREATE; foreign registrations untouched");
    }

    // ── 4. Same-origin candidate wins over matching-secret elsewhere ───────
    {
      // Same-origin (stale secret) listed LAST to prove priority is not
      // listing order; a matching-secret registration at another domain and
      // an arbitrary LUMERA leftover are both present and must lose.
      const matchingSecretElsewhere = {
        id: 402, url: `https://stara-domena.example.com/api/webhooks/brevo/${encodeURIComponent(secret)}`, events: [...fullEvents],
      };
      const leftover = { id: 403, url: "https://druga-app.example.net/api/webhooks/brevo/tudja-tajna", events: ["delivered"] };
      const sameOriginStale = { id: 401, url: `${origin}/api/webhooks/brevo/stale-token-${suffix}`, events: ["delivered"] };
      const result = await repairWith([matchingSecretElsewhere, leftover, sameOriginStale]);
      assert.equal(result.status, 200, `same-origin repair must succeed (got: ${result.raw})`);
      assert.equal(result.writes.length, 1, "exactly one provider write");
      const write = result.writes[0]!;
      assert.equal(write.method, "PUT", "existing candidate → UPDATE in place, never a duplicate CREATE");
      assert.equal(write.id, sameOriginStale.id,
        "the SAME-ORIGIN candidate must be updated (stale-secret case), not the matching-secret one elsewhere");
      assertWritePayload(write);
      assert.ok(messageOf(result).includes("ažuriran"), `update outcome reported (got: ${result.raw})`);
      // The other-domain registrations survive unchanged — in production the
      // matching-secret one could be a healthy sibling registration.
      assert.deepEqual(result.after.find((entry) => entry.id === matchingSecretElsewhere.id), matchingSecretElsewhere,
        "matching-secret registration at another domain must be untouched");
      assert.deepEqual(result.after.find((entry) => entry.id === leftover.id), leftover,
        "LUMERA leftover must be untouched when a better candidate exists");
      console.log("✓ same-origin candidate updated over matching-secret elsewhere, regardless of listing order");
    }

    // ── 5. Matching-secret elsewhere wins over an arbitrary leftover ───────
    {
      // No same-origin candidate: the registration carrying the CURRENT
      // secret at a stale domain must be moved, not the arbitrary leftover.
      const leftover = { id: 501, url: "https://druga-app.example.net/api/webhooks/brevo/tudja-tajna", events: ["delivered"] };
      const matchingSecretElsewhere = {
        id: 502, url: `https://stara-domena.example.com/api/webhooks/brevo/${encodeURIComponent(secret)}`, events: ["delivered"],
      };
      const result = await repairWith([leftover, matchingSecretElsewhere]);
      assert.equal(result.status, 200, `stale-domain repair must succeed (got: ${result.raw})`);
      assert.equal(result.writes.length, 1, "exactly one provider write");
      const write = result.writes[0]!;
      assert.equal(write.method, "PUT", "existing candidate → UPDATE in place");
      assert.equal(write.id, matchingSecretElsewhere.id,
        "the MATCHING-SECRET candidate must be updated (stale-domain case), not the arbitrary leftover");
      assertWritePayload(write);
      assert.deepEqual(result.after.find((entry) => entry.id === leftover.id), leftover,
        "arbitrary leftover must be untouched when a matching-secret candidate exists");
      console.log("✓ matching-secret candidate updated over an arbitrary LUMERA leftover");
    }

    // ── 6. A lone LUMERA leftover is updated; non-LUMERA neighbors never ───
    {
      const leftover = { id: 601, url: "https://druga-app.example.net/api/webhooks/brevo/tudja-tajna", events: ["delivered"] };
      const nonLumera = { id: 602, url: "https://marketing.example.com/kampanje/hook", events: ["delivered"] };
      nonLumeraIds.add(nonLumera.id);
      const result = await repairWith([nonLumera, leftover]);
      assert.equal(result.status, 200, `leftover repair must succeed (got: ${result.raw})`);
      assert.equal(result.writes.length, 1, "exactly one provider write");
      const write = result.writes[0]!;
      assert.equal(write.method, "PUT", "a lone LUMERA-format leftover is still updated in place");
      assert.equal(write.id, leftover.id, "the LUMERA leftover is the update target — never the non-LUMERA webhook");
      assertWritePayload(write);
      assert.deepEqual(result.after.find((entry) => entry.id === nonLumera.id), nonLumera,
        "non-LUMERA webhook must be untouched");
      console.log("✓ lone LUMERA leftover updated in place; non-LUMERA neighbor untouched");
    }

    // ── 7. Development origin: refused before any provider contact ─────────
    {
      // The dangerous case the guard exists for: from a dev-preview address
      // there is no dev-origin candidate, so the matching-secret fallback
      // would select the healthy PRODUCTION registration and rewrite it to
      // the development URL. The route must refuse WITHOUT listing, creating
      // or updating anything.
      const productionRegistration = {
        id: 701, url: `${origin}/api/webhooks/brevo/${encodeURIComponent(secret)}`, events: [...fullEvents],
      };
      providerWebhooks = [{ ...productionRegistration, events: [...productionRegistration.events] }];
      const writesBefore = allWrites.length;
      const listingsBefore = listingCalls;
      const { status, raw } = await repairRequest(adminCookie, devHost);
      if (interceptorError) throw interceptorError;
      responseBodies.push(raw);
      assert.equal(status, 400, `development-origin repair must be refused (got: ${status} ${raw})`);
      const error = String((JSON.parse(raw) as Record<string, unknown>)["error"] ?? "");
      assert.ok(error.includes("razvojne adrese") && error.includes(`https://${devHost}`),
        `refusal names the development address (got: ${raw})`);
      assert.ok(error.includes("objavljene aplikacije"),
        "refusal points the admin at the published application");
      assert.equal(allWrites.length, writesBefore,
        "a development-origin request must never write to the provider");
      assert.equal(listingCalls, listingsBefore,
        "a development-origin request must be refused before any provider contact");
      assert.deepEqual(providerWebhooks, [productionRegistration],
        "the production registration must be byte-identical after the refused attempt");

      // localhost browsing origins are refused the same way.
      const fromLocalhost = await repairRequest(adminCookie, "localhost:5000");
      responseBodies.push(fromLocalhost.raw);
      assert.equal(fromLocalhost.status, 400, `localhost repair must be refused (got: ${fromLocalhost.raw})`);
      assert.equal(allWrites.length, writesBefore, "localhost request must never write to the provider");
      assert.equal(listingCalls, listingsBefore, "localhost request must never contact the provider");
      console.log("✓ development/preview origins are refused before any provider call; production registration untouched");
    }

    // ── 8. Suite-wide regression: writes never strayed ──────────────────────
    {
      assert.ok(allWrites.length >= 4, "the suite must have exercised the write path");
      for (const write of allWrites) {
        if (write.method === "PUT") {
          assert.ok(write.id !== null && !nonLumeraIds.has(write.id),
            `a PUT targeted non-LUMERA webhook id ${write.id} — the repair rewrote a foreign registration`);
        }
        assert.equal(write.body["url"], targetUrl, "every provider write pointed at this deployment's URL");
      }
      for (const raw of responseBodies) {
        assert.ok(!raw.includes(secret), `saved secret leaked into a response body: ${raw}`);
        assert.ok(!raw.includes(encodeURIComponent(secret)), "URL-encoded secret leaked into a response body");
      }
      console.log(`✓ no PUT ever targeted a non-LUMERA webhook; secret absent from all ${responseBodies.length} bodies`);
    }

    console.log("\n✅ All webhook repair selection tests passed");
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
