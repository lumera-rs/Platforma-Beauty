/**
 * Task #7B: internal job-secret verification hardening regression.
 *
 * Confirmed finding: all three /internal/jobs/* worker endpoints compared
 * the incoming `x-lumera-job-key` header against the configured secret with
 * ordinary strict inequality --
 *
 *   req.get("x-lumera-job-key") !== expected
 *
 * -- in marketplace.ts (sms-reminders, rescheduled-confirmation-retries,
 * education-gallery-cleanup). JavaScript's string `!==` is an early-exit,
 * character-by-character comparison, so it is not a constant-time
 * primitive. These endpoints are mounted on the same public router as every
 * other route (no IP allowlist), so they are externally reachable; the
 * ONLY thing standing between an anonymous request and triggering these
 * jobs is this one header comparison. This is intentionally scoped as a
 * hardening finding, not a proven remote timing exploit -- no timing
 * measurement is used to establish correctness here (see note below).
 *
 * Fix: reuse the existing, already-audited webhookTokenMatches() helper
 * (provider-events.ts) -- it hashes both candidate values to a fixed
 * 32-byte SHA-256 digest first (so crypto.timingSafeEqual, which throws on
 * mismatched buffer lengths, always sees equal-length input) and only then
 * calls crypto.timingSafeEqual. This is the same helper already protecting
 * the Brevo/SMS provider webhook token in provider-webhooks.ts -- no new
 * "constant-time" algorithm was written for this task.
 *
 * This file deliberately contains NO timing measurement -- correctness is
 * established structurally (fixed-length digest comparison via a real
 * crypto primitive) and functionally (every scenario below still resolves
 * to the exact same accept/reject decision as before).
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/internal-job-secret-timing-safety.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import app from "../app";

type HttpResponse = { status: number; body: string };

const routes = [
  { path: "/api/internal/jobs/sms-reminders", envVar: "SMS_REMINDER_JOB_SECRET" },
  { path: "/api/internal/jobs/rescheduled-confirmation-retries", envVar: "CONFIRMATION_RETRY_JOB_SECRET" },
  { path: "/api/internal/jobs/education-gallery-cleanup", envVar: "EDUCATION_GALLERY_CLEANUP_JOB_SECRET" },
] as const;

function post(port: number, path: string, headers: Record<string, string | string[]>): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1", port, path, method: "POST",
      headers: { "content-type": "application/json", ...headers },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(JSON.stringify({}));
  });
}

async function run(): Promise<void> {
  const suffix = randomUUID();
  const previousEnv = new Map<string, string | undefined>();
  for (const route of routes) previousEnv.set(route.envVar, process.env[route.envVar]);
  const previousNodeEnv = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "test";

  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    for (const route of routes) {
      const secret = `job-secret-${suffix}-${route.envVar}`;
      process.env[route.envVar] = secret;

      // 1. exact correct secret -> accepted (not 401)
      const correct = await post(port, route.path, { "x-lumera-job-key": secret });
      assert.notEqual(correct.status, 401, `${route.path}: the exact correct secret must be accepted`);

      // 2. completely wrong, same-length secret -> rejected
      const sameLengthWrong = "x".repeat(secret.length);
      assert.notEqual(sameLengthWrong, secret);
      const wrongSameLength = await post(port, route.path, { "x-lumera-job-key": sameLengthWrong });
      assert.equal(wrongSameLength.status, 401, `${route.path}: a wrong same-length secret must be rejected`);

      // 3. wrong shorter secret -> rejected without throwing
      const shorter = secret.slice(0, Math.max(1, secret.length - 5));
      const wrongShorter = await post(port, route.path, { "x-lumera-job-key": shorter });
      assert.equal(wrongShorter.status, 401, `${route.path}: a shorter wrong secret must be rejected, not crash`);

      // 4. wrong longer secret -> rejected without throwing
      const longer = `${secret}-extra-longer-value`;
      const wrongLonger = await post(port, route.path, { "x-lumera-job-key": longer });
      assert.equal(wrongLonger.status, 401, `${route.path}: a longer wrong secret must be rejected, not crash`);

      // 5. prefix of valid secret -> rejected
      const prefix = secret.slice(0, secret.length - 1);
      const wrongPrefix = await post(port, route.path, { "x-lumera-job-key": prefix });
      assert.equal(wrongPrefix.status, 401, `${route.path}: a prefix of the valid secret must be rejected`);

      // 6. valid secret + suffix -> rejected
      const withSuffix = `${secret}x`;
      const wrongSuffix = await post(port, route.path, { "x-lumera-job-key": withSuffix });
      assert.equal(wrongSuffix.status, 401, `${route.path}: the valid secret plus an extra character must be rejected`);

      // 7. missing incoming secret -> rejected
      const missing = await post(port, route.path, {});
      assert.equal(missing.status, 401, `${route.path}: a missing header must be rejected`);

      // 8. empty incoming secret -> rejected
      const empty = await post(port, route.path, { "x-lumera-job-key": "" });
      assert.equal(empty.status, 401, `${route.path}: an empty header must be rejected`);

      // 10. non-ASCII incoming value does not crash the comparison. Limited
      // to Latin-1-range code points -- Node's own HTTP client rejects
      // header values containing characters outside that range before the
      // request is even sent, so a wider Unicode value cannot reach the
      // server at all (a separate, transport-level constraint, not this
      // fix's concern).
      const nonAscii = await post(port, route.path, { "x-lumera-job-key": "éèçñ-secret" });
      assert.equal(nonAscii.status, 401, `${route.path}: a non-ASCII value must be safely rejected, not crash`);

      // 11. very long attacker-supplied value is safely rejected, not a
      // crash/hang. Node's own HTTP server already refuses to parse a
      // request whose headers exceed its size limit (431 Request Header
      // Fields Too Large) before this application's comparison logic ever
      // runs -- either outcome is a safe, bounded rejection.
      const veryLong = "a".repeat(200_000);
      const longResponse = await post(port, route.path, { "x-lumera-job-key": veryLong });
      assert.ok([401, 431].includes(longResponse.status),
        `${route.path}: an extremely long header must be safely rejected (got ${longResponse.status})`);

      // duplicate header representation: sending the header twice makes
      // Node join the values with ", " before req.get() ever sees it, so
      // even sending the correct secret twice must not match.
      const duplicateHeaderResponse = await post(port, route.path, { "x-lumera-job-key": [secret, secret] });
      assert.equal(duplicateHeaderResponse.status, 401, `${route.path}: a duplicated header (even with the correct value twice) must not match`);

      // leading/trailing whitespace around a header VALUE is optional
      // whitespace (OWS) per RFC 7230 -- Node's own HTTP parser strips it
      // before the application ever sees the header, so a whitespace-padded
      // secret is genuinely, correctly equivalent to the exact secret. This
      // is existing HTTP-layer behavior, unrelated to and unaffected by
      // this fix; asserting it here documents that fact rather than
      // treating it as a bypass.
      const whitespaceResponse = await post(port, route.path, { "x-lumera-job-key": ` ${secret} ` });
      assert.notEqual(whitespaceResponse.status, 401, `${route.path}: RFC 7230 optional whitespace around the header value must be stripped before comparison, matching standard HTTP semantics`);

      // case-insensitive HEADER NAME (not value) must still resolve --
      // HTTP header names are case-insensitive by spec / Node lower-cases
      // them, so this must behave identically to the lowercase header.
      const upperHeaderName = await post(port, route.path, { "X-Lumera-Job-Key": secret });
      assert.notEqual(upperHeaderName.status, 401, `${route.path}: header NAME casing must not affect authorization`);

      // 9a. missing expected server secret -> fail closed, even with a
      // request that would otherwise carry a plausible-looking key.
      delete process.env[route.envVar];
      const noServerSecret = await post(port, route.path, { "x-lumera-job-key": secret });
      assert.equal(noServerSecret.status, 401, `${route.path}: a missing server-side secret must fail closed`);

      // 9b. empty expected server secret -> fail closed
      process.env[route.envVar] = "";
      const emptyServerSecret = await post(port, route.path, { "x-lumera-job-key": "" });
      assert.equal(emptyServerSecret.status, 401, `${route.path}: an empty server-side secret must fail closed, never treat empty === empty as a match`);
    }

    console.log("Internal job-secret timing-safety regression passed.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = previousNodeEnv;
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
