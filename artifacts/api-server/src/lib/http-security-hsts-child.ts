/**
 * Standalone helper process for http-security-hardening.test.ts.
 *
 * app.ts reads process.env.NODE_ENV once, at module import time (the same
 * established pattern as its neighboring `app.set("trust proxy", ...)`
 * line), to decide whether to send Strict-Transport-Security. That makes
 * the production-topology HSTS behavior untestable by mutating
 * process.env within an already-running test process -- the app module is
 * already imported by then. This tiny script exists only so the parent
 * test can spawn it with NODE_ENV genuinely set to "production" before
 * Node ever loads app.ts, then inspect one real response.
 */
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import app from "../app";

async function run(): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  console.log(`PORT:${(server.address() as AddressInfo).port}`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
