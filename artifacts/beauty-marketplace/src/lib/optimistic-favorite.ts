import type { SalonCard } from "@workspace/api-client-react";

export function updateOptimisticFavorites(
  current: SalonCard[] | undefined,
  salon: SalonCard,
  favorited: boolean,
): SalonCard[] {
  if (!favorited) return (current ?? []).filter((item) => item.id !== salon.id);
  if (current?.some((item) => item.id === salon.id)) return current;
  return [...(current ?? []), salon];
}