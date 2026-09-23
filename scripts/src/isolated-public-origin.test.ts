import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { request } from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { startIsolatedPublicOrigin } from "./isolated-public-origin";

test("isolated HTTPS origin forwards real TLS requests and removes its owned resources", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "public-origin-test-"));
  const backend = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(201, { "content-type": "application/json", "x-proxy-test": "yes" });
    res.end(JSON.stringify({
      method: req.method, url: req.url, body, protocol: req.headers["x-forwarded-proto"],
    }));
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const address = backend.address();
  assert.ok(address && typeof address !== "string");
  let proxy: Awaited<ReturnType<typeof startIsolatedPublicOrigin>> | undefined;
  try {
    proxy = await startIsolatedPublicOrigin(address.port, root);
    assert.match(proxy.origin, /^https:\/\/127\.0\.0\.1:\d+$/);
    const [ownedDirectory] = await readdir(root);
    const ca = await readFile(path.join(root, ownedDirectory, "cert.pem"));
    const result = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      // Trust only this ephemeral cert; do not disable TLS verification.
      const req = request(`${proxy!.origin}/api/check?value=1`, {
        method: "POST", ca, agent: false,
      }, async (res) => {
        try {
          assert.equal(res.headers["x-proxy-test"], "yes");
          let body = "";
          for await (const chunk of res) body += chunk;
          resolve({ status: res.statusCode, body });
        } catch (error) {
          reject(error);
        }
      });
      req.on("error", reject);
      req.end("forwarded body");
    });
    assert.equal(result.status, 201);
    assert.deepEqual(JSON.parse(result.body), {
      method: "POST", url: "/api/check?value=1", body: "forwarded body", protocol: "https",
    });
    await proxy.close();
    await proxy.close();
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(new Promise<void>((resolve, reject) => {
      const req = request(proxy!.origin, { ca, agent: false }, () => resolve());
      req.on("error", reject);
      req.end();
    }), { code: "ECONNREFUSED" });
  } finally {
    await proxy?.close();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("certificate setup failure removes the owned temporary directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "public-origin-failure-test-"));
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = root;
    await assert.rejects(startIsolatedPublicOrigin(12345, root), /TLS certificate with openssl/);
    assert.deepEqual(await readdir(root), []);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});