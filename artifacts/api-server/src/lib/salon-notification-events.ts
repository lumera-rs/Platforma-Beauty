import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import type { Response } from "express";
import { logger } from "./logger";

const salonNotificationSubscribers = new Map<string, Set<Response>>();
const heartbeatIntervalMs = 25_000;
const salonNotificationChannel = "lumera_salon_notification_updates";
const listenerInstanceId = randomUUID();
const initialReconnectDelayMs = 1_000;
const maximumReconnectDelayMs = 30_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function connectListenerClient() {
  return pool.connect();
}

type SalonNotificationListenerClient = Awaited<ReturnType<typeof connectListenerClient>>;
type SalonNotificationListenerConnection = {
  client: SalonNotificationListenerClient;
  closed: boolean;
  ready: boolean;
  onEnd: () => void;
  onError: (error: Error) => void;
  onNotification: (notification: { channel: string; payload?: string }) => void;
};

let listenerConnection: SalonNotificationListenerConnection | undefined;
let listenerStartPromise: Promise<void> | undefined;
let listenerReconnectTimer: NodeJS.Timeout | undefined;
let listenerReconnectDelayMs = initialReconnectDelayMs;
let listenerStopped = true;

function ignoreTerminalListenerError(): void {
  // The connection is already being destroyed. Keeping one terminal error
  // handler prevents a final socket event from becoming an uncaught exception.
}

function eventPayload(): string {
  return `data: ${JSON.stringify({ type: "salon-notifications-updated" })}\n\n`;
}

function broadcastSalonNotificationUpdate(salonId: string): void {
  const subscribers = salonNotificationSubscribers.get(salonId);
  if (!subscribers) return;

  const payload = eventPayload();
  for (const response of subscribers) {
    try {
      response.write(payload);
    } catch {
      response.destroy();
    }
  }
  if (subscribers.size === 0) salonNotificationSubscribers.delete(salonId);
}

function parseSharedEvent(payload: string | undefined): { salonId: string; sourceInstanceId: string } | undefined {
  if (!payload) return undefined;

  try {
    const candidate: unknown = JSON.parse(payload);
    if (
      !candidate
      || typeof candidate !== "object"
      || !("salonId" in candidate)
      || typeof candidate.salonId !== "string"
      || !uuidPattern.test(candidate.salonId)
      || !("sourceInstanceId" in candidate)
      || typeof candidate.sourceInstanceId !== "string"
      || !uuidPattern.test(candidate.sourceInstanceId)
    ) {
      return undefined;
    }

    return {
      salonId: candidate.salonId,
      sourceInstanceId: candidate.sourceInstanceId,
    };
  } catch {
    return undefined;
  }
}

function scheduleListenerReconnect(): void {
  if (listenerStopped || listenerReconnectTimer) return;

  const delayMs = listenerReconnectDelayMs;
  listenerReconnectDelayMs = Math.min(listenerReconnectDelayMs * 2, maximumReconnectDelayMs);
  listenerReconnectTimer = setTimeout(() => {
    listenerReconnectTimer = undefined;
    void startSalonNotificationEventListener();
  }, delayMs);
  listenerReconnectTimer.unref();
}

function destroyListenerConnection(
  connection: SalonNotificationListenerConnection,
  error?: Error,
): void {
  if (connection.closed) return;
  connection.closed = true;
  connection.client.off("error", connection.onError);
  connection.client.off("end", connection.onEnd);
  connection.client.off("notification", connection.onNotification);
  connection.client.on("error", ignoreTerminalListenerError);
  if (listenerConnection === connection) listenerConnection = undefined;
  try {
    connection.client.release(error ?? true);
  } catch (releaseError) {
    logger.warn({ err: releaseError }, "Salon notification listener could not release its connection");
  }
}

