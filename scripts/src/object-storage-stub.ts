/**
 * Test-only stand-in for the Replit App Storage sidecar.
 *
 * The application signs object URLs by POSTing to a fixed local sidecar
 * (http://127.0.0.1:1106/object-storage/signed-object-url) and then performs
 * PUT/GET/DELETE against whatever URL that sidecar hands back. The sidecar is
 * part of the Replit runtime, so it does not exist on a GitHub runner and the
 * API regression suite's media assertions cannot run there.
 *
 * This module implements only that contract, so GitHub CI can exercise our own
 * object-storage integration deterministically. It is NOT an emulation of
 * Replit App Storage and must never be used to claim App Storage itself works:
 * test:media and image-pipeline remain the real integration coverage and stay
 * Replit-only.
 *
 * Deliberate boundaries:
 *  - lives entirely in scripts/ (test/CI infrastructure); no production file
 *    imports it and no production code path, URL or configuration changes
 *  - starts only when nothing is already listening on the sidecar port, so a
 *    real Replit sidecar always wins and Replit runs are untouched
 *  - never sets PRIVATE_OBJECT_DIR when the environment already provides one
 *  - stores real bytes and serves them back, so request -> upload -> finalize
 *    runs for real: the application still validates the upload ticket, image
 *    signature, ownership (canClaimMediaReference) and generates variants from
 *    the bytes it actually reads back here
 *  - honours the signed method and expiry, so a mismatch in our own code is a
 *    failure here rather than being silently accepted
 */
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";

/** The sidecar address is hardcoded in the application; the stub must match it. */
export const OBJECT_STORAGE_SIDECAR_PORT = 1106;
const SIDECAR_HOST = "127.0.0.1";
const BLOB_PREFIX = "/__stub-object/";

type StoredObject = { bytes: Buffer; contentType: string };
type SignedGrant = { key: string; method: string; expiresAt: number };

export type ObjectStorageStub = {
  /** Extra environment for processes that will talk to the stub. Empty when it did not start. */
  environment: Record<string, string>;
  started: boolean;
  close: () => Promise<void>;
};

function isPortListening(port: number, host: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const settle = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

function readBody(request: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function createStubServer(): Server {
  const objects = new Map<string, StoredObject>();
  const grants = new Map<string, SignedGrant>();

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://${SIDECAR_HOST}:${OBJECT_STORAGE_SIDECAR_PORT}`);

      // 1. The signing contract the application calls.
      if (request.method === "POST" && url.pathname === "/object-storage/signed-object-url") {
        const payload = JSON.parse((await readBody(request)).toString("utf8") || "{}") as {
          bucket_name?: string;
          object_name?: string;
          method?: string;
          expires_at?: string;
        };
        if (!payload.bucket_name || !payload.object_name || !payload.method) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "bucket_name, object_name and method are required" }));
          return;
        }
        const token = randomUUID();
        const expiresAt = payload.expires_at ? Date.parse(payload.expires_at) : Date.now() + 60_000;
        grants.set(token, {
          key: `${payload.bucket_name}/${payload.object_name}`,
          method: payload.method.toUpperCase(),
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 60_000,
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ signed_url: `http://${SIDECAR_HOST}:${OBJECT_STORAGE_SIDECAR_PORT}${BLOB_PREFIX}${token}` }));
        return;
      }

      // 2. The signed URL itself. Only a matching, unexpired grant is honoured.
      if (url.pathname.startsWith(BLOB_PREFIX)) {
        const grant = grants.get(url.pathname.slice(BLOB_PREFIX.length));
        if (!grant) {
          response.writeHead(403).end("unknown or already-consumed signature");
          return;
        }
        if (Date.now() > grant.expiresAt) {
          response.writeHead(403).end("signature expired");
          return;
        }
        if ((request.method ?? "") !== grant.method) {
          response.writeHead(403).end(`signature is valid for ${grant.method}, not ${request.method}`);
          return;
        }

        if (request.method === "PUT") {
          objects.set(grant.key, {
            bytes: await readBody(request),
            contentType: request.headers["content-type"]?.split(";", 1)[0]?.trim() || "application/octet-stream",
          });
          response.writeHead(200).end();
          return;
        }
        if (request.method === "GET") {
          const stored = objects.get(grant.key);
          if (!stored) {
            response.writeHead(404).end("no such object");
            return;
          }
          response.writeHead(200, {
            "content-type": stored.contentType,
            "content-length": String(stored.bytes.length),
          });
          response.end(stored.bytes);
          return;
        }
        if (request.method === "DELETE") {
          // The application tolerates 404 here, so report honestly.
          response.writeHead(objects.delete(grant.key) ? 204 : 404).end();
          return;
        }
        response.writeHead(405).end();
        return;
      }

      response.writeHead(404).end();
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
}

/**
 * Starts the stub only when no App Storage sidecar is already listening.
 *
 * On Replit the real sidecar answers on this port, so this is a no-op and the
 * suite keeps talking to real App Storage with the platform's own
 * PRIVATE_OBJECT_DIR.
 */
export async function startObjectStorageStubIfAbsent(): Promise<ObjectStorageStub> {
  if (await isPortListening(OBJECT_STORAGE_SIDECAR_PORT, SIDECAR_HOST)) {
    return { environment: {}, started: false, close: async () => {} };
  }

  const server = createStubServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(OBJECT_STORAGE_SIDECAR_PORT, SIDECAR_HOST, resolve);
  });
  console.log(
    `App Storage sidecar stub listening on ${SIDECAR_HOST}:${OBJECT_STORAGE_SIDECAR_PORT} ` +
      "(no real sidecar found; media assertions run against our own integration contract).",
  );

  return {
    // Only supplied because no real App Storage is present; never overrides one.
    environment: process.env.PRIVATE_OBJECT_DIR
      ? {}
      : { PRIVATE_OBJECT_DIR: "/lumera-ci-object-storage/private" },
    started: true,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
