import { createServer, type ServerResponse } from "node:http";
import { access, writeFile } from "node:fs/promises";
import app from "./app";
import { ensureDemoData } from "./lib/seed";
import {
  dropSalonNotificationListenerConnectionForTests,
  failNextSalonNotificationListenerUnlistenForTests,
  getSalonNotificationListenerTestStatus,
  startSalonNotificationEventListener,
  stopSalonNotificationEventListener,
} from "./lib/salon-notification-events";

const rawPort = process.env.PORT ?? "0";
const port = Number(rawPort);
const healthzHoldFile = process.env.LUMERA_TEST_HEALTHZ_HOLD_FILE;
const healthzReachedFile = process.env.LUMERA_TEST_HEALTHZ_REACHED_FILE;

if (!Number.isInteger(port) || port < 0) {
  throw new Error(`Invalid test server PORT value: "${rawPort}".`);
}

if (process.env.LUMERA_TEST_SEED === "1") {
  await ensureDemoData();
}

await startSalonNotificationEventListener();
if (process.env.LUMERA_TEST_DROP_SALON_NOTIFICATION_LISTENER_ON_STARTUP === "1") {
  await dropSalonNotificationListenerConnectionForTests();
}
let isShuttingDown = false;
const heldHealthzResponses = new Set<ServerResponse>();

async function waitForHealthzRelease(): Promise<void> {
  if (!healthzHoldFile) return;

  while (!isShuttingDown) {
    try {
      await access(healthzHoldFile);
      return;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      throw error;
    }
  }
}

const server = createServer((request, response) => {
  if (healthzHoldFile && request.url?.split("?")[0] === "/api/healthz") {
    heldHealthzResponses.add(response);
    if (healthzReachedFile) {
      void writeFile(healthzReachedFile, "healthz\n").catch(() => undefined);
    }
    void waitForHealthzRelease()
      .then(() => {
        heldHealthzResponses.delete(response);
        if (isShuttingDown || response.writableEnded) return;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
      })
      .catch(() => {
        heldHealthzResponses.delete(response);
        response.destroy();
      });
    return;
  }

  app(request, response);
}).listen(port, "127.0.0.1");

server.once("error", (error) => {
  console.error(error);
  process.exit(1);
});

server.once("listening", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test API server did not expose a TCP address.");
  }

  console.log(`Test API server listening on ${address.port}`);
});

function shutDown(signal: NodeJS.Signals) {
  isShuttingDown = true;
  for (const response of heldHealthzResponses) response.destroy();
  heldHealthzResponses.clear();
  void stopSalonNotificationEventListener().finally(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5_000).unref();
  console.log(`Test API server received ${signal}; closing.`);
}

process.once("SIGINT", () => shutDown("SIGINT"));
process.once("SIGTERM", () => shutDown("SIGTERM"));

type ListenerControlMessage = {
  type: "salon-notification-listener-control";
  requestId: string;
  command: "status" | "drop" | "stop-with-unlisten-fault";
};

function isListenerControlMessage(message: unknown): message is ListenerControlMessage {
  return Boolean(
    message
    && typeof message === "object"
    && "type" in message
    && message.type === "salon-notification-listener-control"
    && "requestId" in message
    && typeof message.requestId === "string"
    && "command" in message
    && (
      message.command === "status"
      || message.command === "drop"
      || message.command === "stop-with-unlisten-fault"
    ),
  );
}

process.on("message", (message: unknown) => {
  if (!isListenerControlMessage(message) || !process.send) return;

  void (async () => {
    try {
      if (message.command === "drop") {
        await dropSalonNotificationListenerConnectionForTests();
      } else if (message.command === "stop-with-unlisten-fault") {
        failNextSalonNotificationListenerUnlistenForTests();
        await stopSalonNotificationEventListener();
      }
      process.send?.({
        type: "salon-notification-listener-control-result",
        requestId: message.requestId,
        status: getSalonNotificationListenerTestStatus(),
      });
    } catch (error) {
      process.send?.({
        type: "salon-notification-listener-control-result",
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});