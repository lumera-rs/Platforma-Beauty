export type PushSubscriptionRequest = {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
};

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

export function toPushSubscriptionRequest(subscription: PushSubscription): PushSubscriptionRequest {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.auth || !json.keys.p256dh) {
    throw new Error("Pregledač nije vratio ispravne podatke za push obaveštenja.");
  }
  return {
    endpoint: json.endpoint,
    keys: { auth: json.keys.auth, p256dh: json.keys.p256dh },
  };
}