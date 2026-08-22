import type { Response } from "express";

const salonNotificationSubscribers = new Map<string, Set<Response>>();
const heartbeatIntervalMs = 25_000;

function eventPayload(): string {
  return `data: ${JSON.stringify({ type: "salon-notifications-updated" })}\n\n`;
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
export function publishSalonNotificationUpdate(salonId: string): void {
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