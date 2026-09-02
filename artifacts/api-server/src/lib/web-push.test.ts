import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import { inArray } from "drizzle-orm";
import {
  closePool,
  db,
  pushSubscriptionsTable,
  systemPushDeliveriesTable,
  usersTable,
} from "@workspace/db";
import {
  AdminGetWebPushDeliveryMetricsQueryParams,
  AdminGetWebPushDeliveryMetricsResponse,
} from "@workspace/api-zod";
import {
  publicWebPushConfiguration,
  parseWebPushConfiguration,
  resolveWebPushConfiguration,
  systemPushRetry,
  systemPushAcknowledgementToken,
  validatePushSubscription,
  webPushDeliveryMetrics,
} from "./web-push";

const createdUserIds: string[] = [];

test.after(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  await closePool();
});

function vapidKeyPair() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString("base64url"),
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
}

test("public Web Push configuration never exposes private VAPID material", () => {
  const configuration = {
    configured: true as const,
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"),
    privateKey: Buffer.alloc(32, 2).toString("base64url"),
    subject: "mailto:ops@example.com",
  };
  assert.deepEqual(publicWebPushConfiguration(configuration), { configured: true, publicKey: configuration.publicKey });
  assert.equal("privateKey" in publicWebPushConfiguration(configuration), false);
  assert.equal("subject" in publicWebPushConfiguration(configuration), false);
});

test("VAPID configuration fails explicitly when incomplete or unsafe", () => {
  const missing = parseWebPushConfiguration({ publicKey: "public" });
  assert.equal(missing.configured, false);
  if (!missing.configured) assert.match(missing.reason, /privateKey/);
  const unsafe = parseWebPushConfiguration({
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"),
    privateKey: Buffer.alloc(32, 2).toString("base64url"),
    subject: "ops@example.com",
  });
  assert.equal(unsafe.configured, false);
});

test("VAPID parser accepts complete keys and rejects malformed key material", () => {
  const valid = {
    ...vapidKeyPair(),
    subject: "https://example.com/push-contact",
  };
  assert.equal(parseWebPushConfiguration(valid).configured, true);
  const malformed = parseWebPushConfiguration({ ...valid, privateKey: "not-a-vapid-key" });
  assert.equal(malformed.configured, false);
  if (!malformed.configured) assert.match(malformed.reason, /VAPID key/);
});

test("VAPID parser rejects mismatched public and private keys", () => {
  const publicPair = vapidKeyPair();
  const privatePair = vapidKeyPair();
  const mismatch = parseWebPushConfiguration({
    publicKey: publicPair.publicKey,
    privateKey: privatePair.privateKey,
    subject: "mailto:ops@example.com",
  });
  assert.equal(mismatch.configured, false);
  if (!mismatch.configured) assert.match(mismatch.reason, /same VAPID key pair/);
});

test("database enable-only and partial saves retain environment fallback values", () => {
  const pair = vapidKeyPair();
  const env = {
    VAPID_PUBLIC_KEY: pair.publicKey,
    VAPID_PRIVATE_KEY: pair.privateKey,
    VAPID_SUBJECT: "mailto:ops@example.com",
  };
  const enabledOnly = resolveWebPushConfiguration({
    configuredInDatabase: true,
    enabled: true,
    values: {},
  }, env);
  assert.equal(enabledOnly.configured, true);

  const partial = resolveWebPushConfiguration({
    configuredInDatabase: true,
    enabled: true,
    values: { subject: "https://example.com/push-contact" },
  }, env);
  assert.equal(partial.configured, true);
  if (partial.configured) assert.equal(partial.subject, "https://example.com/push-contact");
});

test("database disabled state overrides a complete environment fallback", () => {
  const pair = vapidKeyPair();
  const configuration = resolveWebPushConfiguration({
    configuredInDatabase: true,
    enabled: false,
    values: {},
  }, {
    VAPID_PUBLIC_KEY: pair.publicKey,
    VAPID_PRIVATE_KEY: pair.privateKey,
    VAPID_SUBJECT: "mailto:ops@example.com",
  });
  assert.equal(configuration.configured, false);
  if (!configuration.configured) assert.match(configuration.reason, /disabled/);
});

test("Push subscriptions require bounded HTTPS provider endpoints", () => {
  assert.doesNotThrow(() => validatePushSubscription({
    endpoint: "https://updates.push.services.mozilla.com/wpush/v2/opaque",
    keys: { p256dh: "key", auth: "auth" },
  }));
  assert.throws(() => validatePushSubscription({
    endpoint: "http://push.example.test/subscription",
    keys: { p256dh: "key", auth: "auth" },
  }), /HTTPS/);
  assert.throws(() => validatePushSubscription({
    endpoint: `https://fcm.googleapis.com/${"a".repeat(5000)}`,
    keys: { p256dh: "key", auth: "auth" },
  }), /too large/);
});

test("Push subscriptions reject arbitrary HTTPS origins", () => {
  assert.throws(() => validatePushSubscription({
    endpoint: "https://example.com/collect",
    keys: { p256dh: "key", auth: "auth" },
  }), /provider is not supported/);
  assert.doesNotThrow(() => validatePushSubscription({
    endpoint: "https://fcm.googleapis.com/fcm/send/example",
    keys: { p256dh: "key", auth: "auth" },
  }));
});

