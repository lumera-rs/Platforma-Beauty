import { getListSalonNotificationsQueryKey } from "@workspace/api-client-react";

export function salonNotificationsQueryKey(ownerId?: string) {
  return [...getListSalonNotificationsQueryKey(), ownerId ?? "anonymous"] as const;
}