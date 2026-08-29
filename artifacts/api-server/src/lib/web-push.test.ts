import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import {
  publicWebPushConfiguration,
  parseWebPushConfiguration,
  resolveWebPushConfiguration,
  systemPushRetry,
  validatePushSubscription,
} from "./web-push";

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