test("Push retries are bounded and distinguish permanent provider failures", () => {
  assert.deepEqual(systemPushRetry(1, 503), { willRetry: true, backoffMs: 30_000 });
  assert.equal(systemPushRetry(1, 400).willRetry, false);
  assert.equal(systemPushRetry(8, 503).willRetry, false);
  assert.ok(systemPushRetry(7, null).backoffMs <= 6 * 60 * 60_000);
});

test("Web Push acknowledgement tokens are delivery-bound and deterministic", () => {
  const secret = "test-session-secret";
  const first = systemPushAcknowledgementToken("11111111-1111-4111-8111-111111111111", secret);
  const repeated = systemPushAcknowledgementToken("11111111-1111-4111-8111-111111111111", secret);
  const other = systemPushAcknowledgementToken("22222222-2222-4222-8222-222222222222", secret);
  assert.equal(first.length, 43);
  assert.equal(first, repeated);
  assert.notEqual(first, other);
});

test("Web Push delivery periods accept only the supported operational windows", () => {
  for (const periodDays of [1, 7, 30, 90]) {
    assert.equal(AdminGetWebPushDeliveryMetricsQueryParams.safeParse({ periodDays }).success, true);
  }
  for (const periodDays of [0, 2, 14, 31, 365, "7", null, undefined]) {
    assert.equal(AdminGetWebPushDeliveryMetricsQueryParams.safeParse({ periodDays }).success, false);
  }
});

test("Web Push metrics classify failures, retries, and deactivated devices without exposing subscription data", async () => {
  const now = new Date("2040-06-15T12:00:00.000Z");
  const secretMarker = "private-device-marker-web-push-metrics";
  const [user] = await db.insert(usersTable).values({
    firstName: "Web Push",
    lastName: "Metrics",
    email: `web-push-metrics-${crypto.randomUUID()}@example.test`,
    passwordHash: "not-used-by-test",
    role: "ADMIN",
  }).returning({ id: usersTable.id });
  assert.ok(user);
  createdUserIds.push(user.id);

  const subscriptions = await db.insert(pushSubscriptionsTable).values([
    {
      userId: user.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${secretMarker}-active`,
      p256dh: `${secretMarker}-p256dh-active`,
      auth: `${secretMarker}-auth-active`,
      userAgent: `${secretMarker}-identity-active`,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    },
    {
      userId: user.id,
      endpoint: `https://fcm.googleapis.com/fcm/send/${secretMarker}-disabled`,
      p256dh: `${secretMarker}-p256dh-disabled`,
      auth: `${secretMarker}-auth-disabled`,
      userAgent: `${secretMarker}-identity-disabled`,
      enabled: false,
      disabledAt: now,
      disabledReason: "provider_410",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    },
  ]).returning({ id: pushSubscriptionsTable.id });
  assert.equal(subscriptions.length, 2);

  const payload = {
    title: "Test",
    body: "Test",
    deepLink: null,
    tag: "metrics-test",
  };
  const common = {
    subscriptionId: subscriptions[0]!.id,
    userId: user.id,
    payload,
    nextAttemptAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(systemPushDeliveriesTable).values([
    {
      ...common,
      eventKey: `metrics-expired-${crypto.randomUUID()}`,
      status: "failed",
      attemptCount: 1,
      lastError: "Reminder expired before delivery.",
    },
    {
      ...common,
      eventKey: `metrics-changed-${crypto.randomUUID()}`,
      status: "failed",
      attemptCount: 2,
      lastError: "Reminder source changed before delivery.",
    },
    {
      ...common,
      eventKey: `metrics-provider-${crypto.randomUUID()}`,
      status: "failed",
      attemptCount: 4,
      lastError: "Provider returned 503.",
    },
    {
      ...common,
      eventKey: `metrics-sent-${crypto.randomUUID()}`,
      status: "sent",
      attemptCount: 3,
      acknowledgedAt: now,
      sentAt: now,
    },
    {
      ...common,
      eventKey: `metrics-pending-${crypto.randomUUID()}`,
      status: "queued",
      attemptCount: 0,
    },
  ]);

  for (const periodDays of [1, 7, 30, 90] as const) {
    const metrics = await webPushDeliveryMetrics(periodDays, now);
    assert.deepEqual(metrics.deliveries, {
      sent: 1,
      acknowledged: 1,
      failed: 3,
      retried: 6,
      pending: 1,
      expiredOrChanged: 2,
      providerErrors: 1,
    });
    assert.equal(metrics.devices.automaticallyDeactivated, 1);
    assert.ok(metrics.devices.active >= 1);
    assert.equal(metrics.periodStartedAt.toISOString(), new Date(now.getTime() - periodDays * 86_400_000).toISOString());

    const response = AdminGetWebPushDeliveryMetricsResponse.parse(metrics);
    const serialized = JSON.stringify(response);
    assert.equal(serialized.includes(secretMarker), false);
    for (const privateField of ["endpoint", "p256dh", "auth", "userAgent", "userId", "subscriptionId"]) {
      assert.equal(serialized.includes(`"${privateField}"`), false);
    }
  }
});