async function connectSharedListener(): Promise<void> {
  let client: SalonNotificationListenerClient | undefined;
  let connection: SalonNotificationListenerConnection | undefined;
  try {
    client = await connectListenerClient();
    connection = {
      client,
      closed: false,
      ready: false,
      onError: () => undefined,
      onEnd: () => undefined,
      onNotification: () => undefined,
    };
    const activeConnection = connection;
    connection.onNotification = (notification) => {
      if (activeConnection.closed || listenerStopped) return;
      if (notification.channel !== salonNotificationChannel) return;
      const event = parseSharedEvent(notification.payload);
      if (!event) {
        logger.warn("Ignored an invalid salon notification broadcast");
        return;
      }
      if (event.sourceInstanceId === listenerInstanceId) return;
      broadcastSalonNotificationUpdate(event.salonId);
    };
    connection.onError = (error) => {
      if (activeConnection.closed) return;
      destroyListenerConnection(activeConnection, error);
      logger.warn({ err: error }, "Salon notification listener disconnected");
      scheduleListenerReconnect();
    };
    connection.onEnd = () => {
      if (activeConnection.closed) return;
      destroyListenerConnection(activeConnection);
      logger.warn("Salon notification listener ended");
      scheduleListenerReconnect();
    };
    client.on("notification", connection.onNotification);
    client.once("error", connection.onError);
    client.once("end", connection.onEnd);

    if (listenerStopped) {
      destroyListenerConnection(connection);
      return;
    }

    listenerConnection = connection;
    await client.query(`LISTEN ${salonNotificationChannel}`);

    if (listenerStopped) {
      destroyListenerConnection(connection);
      return;
    }

    connection.ready = true;
    listenerReconnectDelayMs = initialReconnectDelayMs;
    logger.info("Salon notification listener connected");
  } catch (error) {
    if (connection?.closed) return;
    if (connection) {
      destroyListenerConnection(
        connection,
        error instanceof Error ? error : new Error(String(error)),
      );
    } else {
      client?.release(true);
    }
    logger.warn({ err: error }, "Salon notification listener could not connect");
    if (!listenerStopped) scheduleListenerReconnect();
  }
}

/**
 * Gives this API instance a dedicated PostgreSQL listener so notification
 * changes committed by another instance reach its local SSE subscribers.
 * PostgreSQL notifications are intentionally treated as non-durable: browser
 * reconnect rehydration and polling remain the recovery path for missed events.
 */
export async function startSalonNotificationEventListener(): Promise<void> {
  listenerStopped = false;
  if (listenerConnection?.ready) return;

  if (!listenerStartPromise) {
    listenerStartPromise = connectSharedListener().finally(() => {
      listenerStartPromise = undefined;
    });
  }
  await listenerStartPromise;
}

export async function stopSalonNotificationEventListener(): Promise<void> {
  listenerStopped = true;
  if (listenerReconnectTimer) {
    clearTimeout(listenerReconnectTimer);
    listenerReconnectTimer = undefined;
  }
  const connection = listenerConnection;
  if (!connection) return;
  if (!connection.ready) {
    destroyListenerConnection(connection);
    return;
  }

  connection.closed = true;
  connection.client.off("notification", connection.onNotification);
  listenerConnection = undefined;
  let unlistenError: Error | undefined;

  try {
    await connection.client.query(`UNLISTEN ${salonNotificationChannel}`);
  } catch (error) {
    unlistenError = error instanceof Error ? error : new Error(String(error));
    logger.warn({ err: error }, "Salon notification listener could not unlisten cleanly");
  } finally {
    if (unlistenError) {
      connection.client.off("error", connection.onError);
      connection.client.off("end", connection.onEnd);
      connection.client.on("error", ignoreTerminalListenerError);
      connection.client.release(unlistenError);
    } else {
      connection.client.release();
      connection.client.off("error", connection.onError);
      connection.client.off("end", connection.onEnd);
    }
  }
}

/**
 * Keeps an authenticated owner's browser subscribed to notification changes
 * for its currently active salon. The browser reconnects when a network
 * interruption closes this response.
 */
export function subscribeToSalonNotificationEvents(salonId: string, response: Response): void {
  const subscribers = salonNotificationSubscribers.get(salonId) ?? new Set<Response>();
  subscribers.add(response);
  salonNotificationSubscribers.set(salonId, subscribers);

  let closed = false;
  const unsubscribe = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    subscribers.delete(response);
    if (subscribers.size === 0) salonNotificationSubscribers.delete(salonId);
  };

  const write = (payload: string) => {
    if (closed) return;
    try {
      response.write(payload);
    } catch {
      response.destroy();
      unsubscribe();
    }
  };

  const heartbeat = setInterval(() => {
    write(": keepalive\n\n");
  }, heartbeatIntervalMs);
  heartbeat.unref();

  response.once("close", unsubscribe);
  response.once("error", unsubscribe);
  write(": connected\n\n");
}

/**
 * Broadcast only after the transaction that created or changed a notification
 * has committed. Clients refetch their authorized notification list on receipt.
 */
export async function publishSalonNotificationUpdate(salonId: string): Promise<void> {
  broadcastSalonNotificationUpdate(salonId);

  try {
    await pool.query("SELECT pg_notify($1, $2)", [
      salonNotificationChannel,
      JSON.stringify({ salonId, sourceInstanceId: listenerInstanceId }),
    ]);
  } catch (error) {
    logger.warn({ err: error, salonId }, "Salon notification broadcast failed; clients will recover by polling");
  }
}