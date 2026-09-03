import assert from "node:assert/strict";
import {
  allowedPublicHosts,
  isDevelopmentHostname,
  paymentRuntimeEnvironment,
  safeModeNoExternalCalls,
  trustProxySetting,
} from "./runtime-environment";

const env = (values: Record<string, string | undefined>): NodeJS.ProcessEnv => ({ ...values });

// Legacy payment behavior is retained only when the provider-neutral variable
// is absent.
assert.equal(paymentRuntimeEnvironment(env({
  NODE_ENV: "production",
  REPLIT_DEPLOYMENT: "1",
})), "production");
assert.equal(paymentRuntimeEnvironment(env({
  NODE_ENV: "production",
  REPL_DEPLOYMENT: "yes",
  REPLIT_ENVIRONMENT: "production",
})), "production");
assert.equal(paymentRuntimeEnvironment(env({
  NODE_ENV: "development",
  REPLIT_DEPLOYMENT: "1",
})), "test");
assert.equal(paymentRuntimeEnvironment(env({
  NODE_ENV: "production",
  REPLIT_DEPLOYMENT: "1",
  REPLIT_ENVIRONMENT: "development",
})), "test");

// New values take precedence; malformed and empty values fail closed.
assert.equal(paymentRuntimeEnvironment(env({
  NODE_ENV: "development",
  PAYMENT_RUNTIME_ENV: " production ",
})), "production");
assert.equal(paymentRuntimeEnvironment(env({
  NODE_ENV: "production",
  REPLIT_DEPLOYMENT: "1",
  PAYMENT_RUNTIME_ENV: "invalid",
})), "test");
assert.equal(paymentRuntimeEnvironment(env({
  NODE_ENV: "production",
  REPLIT_DEPLOYMENT: "1",
  PAYMENT_RUNTIME_ENV: "",
})), "test");

assert.equal(trustProxySetting(env({ REPLIT_DEPLOYMENT: "1" })), 1);
assert.equal(trustProxySetting(env({ REPLIT_DEPLOYMENT: "1", TRUST_PROXY_HOPS: "3" })), 3);
assert.equal(trustProxySetting(env({ REPLIT_DEPLOYMENT: "1", TRUST_PROXY_HOPS: "bad" })), false);
assert.equal(trustProxySetting(env({ REPLIT_DEPLOYMENT: "1", TRUST_PROXY_HOPS: "0" })), false);

assert.deepEqual(
  [...allowedPublicHosts(env({ REPLIT_DOMAINS: "one.example, two.example" }))],
  ["one.example", "two.example"],
);
assert.deepEqual(
  [...allowedPublicHosts(env({
    ALLOWED_PUBLIC_HOSTS: "NEW.example, https://other.example/",
    REPLIT_DOMAINS: "legacy.example",
  }))],
  ["new.example", "other.example"],
);
assert.deepEqual(
  [...allowedPublicHosts(env({ ALLOWED_PUBLIC_HOSTS: "", REPLIT_DOMAINS: "legacy.example" }))],
  [],
);
assert.equal(isDevelopmentHostname("preview.example", env({
  REPLIT_DEV_DOMAIN: "preview.example",
})), true);
assert.equal(isDevelopmentHostname("preview.example", env({
  ALLOWED_PUBLIC_HOSTS: "public.example",
  REPLIT_DEV_DOMAIN: "preview.example",
})), false);

assert.equal(safeModeNoExternalCalls(env({})), false);
assert.equal(safeModeNoExternalCalls(env({ SAFE_MODE_NO_EXTERNAL_CALLS: "true" })), true);
assert.equal(safeModeNoExternalCalls(env({ SAFE_MODE_NO_EXTERNAL_CALLS: "1" })), false);

console.log("runtime environment tests passed");