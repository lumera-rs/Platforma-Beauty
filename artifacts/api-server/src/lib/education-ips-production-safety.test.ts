/**
 * Task #6D regression: proves the fix to education-placement-lifecycle.test.ts
 * (giving it a real ipsAccountEnvironment="test" settings row via the shared
 * installTemporaryEducationIpsSettings() helper) did NOT weaken production
 * payment safety anywhere else.
 *
 * This exercises the exact same call shape every paid-IPS route builds
 * (POST /education/placements/purchase, marketplace.ts:20996-21007, and its
 * siblings): getEducationPlatformSettings() feeding educationIpsQrPayload()
 * with accountEnvironment taken from the DB row and runtimeEnvironment from
 * educationIpsRuntimeEnvironment(). Two assertions:
 *   1. ipsAccountEnvironment="production" (a real production recipient
 *      account) in a non-production runtime (this test always runs with
 *      NODE_ENV=test) still throws IPS_PAYMENT_PRODUCTION_ACCOUNT_BLOCKED --
 *      the safety guard is untouched by Task #6D.
 *   2. ipsAccountEnvironment="test" succeeds -- the same DB-driven path the
 *      corrected lifecycle test now relies on.
 */
import assert from "node:assert/strict";
import { getEducationPlatformSettings } from "./education-billing";
import { educationIpsQrPayload, educationIpsRuntimeEnvironment } from "./education-marketplace-domain";
import { installTemporaryEducationIpsSettings } from "./education-test-fixtures";

async function run(): Promise<void> {
  assert.notEqual(process.env.NODE_ENV, "production", "This regression requires a non-production runtime to be meaningful.");

  const productionSettings = await installTemporaryEducationIpsSettings({
    ipsRecipientName: "Production Recipient",
    ipsRecipientAccount: "840000000000000001",
    ipsPurpose: "Live payment",
    ipsAccountEnvironment: "production",
  });
  try {
    const paymentSettings = await getEducationPlatformSettings();
    assert.equal(paymentSettings.ipsAccountEnvironment, "production");
    assert.throws(
      () => educationIpsQrPayload({
        recipientName: paymentSettings.ipsRecipientName,
        recipientAccount: paymentSettings.ipsRecipientAccount,
        purpose: paymentSettings.ipsPurpose,
        amount: 1_000,
        reference: "TEST-PROD-BLOCKED",
        recipientType: "platform",
        transactionType: "placement",
        accountEnvironment: paymentSettings.ipsAccountEnvironment as "production" | "test",
        runtimeEnvironment: educationIpsRuntimeEnvironment(),
      }),
      /IPS_PAYMENT_PRODUCTION_ACCOUNT_BLOCKED/,
      "A production IPS recipient account must still be blocked outside a production runtime.",
    );
  } finally {
    await productionSettings.restore();
  }

  const testSettings = await installTemporaryEducationIpsSettings({
    ipsRecipientName: "Test Recipient",
    ipsRecipientAccount: "840000000000000002",
    ipsPurpose: "Test payment",
    ipsAccountEnvironment: "test",
  });
  try {
    const paymentSettings = await getEducationPlatformSettings();
    assert.equal(paymentSettings.ipsAccountEnvironment, "test");
    const ips = educationIpsQrPayload({
      recipientName: paymentSettings.ipsRecipientName,
      recipientAccount: paymentSettings.ipsRecipientAccount,
      purpose: paymentSettings.ipsPurpose,
      amount: 1_000,
      reference: "TEST-TEST-ALLOWED",
      recipientType: "platform",
      transactionType: "placement",
      accountEnvironment: paymentSettings.ipsAccountEnvironment as "production" | "test",
      runtimeEnvironment: educationIpsRuntimeEnvironment(),
    });
    assert.ok(ips.payload.includes("TEST-TEST-ALLOWED"));
  } finally {
    await testSettings.restore();
  }

  console.log("Education IPS production-safety guard regression passed.");
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
