import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's TypeScript test runner requires the source extension.
import { toPushSubscriptionRequest, urlBase64ToUint8Array } from "./customer-push-utils.ts";

test("decodes a URL-safe VAPID public key", () => {
  const originalAtob = globalThis.atob;
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
  try {
    assert.deepEqual(Array.from(urlBase64ToUint8Array("AQIDBA")), [1, 2, 3, 4]);
  } finally {
    globalThis.atob = originalAtob;
  }
});

test("serializes only the browser push subscription fields required by the API", () => {
  const subscription = {
    toJSON: () => ({
      endpoint: "https://push.example/subscription",
      expirationTime: null,
      keys: { auth: "auth-key", p256dh: "p256dh-key" },
    }),
  } as PushSubscription;

  assert.deepEqual(toPushSubscriptionRequest(subscription), {
    endpoint: "https://push.example/subscription",
    keys: { auth: "auth-key", p256dh: "p256dh-key" },
  });
});