import Anthropic from "@anthropic-ai/sdk";

/**
 * The Anthropic integration is provisioned through Replit-specific
 * environment variables, so it is present in the deployed application but
 * absent in GitHub Actions and in most local shells.
 *
 * This module used to validate those variables and construct the client at
 * *import* time. Because the only consumer (growth-ai-snapshot.ts) is reached
 * from routes/growth.ts -> routes/index.ts -> app.ts, merely importing the
 * Express app pulled this module in and threw, which made unrelated
 * database/monitoring suites fail in CI even though none of them ever issue
 * an AI request.
 *
 * Validation is therefore deferred to first use instead of first import. The
 * error messages are unchanged, so a genuinely unprovisioned AI code path
 * still fails loudly with exactly the same diagnostic; it just no longer
 * punishes every module that happens to share an import graph with it.
 * artifacts/api-server/src/index.ts additionally asserts the integration at
 * startup in production, preserving the fail-fast-at-boot behaviour that the
 * old import-time throw provided for real deployments.
 */

const MISSING_BASE_URL_MESSAGE =
  "AI_INTEGRATIONS_ANTHROPIC_BASE_URL must be set. Did you forget to provision the Anthropic AI integration?";
const MISSING_API_KEY_MESSAGE =
  "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to provision the Anthropic AI integration?";

/**
 * Throws if the Anthropic integration is not provisioned, without building a
 * client. Use this to fail fast at startup where the integration is required.
 */
export function assertAnthropicIntegrationConfigured(): void {
  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
    throw new Error(MISSING_BASE_URL_MESSAGE);
  }
  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    throw new Error(MISSING_API_KEY_MESSAGE);
  }
}

let cachedClient: Anthropic | undefined;

/**
 * Returns the shared Anthropic client, validating the integration and
 * constructing it on first use. The instance is cached, so configuration is
 * read exactly once per process -- the same lifetime the previous
 * module-level client had.
 */
export function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    assertAnthropicIntegrationConfigured();
    cachedClient = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
  }
  return cachedClient;
}
