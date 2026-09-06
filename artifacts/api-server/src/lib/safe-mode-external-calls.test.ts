import assert from "node:assert/strict";
import {
  brevoTransactionalEmailTransport,
  listBrevoTransactionalWebhooks,
} from "./brevo";
import { educationIpsRuntimeEnvironment } from "./education-marketplace-domain";
import { infobipSmsProvider } from "./sms";

const previousSafeMode = process.env.SAFE_MODE_NO_EXTERNAL_CALLS;
const previousPaymentEnvironment = process.env.PAYMENT_RUNTIME_ENV;
const originalFetch = globalThis.fetch;
let fetchCalls = 0;

try {
  process.env.SAFE_MODE_NO_EXTERNAL_CALLS = "true";
  process.env.PAYMENT_RUNTIME_ENV = "production";
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called in safe mode");
  };

  const email = await brevoTransactionalEmailTransport.send({
    idempotencyKey: "email-delivery-id",
    to: { email: "recipient@example.test" },
    subject: "Subject",
    htmlContent: "<p>Body</p>",
  });
  assert.deepEqual(email, { messageId: "safe-mode:email-delivery-id" });

  const sms = await infobipSmsProvider.send({
    idempotencyKey: "sms-delivery-id",
    to: "+381601112222",
    text: "Body",
  });
  assert.deepEqual(sms, { messageId: "safe-mode:sms-delivery-id" });

  await assert.rejects(
    listBrevoTransactionalWebhooks(),
    /SAFE_MODE_NO_EXTERNAL_CALLS/,
  );
  assert.equal(educationIpsRuntimeEnvironment(), "test");
  assert.equal(fetchCalls, 0);
} finally {
  globalThis.fetch = originalFetch;
  if (previousSafeMode === undefined) delete process.env.SAFE_MODE_NO_EXTERNAL_CALLS;
  else process.env.SAFE_MODE_NO_EXTERNAL_CALLS = previousSafeMode;
  if (previousPaymentEnvironment === undefined) delete process.env.PAYMENT_RUNTIME_ENV;
  else process.env.PAYMENT_RUNTIME_ENV = previousPaymentEnvironment;
}

console.log("safe mode external-call tests passed");