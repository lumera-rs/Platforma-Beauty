/**
 * Log-redaction probe, spawned as a child process by
 * automation-provider-events.test.ts.
 *
 * Starts the real app (with its real pino-http + slow-request logging wired
 * to this process's stdout), performs one AUTHENTICATED webhook call and one
 * forged one, then exits. The parent test captures this process's full
 * stdout/stderr and asserts the webhook capability token never appears in any
 * emitted log line while the redacted `:token` placeholder does.
 *
 * Exit codes: 0 = both requests behaved as expected; 1 = unexpected statuses.
 */
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import app from "../app";
import { resolveWebhookSecret } from "./provider-events";

async function main() {
  const secret = await resolveWebhookSecret("brevo");
  if (!secret) {
    process.stderr.write("logcheck: no webhook secret resolvable\n");
    process.exit(1);
  }

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;

  const post = (token: string) =>
    fetch(`http://127.0.0.1:${port}/api/webhooks/brevo/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ event: "delivered", "message-id": "<logcheck-unmatched@nowhere>" }]),
    });

  const authenticated = await post(secret);
  const forged = await post(`${secret}-forged`);
  server.close();

  const ok = authenticated.status === 200 && forged.status === 401;
  if (!ok) {
    process.stderr.write(`logcheck: unexpected statuses ${authenticated.status}/${forged.status}\n`);
  }
  // Give the pino transport worker a moment to flush before exiting.
  setTimeout(() => process.exit(ok ? 0 : 1), 700);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
