import { fetchNativeJson } from "@/lib/native-fetch";
import type { PushSubscriptionRequest } from "@/lib/customer-push-utils";

export { toPushSubscriptionRequest, urlBase64ToUint8Array } from "@/lib/customer-push-utils";

export type PushConfigResponse = {
  configured: boolean;
  publicKey: string | null;
};

export type SavedPushSubscription = {
  id: string;
  endpoint: string;
  enabled: boolean;
  lastSeenAt: string;
  createdAt: string;
};

const PUSH_SUBSCRIPTIONS_URL = "/api/customer/push-subscriptions";

export function getPushConfig(): Promise<PushConfigResponse> {
  return fetchNativeJson<PushConfigResponse>(
    "/api/push/config",
    { credentials: "include" },
    { httpErrorMessage: "Ključ za push obaveštenja nije dostupan." },
  );
}

export function upsertPushSubscription(subscription: PushSubscriptionRequest): Promise<SavedPushSubscription> {
  return fetchNativeJson<SavedPushSubscription>(
    PUSH_SUBSCRIPTIONS_URL,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription),
    },
    { httpErrorMessage: "Uređaj nije sačuvan za push obaveštenja." },
  );
}

export function listPushSubscriptions(): Promise<SavedPushSubscription[]> {
  return fetchNativeJson<SavedPushSubscription[]>(
    PUSH_SUBSCRIPTIONS_URL,
    { credentials: "include" },
    { httpErrorMessage: "Lista push uređaja nije dostupna." },
  );
}

export function deletePushSubscription(subscriptionId: string): Promise<void> {
  return fetchNativeJson<void>(
    `${PUSH_SUBSCRIPTIONS_URL}/${encodeURIComponent(subscriptionId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
    { httpErrorMessage: "Push obaveštenja nisu isključena na serveru." },
  );
}