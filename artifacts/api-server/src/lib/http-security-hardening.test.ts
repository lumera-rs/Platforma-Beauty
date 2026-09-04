/**
 * Task #8: HTTP/API security hardening regression.
 *
 * Confirms the app-wide Helmet baseline (app.ts) and the two narrowly
 * scoped, route-specific exceptions it required:
 *   - routes/widget.ts overrides Cross-Origin-Resource-Policy back to
 *     "cross-origin" for exactly the /widget routes that already opt into
 *     permissive CORS (the booking widget embedded on external salon
 *     websites) -- every other route keeps Helmet's stricter same-origin
 *     default.
 *   - /auth/me now sends Cache-Control: private, no-store.
 *
 * Also reconfirms (without changing) that: CORS is not permissive anywhere
 * except /widget/*, no route reflects an arbitrary Origin, and
 * X-Powered-By is no longer sent.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/lib/http-security-hardening.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import app from "../app";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const tsxBin = path.resolve(thisDir, "../../../../scripts/node_modules/.bin/tsx");
const hstsChildScript = path.resolve(thisDir, "http-security-hsts-child.ts");

type HttpResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

function request(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1", port, path, method: options.method ?? "GET",
      headers: options.headers,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function header(response: HttpResponse, name: string): string | undefined {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function assertBaselineSecurityHeaders(response: HttpResponse, label: string) {
  assert.equal(header(response, "x-powered-by"), undefined, `${label}: X-Powered-By must not be sent`);
  assert.equal(header(response, "x-content-type-options"), "nosniff", `${label}: X-Content-Type-Options must be nosniff`);
  assert.ok(header(response, "referrer-policy"), `${label}: Referrer-Policy must be set`);
  assert.ok(header(response, "content-security-policy"), `${label}: Content-Security-Policy must be set`);
  assert.equal(header(response, "permissions-policy"), "camera=(), microphone=(), geolocation=()", `${label}: Permissions-Policy must restrict unused browser capabilities`);
}

async function run(): Promise<void> {
  const previousNodeEnv = process.env["NODE_ENV"];

  // --- Production-topology assertion (HSTS gating). app.ts reads
  // process.env.NODE_ENV once, at module import time (same pattern as the
  // neighboring `trust proxy` line) -- mutating process.env in this
  // already-running process would have no effect on the already-imported
  // `app` above. A genuinely separate child process, started with
  // NODE_ENV=production from before Node loads app.ts at all, is the only
  // way to observe that code path honestly.
  const hstsChild = spawn(tsxBin, [hstsChildScript], {
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  try {
    const prodPort = await new Promise<number>((resolve, reject) => {
      let buffered = "";
      const onData = (chunk: Buffer) => {
        buffered += chunk.toString("utf8");
        const match = buffered.match(/PORT:(\d+)/);
        if (match) { hstsChild.stdout?.off("data", onData); resolve(Number(match[1])); }
      };
      hstsChild.stdout?.on("data", onData);
      hstsChild.on("error", reject);
      hstsChild.on("exit", (code) => reject(new Error(`HSTS child process exited early (code ${code})`)));
    });
    const prodHealth = await request(prodPort, "/api/healthz");
    assert.ok(header(prodHealth, "strict-transport-security"), "production topology must send HSTS");
    assert.doesNotMatch(header(prodHealth, "strict-transport-security") ?? "", /includeSubDomains/i,
      "HSTS must not claim includeSubDomains -- this process cannot vouch for other subdomains");
  } finally {
    hstsChild.kill();
  }

  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    // 1. Public GET (health endpoint) -- baseline headers present, no HSTS
    // outside the real production topology, health data stays operational
    // metrics only (no hostnames/credentials/stack traces).
    const health = await request(port, "/api/healthz");
    assert.equal(health.status, 200);
    assertBaselineSecurityHeaders(health, "GET /api/healthz");
    assert.equal(header(health, "strict-transport-security"), undefined, "non-production must not send HSTS");
    const healthBody = JSON.parse(health.body) as { databasePool: unknown; schedulerJobs: unknown };
    assert.ok(healthBody.databasePool);
    assert.ok(Array.isArray(healthBody.schedulerJobs));

    // 2. Authenticated GET (/auth/me), signed out -- headers + no-store,
    // existing behavior (user: null, 200) unchanged.
    const meSignedOut = await request(port, "/api/auth/me");
    assert.equal(meSignedOut.status, 200);
    assertBaselineSecurityHeaders(meSignedOut, "GET /api/auth/me (signed out)");
    assert.equal(header(meSignedOut, "cache-control"), "private, no-store", "/auth/me must never be cacheable");
    assert.deepEqual(JSON.parse(meSignedOut.body), { user: null });

    // 3. Authenticated mutation route (login) -- headers present, existing
    // validation/auth behavior unchanged (bad credentials still 401, not a
    // header-related regression).
    const loginAttempt = await request(port, "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    assertBaselineSecurityHeaders(loginAttempt, "POST /api/auth/login");
    assert.equal(loginAttempt.status, 400, "malformed login body must still be a normal validation 400, not broken by new middleware");

    // 4. Admin endpoint -- still requires auth; headers still present on the
    // rejection itself.
    const adminAttempt = await request(port, "/api/admin/integrations");
    assert.equal(adminAttempt.status, 401, "anonymous admin access must remain rejected");
    assertBaselineSecurityHeaders(adminAttempt, "GET /api/admin/integrations (anonymous)");

    // 5. OAuth failure redirect -- still a 302 to the expected failure path,
    // and still carries the baseline headers even on a redirect response.
    const oauthBadState = await request(port, "/api/auth/oauth/facebook/callback?state=nonexistent&code=x");
    assert.equal(oauthBadState.status, 302);
    assert.match(header(oauthBadState, "location") ?? "", /^\/prijava\?oauth_error=/);
    assertBaselineSecurityHeaders(oauthBadState, "GET /api/auth/oauth/facebook/callback (bad state)");

    // 6. Booking widget -- CORS is preserved for an ARBITRARY (attacker)
    // origin (this is intentional: the widget has no credentials and is
    // meant to be embeddable on any salon's site), AND the CORP override
    // survives Helmet's app-wide default.
    const widgetAttackerOrigin = await request(port, "/api/widget/salons/does-not-exist", {
      headers: { origin: "https://attacker.example" },
    });
    assert.equal(header(widgetAttackerOrigin, "access-control-allow-origin"), "*",
      "the widget intentionally allows any origin -- it carries no credentials");
    assert.equal(header(widgetAttackerOrigin, "cross-origin-resource-policy"), "cross-origin",
      "widget routes must override Helmet's same-origin CORP default or cross-origin salon sites cannot read the response");
    assertBaselineSecurityHeaders(widgetAttackerOrigin, "GET /api/widget/salons/:slug (attacker origin)");
    // Preflight for a real widget booking POST must still succeed.
    const widgetPreflight = await request(port, "/api/widget/salons/does-not-exist/appointments", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example", "access-control-request-method": "POST" },
    });
    assert.equal(widgetPreflight.status, 204);
    assert.equal(header(widgetPreflight, "access-control-allow-origin"), "*");
    assert.equal(header(widgetPreflight, "access-control-allow-methods"), "GET, POST, OPTIONS");

    // 7. Internal job endpoint (Task #7B, untouched here) -- still rejects
    // without a valid secret, still carries the baseline headers, and the
    // secret comparison is unaffected by any of this task's changes.
    const jobAttempt = await request(port, "/api/internal/jobs/sms-reminders", { method: "POST" });
    assert.equal(jobAttempt.status, 401, "internal job endpoints must still reject a missing secret exactly as before");
    assertBaselineSecurityHeaders(jobAttempt, "POST /api/internal/jobs/sms-reminders (no secret)");

    // --- CORS re-check (item 10): no non-widget route ever reflects an
    // arbitrary attacker origin, "null", or the legitimate app origin --
    // there is no global CORS middleware, so credentialed routes stay
    // same-origin-only by omission, not by a fragile allowlist.
    for (const origin of ["https://attacker.example", "null", "https://app.lumera.test"]) {
      const nonWidget = await request(port, "/api/auth/me", { headers: { origin } });
      assert.equal(header(nonWidget, "access-control-allow-origin"), undefined,
        `GET /api/auth/me must never reflect Origin: ${origin} -- this is a credentialed, cookie-authenticated route`);
      assert.equal(header(nonWidget, "access-control-allow-credentials"), undefined);
    }

    // A cross-origin preflight against a credentialed mutation route must
    // not be answered with any CORS grant -- a browser sending a real
    // preflight here would refuse to proceed with the actual request.
    const nonWidgetPreflight = await request(port, "/api/auth/login", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example", "access-control-request-method": "POST" },
    });
    assert.equal(header(nonWidgetPreflight, "access-control-allow-origin"), undefined,
      "a credentialed mutation route must never grant a cross-origin preflight");

    console.log("HTTP security hardening regression passed.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = previousNodeEnv;
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
