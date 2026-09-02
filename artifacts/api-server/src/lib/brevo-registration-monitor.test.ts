/**
 * Brevo registration coverage monitor — regression suite.
 *
 * Verifies the provider-side coverage check, durable admin alert
 * deduplication, and healthy-state resolution without contacting Brevo.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/brevo-registration-monitor.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  emailDeliveriesTable,
  integrationSettingsTable,
  pool,
  usersTable,
} from "@workspace/db";
import {
  BREVO_WEBHOOK_EVENTS,
  missingEventsForActiveBrevoRegistration,
  type TransactionalEmailTransport,
} from "./brevo";
import {
  brevoRegistrationMissingEvents,
  markBrevoRegistrationIncomplete,
} from "./integrations";
import { runBrevoWebhookCoverageMonitor } from "./monitoring";

const suffix = randomUUID().slice(0, 8);
const email = `brevo-monitor-${suffix}@bg.test`;
const secret = `brevo-monitor-secret-${suffix}`;
const origin = `https://brevo-monitor-${suffix}.example.com`;
const eventPrefix = "brevo-webhook-coverage-alert:";
const originalFetch = globalThis.fetch;
const originalApiKey = process.env["BREVO_API_KEY"];
const originalSecret = process.env["BREVO_WEBHOOK_SECRET"];
const originalBaseUrl = process.env["APP_BASE_URL"];
const originalDomains = process.env["REPLIT_DOMAINS"];

let providerEvents = ["delivered"];
let providerUnavailable = false;
let providerMalformed = false;
let providerMalformedEntry = false;

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://api.brevo.com/v3/webhooks?type=transactional") {
    if (providerUnavailable) return new Response("temporary provider outage", { status: 503 });
    if (providerMalformed) return Response.json({ unexpected: "provider response" });
    if (providerMalformedEntry) {
      return Response.json({
        webhooks: [{
          id: 1,
          url: `${origin}/api/webhooks/brevo/${encodeURIComponent(secret)}`,
          events: "not-an-array",
        }],
      });
    }
    return Response.json({
      webhooks: [{
        id: 1,
        url: `${origin}/api/webhooks/brevo/${encodeURIComponent(secret)}`,
        events: providerEvents,
      }],
    });
  }
  return originalFetch(input, init);
}) as typeof fetch;

async function run(): Promise<void> {
  // The integration is globally configured in the shared test database. Take
  // it out of the equation so this fixture exercises its own environment
  // credentials, then restore the exact encrypted rows in cleanup.
  const originalBrevoSettings = await db.select().from(integrationSettingsTable)
    .where(eq(integrationSettingsTable.integration, "brevo"));
  await db.delete(integrationSettingsTable)
    .where(eq(integrationSettingsTable.integration, "brevo"));
  process.env["BREVO_API_KEY"] = `brevo-monitor-api-key-${suffix}`;
  process.env["BREVO_WEBHOOK_SECRET"] = secret;
  process.env["APP_BASE_URL"] = `${origin}/`;
  process.env["REPLIT_DOMAINS"] = new URL(origin).hostname;

  const [admin] = await db.insert(usersTable).values({
    firstName: "Brevo",
    lastName: "Monitor",
    email,
    passwordHash: "test-only",
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  assert.ok(admin);

  const calls: Array<{ to: { email: string }; subject: string; htmlContent: string }> = [];
  let alertEventKeys: string[] = [];
  const transport: TransactionalEmailTransport = {
    async send(input) {
      calls.push(input);
      return { messageId: `brevo-monitor-message-${calls.length}` };
    },
  };

  try {
    const partial = await runBrevoWebhookCoverageMonitor(new Date("2026-08-24T12:00:00.000Z"), transport);
    alertEventKeys = partial.attemptedEventKeys;
    assert.equal(partial.status, "incomplete");
    assert.equal(partial.activeRegistration, true);
    assert.equal(calls.length, partial.recipientCount, "the first incomplete check alerts every active administrator");
    const fixtureCall = calls.find((call) => call.to.email === email);
    assert.ok(fixtureCall, "the fixture administrator receives the alert");
    assert.ok(fixtureCall.subject.includes("Brevo"));
    assert.ok(fixtureCall.htmlContent.includes("otvaranja (opened / uniqueOpened)"));
    assert.deepEqual(
      await brevoRegistrationMissingEvents(),
      partial.missingEvents,
      "the integrations card receives the provider-verified missing groups",
    );

    const repeat = await runBrevoWebhookCoverageMonitor(new Date("2026-08-24T12:15:00.000Z"), transport);
    assert.equal(repeat.status, "incomplete");
    assert.equal(repeat.deduplicatedCount, partial.recipientCount);
    assert.equal(calls.length, partial.recipientCount, "the same missing-event set is deduplicated by the durable outbox");

    providerUnavailable = true;
    const unavailable = await runBrevoWebhookCoverageMonitor(new Date("2026-08-24T12:20:00.000Z"), transport);
    assert.equal(unavailable.status, "unavailable");
    assert.equal(calls.length, partial.recipientCount, "a provider outage cannot create a false coverage alert");
    assert.deepEqual(await brevoRegistrationMissingEvents(), partial.missingEvents, "a provider outage cannot clear the existing warning");

    providerUnavailable = false;
    providerMalformed = true;
    const malformed = await runBrevoWebhookCoverageMonitor(new Date("2026-08-24T12:25:00.000Z"), transport);
    assert.equal(malformed.status, "unavailable");
    assert.equal(calls.length, partial.recipientCount, "a malformed provider response cannot create a false coverage alert");
    assert.deepEqual(await brevoRegistrationMissingEvents(), partial.missingEvents, "a malformed provider response cannot clear the existing warning");

    providerMalformed = false;
    providerMalformedEntry = true;
    const malformedEntry = await runBrevoWebhookCoverageMonitor(new Date("2026-08-24T12:27:00.000Z"), transport);
    assert.equal(malformedEntry.status, "unavailable");
    assert.equal(calls.length, partial.recipientCount, "a malformed provider entry cannot create a false coverage alert");
    assert.deepEqual(await brevoRegistrationMissingEvents(), partial.missingEvents, "a malformed provider entry cannot clear the existing warning");

    providerMalformedEntry = false;
    providerEvents = [...BREVO_WEBHOOK_EVENTS];
    const healthy = await runBrevoWebhookCoverageMonitor(new Date("2026-08-24T12:30:00.000Z"), transport);
    assert.equal(healthy.status, "healthy");
    assert.equal(healthy.activeRegistration, true);
    assert.deepEqual(await brevoRegistrationMissingEvents(), [], "a healthy check clears the warning");
    providerEvents = ["delivered"];
    const stale = await runBrevoWebhookCoverageMonitor(
      new Date("2026-08-24T12:40:00.000Z"),
      transport,
      { observedAt: new Date("2020-01-01T00:00:00.000Z") },
    );
    assert.equal(stale.status, "skipped", "an older incomplete observation is not reported as healthy");
    assert.deepEqual(await brevoRegistrationMissingEvents(), [], "an older incomplete observation cannot overwrite a newer healthy result");

    providerEvents = ["delivered"];
    const recurring = await runBrevoWebhookCoverageMonitor(new Date("2026-08-24T12:45:00.000Z"), transport);
    alertEventKeys = [...alertEventKeys, ...recurring.attemptedEventKeys];
    assert.equal(recurring.status, "incomplete");
    assert.equal(
      calls.length,
      partial.recipientCount * 2,
      "the same coverage failure starts a new alert episode after a healthy resolution",
    );

    const currentSecret = [{
      id: 2,
      url: `${origin}/api/webhooks/brevo/${encodeURIComponent(secret)}`,
      events: ["delivered"],
    }];
    assert.deepEqual(
      missingEventsForActiveBrevoRegistration(currentSecret, secret, new Set([origin])),
      partial.missingEvents,
    );
    assert.equal(
      missingEventsForActiveBrevoRegistration(currentSecret, "wrong-secret", new Set([origin])),
      null,
      "a stale secret is not treated as the active registration",
    );
    console.log("✓ Brevo coverage monitor alerts once, names missing groups, and resolves on recovery");
  } finally {
    if (alertEventKeys.length) {
      await db.delete(emailDeliveriesTable).where(inArray(emailDeliveriesTable.eventKey, alertEventKeys));
    }
    await db.delete(integrationSettingsTable).where(eq(integrationSettingsTable.integration, "brevo"));
    if (originalBrevoSettings.length) await db.insert(integrationSettingsTable).values(originalBrevoSettings);
    await db.delete(usersTable).where(eq(usersTable.id, admin.id));
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env["BREVO_API_KEY"];
    else process.env["BREVO_API_KEY"] = originalApiKey;
    if (originalSecret === undefined) delete process.env["BREVO_WEBHOOK_SECRET"];
    else process.env["BREVO_WEBHOOK_SECRET"] = originalSecret;
    if (originalBaseUrl === undefined) delete process.env["APP_BASE_URL"];
    else process.env["APP_BASE_URL"] = originalBaseUrl;
    if (originalDomains === undefined) delete process.env["REPLIT_DOMAINS"];
    else process.env["REPLIT_DOMAINS"] = originalDomains;
    await pool.end();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});