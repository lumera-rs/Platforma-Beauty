import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer, type Server } from "node:https";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export interface IsolatedPublicOrigin {
  origin: string;
  close(): Promise<void>;
}

/** Harness-only TLS endpoint; never changes process-wide certificate trust. */
export async function startIsolatedPublicOrigin(
  apiPort: number,
  temporaryRoot = tmpdir(),
): Promise<IsolatedPublicOrigin> {
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error("The isolated public origin requires a valid loopback API port.");
  }
  const directory = await mkdtemp(path.join(temporaryRoot, "lumera-public-origin-"));
  let server: Server | undefined;
  const sockets = new Set<Socket>();
  const upstreamRequests = new Set<ReturnType<typeof request>>();
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        for (const upstream of upstreamRequests) upstream.destroy();
        for (const socket of sockets) socket.destroy();
        if (server?.listening) {
          await new Promise<void>((resolve, reject) => {
            server!.close((error) => error ? reject(error) : resolve());
          });
        }
      } finally {
        // Only remove the unique directory we created, never the caller's root.
        await rm(directory, { recursive: true, force: true });
      }
    })();
    return closing;
  };

  try {
    const keyPath = path.join(directory, "key.pem");
    const certPath = path.join(directory, "cert.pem");
    const generated = spawnSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", keyPath, "-out", certPath, "-days", "1",
      "-subj", "/CN=127.0.0.1",
      "-addext", "subjectAltName=IP:127.0.0.1",
    ], { stdio: "ignore", timeout: 15_000 });
    if (generated.error || generated.status !== 0) {
      throw new Error("Could not generate the isolated public origin TLS certificate with openssl.", {
        cause: generated.error,
      });
    }
    const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
    server = createServer({ key, cert }, (incoming, outgoing) => {
      const upstream = request({
        hostname: "127.0.0.1",
        port: apiPort,
        method: incoming.method,
        path: incoming.url,
        headers: { ...incoming.headers, "x-forwarded-proto": "https" },
        agent: false,
      }, (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.on("error", () => outgoing.destroy());
        response.pipe(outgoing);
      });
      upstreamRequests.add(upstream);
      upstream.once("close", () => upstreamRequests.delete(upstream));
      upstream.on("error", () => {
        if (outgoing.destroyed) return;
        if (outgoing.headersSent) {
          outgoing.destroy();
        } else {
          outgoing.writeHead(502, { "content-type": "text/plain" });
          outgoing.end("Isolated API server unavailable.");
        }
      });
      incoming.on("error", () => upstream.destroy());
      outgoing.once("close", () => upstream.destroy());
      incoming.pipe(upstream);
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => {
        server!.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not bind the isolated public HTTPS origin.");
    }
    return { origin: `https://127.0.0.1:${address.port}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}